// Two simulated Macs share one sync folder; each round trip runs the real adapters against the real store.
import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../store/browser.ts");
const model = await import("../store/model.ts");
const { Clock, emptyScope, syncScope } = await import("@netnyahoo/sync");
const adapters = await import("./adapters.ts");
const stub = await import("../test-native-stub.mjs");

const S = () => useBrowser.getState();

class Folder {
  files = new Map();
  counter = 0;
  transport() {
    return {
      write: async (scope, payload) => {
        const id = `f${++this.counter}`;
        this.files.set(id, { scope, payload });
        return id;
      },
      read: async (scope, known) => {
        const files = [...this.files].filter(([id, f]) => f.scope === scope && !known.includes(id)).map(([id, f]) => ({ id, payload: f.payload }));
        return { files, pending: [], damaged: [], present: [...this.files].filter(([, f]) => f.scope === scope).map(([id]) => id) };
      },
      remove: async (_scope, ids) => ids.forEach((id) => this.files.delete(id)),
    };
  }
}

class Device {
  constructor(id, folder) {
    this.id = id;
    this.folder = folder;
    S().hydrate({});
    // Their history and bookmarks are the store's alone here (lib/history.ts, lib/bookmarks.ts aren't running).
    useBrowser.setState({ historyReady: { default: true }, bookmarksReady: { default: true } });
    this.browser = S();
    this.scopes = { app: emptyScope(), p: emptyScope() };
    this.clock = new Clock(id);
    stub.passwordStores.set(id, new Map());
    this.passwords = adapters.passwordsAdapter("default", () => true, stub.readLogins);
  }
  with(fn) {
    stub.current.device = this.id;
    useBrowser.setState(this.browser, true);
    try {
      return fn();
    } finally {
      this.browser = S();
    }
  }
  async sync(profileId = "default") {
    stub.current.device = this.id;
    useBrowser.setState(this.browser, true);
    const run = (scope, list, options) =>
      syncScope({
        scope,
        state: this.scopes[scope],
        transport: this.folder.transport(),
        adapters: list,
        clock: this.clock,
        device: this.id,
        options,
      });
    const app = await run("app", [adapters.settingsAdapter]);
    const p = await run(
      "p",
      [
        adapters.pinnedAdapter(profileId),
        adapters.bookmarksAdapter(profileId),
        adapters.historyAdapter(profileId),
        adapters.deviceTabsAdapter(profileId, this.id, () => `${this.id}'s MacBook Pro`),
        this.passwords,
      ],
      { expired: adapters.historyExpired },
    );
    this.browser = S();
    return { published: app.published + p.published };
  }
}

async function syncAll(devices, rounds = 2) {
  for (let i = 0; i < rounds; i++) for (const d of devices) await d.sync();
}

function tree(device, profileId = "default") {
  return device.with(() => {
    const b = S().bookmarks;
    const roots = b.roots[profileId];
    const walk = (id) => {
      const n = b.nodes[id];
      return n.kind === "url" ? `${n.title}=${n.url}` : { [n.title]: n.children.map(walk) };
    };
    return { bar: walk(roots.bar), other: walk(roots.other) };
  });
}

function assertTreeWhole(device) {
  device.with(() => {
    const b = S().bookmarks;
    for (const n of Object.values(b.nodes)) {
      if (n.parentId) assert.ok(b.nodes[n.parentId]?.children.includes(n.id), `${n.title} is in its parent`);
      if (n.kind === "folder") for (const c of n.children) assert.equal(b.nodes[c]?.parentId, n.id);
    }
  });
}

test("bookmarks: a folder deleted on one Mac while the other adds to it keeps the new bookmark", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.with(() => S().addBookmarkFolder({ profileId: "default", title: "Trip" }));
  await syncAll([a, b]);
  const trip = (d) => d.with(() => Object.values(S().bookmarks.nodes).find((n) => n.title === "Trip")?.id);
  a.with(() => S().removeBookmark(trip(a)));
  b.with(() => S().addBookmark({ profileId: "default", url: "https://hotel.example/", title: "Hotel", parentId: trip(b) }));
  await syncAll([a, b, a]);
  assert.deepEqual(tree(a), tree(b));
  assert.deepEqual(tree(a).other, { "Other Bookmarks": ["Hotel=https://hotel.example/"] });
  assertTreeWhole(a);
  assertTreeWhole(b);
});

