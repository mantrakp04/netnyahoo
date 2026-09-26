// The sync adapters against the real store: two "devices" take turns with the one store
// (each keeps its own state and swaps it in to sync), through an in-memory sync folder.
// Run from apps/browser:  node --import ./src/sync/test-loader.mjs --test src/sync/adapters.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../store/browser.ts");
const model = await import("../store/model.ts");
const { Clock, emptyScope, syncScope } = await import("@netnyahoo/sync");
const adapters = await import("./adapters.ts");
const stub = await import("./test-native-stub.mjs");

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
    this.browser = S();
    this.scopes = { app: emptyScope(), p: emptyScope() };
    this.clock = new Clock(id);
    stub.passwordStores.set(id, new Map());
    this.passwords = adapters.passwordsAdapter("default", () => true, stub.readLogins);
  }
  /** Runs `fn` with this device's state in the store. */
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
      syncScope({ scope, state: this.scopes[scope], transport: this.folder.transport(), adapters: list, clock: this.clock, device: this.id, options });
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

/** A profile's bookmark tree as nested titles (url after "="). */
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

/** Every folder's children exist, every node's parent lists it: the tree is whole. */
function assertTreeWhole(device) {
  device.with(() => {
    const b = S().bookmarks;
    for (const n of Object.values(b.nodes)) {
      if (n.parentId) assert.ok(b.nodes[n.parentId]?.children.includes(n.id), `${n.title} is in its parent`);
      if (n.kind === "folder") for (const c of n.children) assert.equal(b.nodes[c]?.parentId, n.id);
    }
  });
}

test("bookmarks: a tree made on one Mac appears on the other, then edits flow back", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.with(() => {
    const f = S().addBookmarkFolder({ profileId: "default", title: "Work" });
    S().addBookmark({ profileId: "default", url: "https://docs.example/", title: "Docs", parentId: f });
    S().addBookmark({ profileId: "default", url: "https://mail.example/", title: "Mail" });
    const other = S().bookmarks.roots.default.other;
    S().addBookmark({ profileId: "default", url: "https://later.example/", title: "Later", parentId: other });
  });
  await syncAll([a, b]);
  assert.deepEqual(tree(b), tree(a));
  // Steady state: nothing more to publish on either side.
  assert.equal((await a.sync()).published, 0);
  assert.equal((await b.sync()).published, 0);

  b.with(() => {
    const nodes = Object.values(S().bookmarks.nodes);
    const mail = nodes.find((n) => n.title === "Mail");
    const work = nodes.find((n) => n.title === "Work");
    S().updateBookmark(mail.id, { title: "Inbox" });
    S().moveBookmark(mail.id, S().bookmarks.roots.default.bar, 0);
    S().removeBookmark(nodes.find((n) => n.title === "Later").id);
    S().addBookmark({ profileId: "default", url: "https://spec.example/", title: "Spec", parentId: work.id, index: 0 });
  });
  await syncAll([b, a]);
  assert.deepEqual(tree(a), tree(b));
  assert.deepEqual(tree(a).bar, { "Bookmarks Bar": ["Inbox=https://mail.example/", { Work: ["Spec=https://spec.example/", "Docs=https://docs.example/"] }] });
  assert.deepEqual(tree(a).other, { "Other Bookmarks": [] });
  assertTreeWhole(a);
});

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

test("history: visits sync, deletions sync, pages older than 90 days stay where they are", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  const old = Date.now() - 200 * 86_400_000;
  a.with(() => {
    S().recordVisit("default", "https://news.example/", "News", null, true);
    S().recordVisit("default", "https://blog.example/", "Blog", null, true);
    S().importHistory("default", [{ url: "https://ancient.example/", title: "Ancient", visits: 3, lastVisit: old }]);
  });
  b.with(() => S().importHistory("default", [{ url: "https://b-ancient.example/", title: "B's old page", visits: 1, lastVisit: old }]));
  await syncAll([a, b]);
  const urls = (d) => d.with(() => (S().history.default ?? []).map((h) => h.url).sort());
  assert.deepEqual(urls(b), ["https://b-ancient.example/", "https://blog.example/", "https://news.example/"]);
  assert.ok(urls(a).includes("https://ancient.example/"));
  b.with(() => S().removeHistory("default", ["https://news.example/"]));
  await syncAll([b, a]);
  assert.ok(!urls(a).includes("https://news.example/"));
  assert.ok(urls(a).includes("https://ancient.example/"), "old history is never deleted by sync");
  assert.equal(b.with(() => S().history.default.find((h) => h.url === "https://blog.example/").title), "Blog");
});

