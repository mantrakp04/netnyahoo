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

test("pinned tabs parked by a closed window still sync: not deleted elsewhere, and changes elsewhere reach them", async () => {
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
  assert.deepEqual(pins(b), ["https://cal.example/", "https://mail.example/"]);

  a.with(() => S().closeWindow(aHome));
  assert.equal(a.with(() => S().parkedPins.default.tabs.length), 2);
  await syncAll([a, b]);
  assert.deepEqual(pins(b), ["https://cal.example/", "https://mail.example/"], "still pinned on B");

  b.with(() => {
    const [mail, cal] = ["https://mail.example/", "https://cal.example/"].map((u) => Object.values(S().tabs).find((t) => t.pinnedUrl === u).id);
    S().updateTab(mail, { customTitle: "Inbox" });
    S().pinTabs([cal], false);
  });
  await syncAll([b, a]);
  const parked = a.with(() => S().parkedPins.default.tabs.map((t) => `${t.pinnedUrl} ${t.customTitle}`));
  assert.deepEqual(parked, ["https://mail.example/ Inbox"]);
  assert.equal(a.with(() => S().windows[aWork].tabIds.some((id) => S().tabs[id].pinned)), false, "nothing moved into A's other window");
  assert.equal((await a.sync()).published, 0, "settled");

  const n = a.with(() => S().createWindow());
  assert.deepEqual(a.with(() => model.viewTabIds(S(), n).filter((id) => S().tabs[id].pinned).map((id) => S().tabs[id].customTitle)), ["Inbox"]);
  assert.equal((await a.sync()).published, 0, "adopting them publishes nothing new");
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