test("bookmarks: folders moved into each other on two Macs don't make a cycle", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.with(() => {
    S().addBookmarkFolder({ profileId: "default", title: "One" });
    S().addBookmarkFolder({ profileId: "default", title: "Two" });
  });
  await syncAll([a, b]);
  const id = (d, title) => d.with(() => Object.values(S().bookmarks.nodes).find((n) => n.title === title).id);
  a.with(() => S().moveBookmark(id(a, "One"), id(a, "Two")));
  b.with(() => S().moveBookmark(id(b, "Two"), id(b, "One")));
  await syncAll([a, b, a, b]);
  assert.deepEqual(tree(a), tree(b));
  assertTreeWhole(a);
  const reachable = JSON.stringify(tree(a));
  assert.ok(reachable.includes("One") && reachable.includes("Two"));
});

// Pinned tabs are the profile's: every window has a copy of each (store/pinMirror.ts), and sync sees one pin per key.
test("pinned tabs sync once however many windows show them; a closed window or a parked set deletes nothing elsewhere", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  let aHome, aWork;
  a.with(() => {
    aHome = S().createWindow({ url: "https://mail.example/" });
    const mail = model.viewTabIds(S(), aHome)[0];
    const cal = S().newTab(aHome, { url: "https://cal.example/" });
    S().pinTabs([mail, cal], true);
    aWork = S().createWindow({ url: "https://work.example/" });
  });
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  const pins = (d) => d.with(() => Object.values(S().tabs).filter((t) => t.pinned).map((t) => t.pinnedUrl).sort());
  assert.deepEqual(pins(a), ["https://cal.example/", "https://cal.example/", "https://mail.example/", "https://mail.example/"], "a copy in each of A's windows");
  assert.deepEqual(pins(b), ["https://cal.example/", "https://mail.example/"], "one each on B");

  a.with(() => S().closeWindow(aHome));
  assert.equal(a.with(() => S().parkedPins.default), undefined, "A's other window still shows them: nothing parked");
  await syncAll([a, b]);
  assert.deepEqual(pins(b), ["https://cal.example/", "https://mail.example/"], "still pinned on B");

  b.with(() => {
    const [mail, cal] = ["https://mail.example/", "https://cal.example/"].map((u) => Object.values(S().tabs).find((t) => t.pinnedUrl === u).id);
    S().updateTab(mail, { customTitle: "Inbox" });
    S().pinTabs([cal], false);
  });
  await syncAll([b, a]);
  const tiles = (d, w) => d.with(() => model.viewTabIds(S(), w).filter((id) => S().tabs[id].pinned).map((id) => `${S().tabs[id].pinnedUrl} ${S().tabs[id].customTitle}`));
  assert.deepEqual(tiles(a, aWork), ["https://mail.example/ Inbox"]);
  assert.equal((await a.sync()).published, 0, "settled");

  // The last window closes: its pins wait in the park; a change made meanwhile reaches the next window.
  a.with(() => S().closeWindow(aWork));
  assert.equal(a.with(() => S().parkedPins.default.tabs.length), 1);
  b.with(() => S().updateTab(Object.values(S().tabs).find((t) => t.pinned).id, { customTitle: "Mail" }));
  await syncAll([b, a]);
  const n = a.with(() => S().createWindow());
  await syncAll([a]);
  assert.deepEqual(tiles(a, n), ["https://mail.example/ Mail"]);
  assert.equal((await a.sync()).published, 0, "settled");
  const m = a.with(() => S().createWindow());
  assert.deepEqual(tiles(a, m), ["https://mail.example/ Mail"], "and the next window too");
  assert.equal((await a.sync()).published, 0, "copies publish nothing new");
});