test("settings: a Mac that joins takes the synced settings; a change later syncs back", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  a.with(() => S().updateSettings({ appearance: "dark", searchEngine: "duckduckgo", sidebarWidth: 300 }));
  await syncAll([a]);
  const b = new Device("devB", folder);
  b.scopes.app.awaitRemote = true;
  b.with(() => S().updateSettings({ appearance: "light", sidebarWidth: 222 }));
  await syncAll([b, a, b]);
  const pick = (d) => d.with(() => ({ appearance: S().settings.appearance, searchEngine: S().settings.searchEngine, sidebarWidth: S().settings.sidebarWidth }));
  assert.deepEqual(pick(b), { appearance: "dark", searchEngine: "duckduckgo", sidebarWidth: 222 });
  b.with(() => S().updateSettings({ showFullUrl: true }));
  await syncAll([b, a]);
  assert.equal(a.with(() => S().settings.showFullUrl), true);
  assert.equal(a.with(() => S().settings.sidebarWidth), 300, "window sizes stay per Mac");
  // Settings whose value is null (Clean Up Daily off) settle too: nothing bounces between Macs.
  assert.equal(a.with(() => S().settings.cleanUpInactiveTabsAfterHours), null);
  for (let i = 0; i < 2; i++) {
    assert.equal((await a.sync()).published, 0);
    assert.equal((await b.sync()).published, 0);
  }
  b.with(() => S().updateSettings({ cleanUpInactiveTabsAfterHours: 24 }));
  await syncAll([b, a]);
  assert.equal(a.with(() => S().settings.cleanUpInactiveTabsAfterHours), 24);
  b.with(() => S().updateSettings({ cleanUpInactiveTabsAfterHours: null }));
  await syncAll([b, a]);
  assert.equal(a.with(() => S().settings.cleanUpInactiveTabsAfterHours), null);
});

test("pinned tabs and pinned groups: tiles arrive unloaded, in order, and unpinning removes them elsewhere", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.with(() => {
    const w = S().createWindow({ url: "https://mail.example/" });
    const mail = model.viewTabIds(S(), w)[0];
    const cal = S().newTab(w, { url: "https://cal.example/" });
    const x = S().newTab(w, { url: "https://x.example/" });
    const y = S().newTab(w, { url: "https://y.example/" });
    S().newTab(w, { url: "https://regular.example/" });
    S().pinTabs([mail, cal], true);
    S().groupTabs([x, y], { pinned: true, name: "Research" });
  });
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  const pinnedView = (d) =>
    d.with(() => {
      const s = S();
      const w = s.windowOrder[0];
      return model.viewTabIds(s, w).map((id) => {
        const t = s.tabs[id];
        const g = Object.values(s.groups).find((gr) => gr.tabIds.includes(id));
        return `${t.pinned ? "pin" : g?.pinned ? `grp:${g.name}` : "tab"} ${t.pinnedUrl || t.url}`;
      });
    });
  assert.deepEqual(pinnedView(b), [
    "pin https://mail.example/",
    "pin https://cal.example/",
    "grp:Research https://x.example/",
    "grp:Research https://y.example/",
    "tab https://b-home.example/",
  ]);
  assert.ok(b.with(() => Object.values(S().tabs).filter((t) => t.pinned).every((t) => t.unloaded)), "synced tiles don't load until selected");
  assert.equal((await b.sync()).published, 0);
  assert.equal((await a.sync()).published, 0);

  // B unpins Calendar and moves Mail after it... (unpinned = gone from the pinned container)
  b.with(() => {
    const cal = Object.values(S().tabs).find((t) => t.url === "https://cal.example/");
    S().pinTabs([cal.id], false);
  });
  await syncAll([b, a]);
  assert.deepEqual(pinnedView(a).filter((l) => !l.startsWith("tab")), ["pin https://mail.example/", "grp:Research https://x.example/", "grp:Research https://y.example/"]);
  assert.equal(a.with(() => Object.values(S().tabs).some((t) => t.url === "https://cal.example/")), false);
});

test("open tabs: each device publishes its own tabs record only", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.with(() => S().createWindow({ url: "https://a-open.example/" }));
  b.with(() => S().createWindow({ url: "https://b-open.example/" }));
  await syncAll([a, b]);
  const records = b.scopes.p.records;
  assert.deepEqual(records["tabs:devA"].v.tabs.map((t) => t.u), ["https://a-open.example/"]);
  assert.equal(records["tabs:devA"].v.n, "devA's MacBook Pro");
  assert.deepEqual(records["tabs:devB"].v.tabs.map((t) => t.u), ["https://b-open.example/"]);
  // B's own window is untouched by A's tabs.
  assert.deepEqual(b.with(() => Object.values(S().tabs).map((t) => t.url)), ["https://b-open.example/"]);
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