test("passwords: saved on one Mac, changed or deleted on another; the newer edit of a login wins", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  const save = (d, origin, user, password) => d.with(() => stub.savePassword("", origin, user, password));
  const remove = (d, origin, user) => d.with(() => stub.deletePassword("", origin, user));
  const list = (d) => [...stub.passwordStores.get(d.id).values()].map((l) => `${l.url} ${l.username}=${l.password}`).sort();
  await save(a, "https://bank.example", "alice", "hunter2");
  await save(a, "https://mail.example", "alice", "m41l");
  await save(b, "https://shop.example", "bob", "sh0p");
  await syncAll([a, b]);
  assert.deepEqual(list(a), list(b));
  assert.deepEqual(list(b), ["https://bank.example alice=hunter2", "https://mail.example alice=m41l", "https://shop.example bob=sh0p"]);
  await save(b, "https://bank.example", "alice", "correct horse");
  await remove(b, "https://mail.example", "alice");
  await syncAll([b, a]);
  assert.deepEqual(list(a), ["https://bank.example alice=correct horse", "https://shop.example bob=sh0p"]);
  assert.equal((await a.sync()).published, 0);
});

// 0.2.20: history is Chrome's. Applying a record adds its visits to Chrome, whose copy then differs from the record
// (its own count, the other Mac's visits merged in); that must not read as an edit, or two Macs trade versions forever.
test("history: two Macs settle on the union of their visits in Chrome, publish nothing more, and deletions reach Chrome", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  for (const d of [a, b]) stub.historyDbs.delete(d.id);
  // What lib/history.ts does from Chrome's reports: the store's view is Chrome's history.
  const readChrome = async (d) => {
    stub.current.device = d.id;
    const entries = await stub.queryHistory("");
    d.with(() =>
      useBrowser.setState({
        history: { default: entries.map((e) => ({ ...e, favicon: null, lastVisit: e.visitTimes.at(-1) })) },
        historyReady: { default: true },
      }),
    );
  };
  const sync = async (d) => {
    await readChrome(d);
    return d.sync();
  };
  const visits = (d, url) => stub.historyDbs.get(d.id)?.get("")?.get(url)?.visits ?? [];
  const t = Date.now() - 3_600_000;
  const visit = (d, url, at) => d.with(() => ((stub.current.device = d.id), stub.chromeVisit("", url, url, at)));
  visit(a, "https://x.example/", t);
  visit(a, "https://x.example/", t + 1000);
  visit(b, "https://x.example/", t + 2000);
  visit(b, "https://y.example/", t + 3000);
  for (let i = 0; i < 3; i++) for (const d of [a, b]) await sync(d);
  assert.deepEqual(visits(a, "https://x.example/"), [t, t + 1000, t + 2000]);
  assert.deepEqual(visits(b, "https://x.example/"), [t, t + 1000, t + 2000]);
  assert.deepEqual(visits(a, "https://y.example/"), [t + 3000]);
  assert.equal((await sync(a)).published, 0, "settled on A");
  assert.equal((await sync(b)).published, 0, "settled on B");

  visit(b, "https://x.example/", t + 5000);
  await sync(b);
  await sync(a);
  assert.deepEqual(visits(a, "https://x.example/").at(-1), t + 5000, "a new visit is an edit");

  a.with(() => S().removeHistory("default", ["https://y.example/"]));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(visits(a, "https://y.example/"), []);
  await sync(a);
  await sync(b);
  assert.deepEqual(visits(b, "https://y.example/"), [], "deleted from B's Chrome");
  assert.equal((await sync(a)).published, 0);
  assert.equal((await sync(b)).published, 0);
});

// 0.2.20: bookmarks are Chrome's, named by UUID. A bookmark synced before keeps its old id as its record key (the
// node's syncKey), so a Mac not yet updated and an updated one name it alike: no renames, no duplicates.
test("bookmarks: a Mac on old ids and one on Chrome's UUIDs keep one tree", async () => {
  const { bookmarkUuidFor } = await import("../store/bookmarks.ts");
  const folder = new Folder();
  const old = new Device("devOld", folder);
  const now = new Device("devNew", folder);
  // The old Mac's store: its own ids, as before 0.2.20 (and as its records are keyed).
  old.with(() => {
    const roots = { bar: "bm-bar", other: "bm-other" };
    const n = (id, parentId, x) => ({ id, parentId, addedAt: 5, ...x });
    S().hydrate({
      bookmarks: {
        roots: { default: roots },
        nodes: {
          "bm-bar": n("bm-bar", null, { kind: "folder", title: "Bookmarks Bar", children: ["bm-f"] }),
          "bm-other": n("bm-other", null, { kind: "folder", title: "Other Bookmarks", children: [] }),
          "bm-f": n("bm-f", "bm-bar", { kind: "folder", title: "F", children: ["bm-a", "bm-b"] }),
          "bm-a": n("bm-a", "bm-f", { kind: "url", title: "A", url: "https://a.example/", favicon: null }),
          "bm-b": n("bm-b", "bm-f", { kind: "url", title: "B", url: "https://b.example/", favicon: null }),
        },
      },
    });
  });
  await old.sync();
  // The updated Mac moved the same bookmarks.json into Chrome: UUIDs, old ids as sync keys.
  now.with(() => {
    S().hydrate({ bookmarks: { nodes: {}, roots: {} } });
    useBrowser.setState({ bookmarksReady: { default: true } });
    const f = S().addBookmarkFolder({ profileId: "default", title: "F" });
    const a = S().addBookmark({ profileId: "default", url: "https://a.example/", title: "A", parentId: f });
    const b = S().addBookmark({ profileId: "default", url: "https://b.example/", title: "B", parentId: f });
    const nodes = { ...S().bookmarks.nodes };
    const rename = (id, legacy) => {
      const node = { ...nodes[id], id: bookmarkUuidFor(legacy), syncKey: legacy, addedAt: 5 };
      delete nodes[id];
      nodes[node.id] = node;
    };
    rename(f, "bm-f");
    rename(a, "bm-a");
    rename(b, "bm-b");
    const uf = bookmarkUuidFor("bm-f");
    nodes[uf] = { ...nodes[uf], children: [bookmarkUuidFor("bm-a"), bookmarkUuidFor("bm-b")] };
    for (const id of [bookmarkUuidFor("bm-a"), bookmarkUuidFor("bm-b")]) nodes[id] = { ...nodes[id], parentId: uf };
    const bar = S().bookmarks.roots.default.bar;
    nodes[bar] = { ...nodes[bar], children: [uf] };
    useBrowser.setState({ bookmarks: { ...S().bookmarks, nodes } });
  });
  await syncAll([now, old]);
  assert.deepEqual(tree(now), tree(old));
  assert.equal(now.with(() => Object.keys(S().bookmarks.nodes).length), 5, "no duplicates on the updated Mac");
  assert.equal(old.with(() => Object.keys(S().bookmarks.nodes).length), 5, "nor on the old one");
  assert.equal((await now.sync()).published, 0, "the updated Mac republishes nothing");

  // Edits both ways: the old Mac's reach the UUID node; the updated Mac's new bookmark is one node on the old Mac.
  // (This "old" Mac runs today's adapter, which names its nodes by UUID once it applies; it edits by sync key.)
  const onOld = (key) => old.with(() => Object.values(S().bookmarks.nodes).find((n) => (n.syncKey ?? n.id) === key).id);
  old.with(() => S().updateBookmark(onOld("bm-a"), { title: "A, renamed" }));
  now.with(() => S().addBookmark({ profileId: "default", url: "https://c.example/", title: "C", parentId: bookmarkUuidFor("bm-f") }));
  await syncAll([old, now]);
  assert.deepEqual(tree(now), tree(old));
  assert.deepEqual(tree(now).bar, { "Bookmarks Bar": [{ F: ["A, renamed=https://a.example/", "B=https://b.example/", "C=https://c.example/"] }] });
  assert.equal(now.with(() => S().bookmarks.nodes[bookmarkUuidFor("bm-a")]?.title), "A, renamed");
  old.with(() => S().removeBookmark(onOld("bm-b")));
  await syncAll([old, now]);
  assert.equal(now.with(() => S().bookmarks.nodes[bookmarkUuidFor("bm-b")]), undefined, "a deletion on the old Mac reaches the UUID node");
  assertTreeWhole(now);
  assertTreeWhole(old);
});
