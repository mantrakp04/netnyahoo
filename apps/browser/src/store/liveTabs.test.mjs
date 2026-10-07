// Chrome's tab strips and the store (lib/chromeTabs.ts, store/liveTabs.ts) against a fake engine that keeps the
// contract (docs/store-api.md › "Live tabs"): commands run later than they're sent, transactions arrive later
// than they're made, and Chrome changes strips on its own in between.
import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;

class FakeChrome {
  rev = 0;
  strips = new Map();
  outbox = [];
  commands = [];
  sent = 0;
  lastCommand = 0;
  lastGroup = 0;
  nextBrowser = 1;
  listen(listener) {
    this.listener = listener;
    return { remove() {} };
  }
  snapshot() {
    return Promise.resolve({ rev: this.rev, cmd: null, strips: [...this.strips.keys()].map((id) => this.state(id)) });
  }
  command(command) {
    this.sent++;
    const id = ++this.lastCommand;
    this.commands.push({ id, command });
    return id;
  }
  state(id) {
    const s = this.strips.get(id);
    return {
      strip: id,
      window: id,
      ...(s.appWindow ? { appWindow: s.appWindow } : {}),
      activePickedOnClose: !!s.pickedOnClose,
      profile: "",
      tabs: s.tabs.map((t, index) => ({ key: t.key, browser: t.browser, index, active: t.browser === s.active, pinned: t.pinned, group: t.group ?? null })),
      groups: [...s.groups].filter(([id]) => s.tabs.some((t) => t.group === id)).map(([id, g]) => ({ id, ...g })),
    };
  }
  emit(id, cmd, ...more) {
    this.outbox.push({ rev: ++this.rev, cmd, strips: [id, ...more].map((x) => this.state(x)) });
  }
  strip(id) {
    if (!this.strips.has(id)) this.strips.set(id, { tabs: [], active: 0, groups: new Map() });
    return this.strips.get(id);
  }
  find(key) {
    for (const [id, s] of this.strips) {
      const i = s.tabs.findIndex((t) => t.key === key);
      if (i >= 0) return { id, s, i, tab: s.tabs[i] };
    }
    return null;
  }
  // The app's view made a browser for the tab (cmd -1): appended, in the background.
  create(stripId, key) {
    const s = this.strip(stripId);
    const browser = this.nextBrowser++;
    s.tabs.push({ key, browser, pinned: false });
    if (!s.active) s.active = browser;
    this.emit(stripId, -1);
  }
  // Chrome makes a tab on its own (an extension's tabs.create), in front or behind: no view holds it yet, so it has
  // no key until the app adopts it (its openWindow, adoptId "tab:<browser>", comes after this transaction).
  made(stripId, active) {
    const s = this.strip(stripId);
    const browser = this.nextBrowser++;
    s.tabs.push({ key: null, browser, pinned: false });
    if (active) {
      s.active = browser;
      s.pickedOnClose = false;
    }
    this.emit(stripId, null);
    return browser;
  }
  // The app's view took Chrome's tab: it has the view's key from now on.
  adopted(browser, key) {
    for (const [id, s] of this.strips) {
      const t = s.tabs.find((t) => t.browser === browser);
      if (t) (t.key = key), this.emit(id, null);
    }
  }
  // A view lets its browser go without closing it (a tab parked on its way to another window): no key any more.
  parked(key) {
    const f = this.find(key);
    f.tab.key = null;
    this.emit(f.id, null);
  }
  // Chrome closes a tab; when it was the active one it shows the next (TabStripModel::DetermineNewSelectedIndex).
  remove(key) {
    const f = this.find(key);
    if (!f) return;
    this.drop(f);
    this.emit(f.id, null);
  }
  drop(f) {
    f.s.tabs.splice(f.i, 1);
    if (f.s.active === f.tab.browser) {
      f.s.active = (f.s.tabs[f.i] ?? f.s.tabs[f.i - 1])?.browser ?? 0;
      f.s.pickedOnClose = true;
    }
  }
  // An extension closes a tab and activates another in one go: one change.
  removeAndActivate(key, other) {
    const f = this.find(key);
    this.drop(f);
    f.s.active = this.find(other).tab.browser;
    f.s.pickedOnClose = false;
    this.emit(f.id, null);
  }
  // An extension moves a tab to another window (chrome.tabs.move with windowId), in front there.
  moveTo(key, stripId) {
    const f = this.find(key);
    this.drop(f);
    const to = this.strip(stripId);
    to.tabs.push(f.tab);
    to.active = f.tab.browser;
    to.pickedOnClose = false;
    this.emit(f.id, null, stripId);
  }
  // An extension (cmd null).
  move(key, index) {
    const f = this.find(key);
    f.s.tabs.splice(f.i, 1);
    f.s.tabs.splice(index, 0, f.tab);
    // As Chrome: between two tabs of a group it joins the group, elsewhere it leaves its own.
    const [prev, next] = [f.s.tabs[index - 1]?.group, f.s.tabs[index + 1]?.group];
    f.tab.group = prev && prev === next ? prev : f.tab.group && [prev, next].includes(f.tab.group) ? f.tab.group : null;
    this.emit(f.id, null);
  }
  reorder(stripId, keys) {
    const s = this.strips.get(stripId);
    s.tabs.sort((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key));
    this.emit(stripId, null);
  }
  // tabs.group / tabGroups.update: Chrome groups tabs (contiguous, as Chrome keeps them).
  group(keys, title, color = "blue") {
    const f = this.find(keys[0]);
    const id = `g${++this.lastGroup}`;
    f.s.groups.set(id, { title, color, collapsed: false });
    this.regroup(f.s, keys, id);
    this.emit(f.id, null);
    return id;
  }
  regroup(s, keys, id) {
    const moving = s.tabs.filter((t) => keys.includes(t.key) && !t.pinned);
    const at = s.tabs.indexOf(moving[0]);
    for (const t of moving) t.group = id;
    s.tabs = s.tabs.filter((t) => !moving.includes(t));
    s.tabs.splice(Math.min(at, s.tabs.length), 0, ...moving);
  }
  collapse(id, collapsed) {
    for (const [sid, s] of this.strips) if (s.groups.has(id)) { s.groups.get(id).collapsed = collapsed; this.emit(sid, null); }
  }
  retitle(id, title) {
    for (const [sid, s] of this.strips) if (s.groups.has(id)) { s.groups.get(id).title = title; this.emit(sid, null); }
  }
  pin(key, pinned) {
    const f = this.find(key);
    f.tab.pinned = pinned;
    f.s.tabs.splice(f.i, 1);
    const at = pinned ? f.s.tabs.filter((t) => t.pinned).length : f.s.tabs.length;
    f.s.tabs.splice(at, 0, f.tab);
    this.emit(f.id, null);
  }
  activate(key, cmd = null) {
    const f = this.find(key);
    f.s.active = f.tab.browser;
    f.s.pickedOnClose = false;
    this.emit(f.id, cmd);
  }
  // Runs the next command the app sent, as the engine does: Chrome's pending changes already went out.
  runOne() {
    const next = this.commands.shift();
    if (!next) return false;
    const { id, command } = next;
    const s = this.strips.get(command.strip);
    const has = (key) => s?.tabs.some((t) => t.key === key);
    if (command.op === "activate" && has(command.key)) {
      s.active = s.tabs.find((t) => t.key === command.key).browser;
      s.pickedOnClose = false;
      this.emit(command.strip, id);
    } else if (command.op === "group" && command.keys.some(has)) {
      const keys = command.keys.filter(has);
      let token = command.group;
      if (token === "new") s.groups.set((token = `g${++this.lastGroup}`), { title: command.title ?? "", color: command.color ?? "grey", collapsed: false });
      if (token) {
        if (command.title !== undefined) Object.assign(s.groups.get(token), { title: command.title, color: command.color });
        if (command.collapsed !== undefined) s.groups.get(token).collapsed = command.collapsed;
        this.regroup(s, keys, token);
      } else for (const t of s.tabs) if (keys.includes(t.key)) t.group = null;
      this.emit(command.strip, id);
    } else if (command.op === "arrange" && command.keys.some(has)) {
      const listed = command.keys.filter(has).map((key) => s.tabs.find((t) => t.key === key));
      listed.forEach((t, i) => (t.pinned = i < command.pinned));
      s.tabs = [...listed, ...s.tabs.filter((t) => !listed.includes(t))];
      this.emit(command.strip, id);
    } else {
      this.outbox.push({ rev: ++this.rev, cmd: id, strips: [], rejected: true });
    }
    return true;
  }
  deliver() {
    const out = this.outbox;
    this.outbox = [];
    for (const tx of out) this.listener(tx);
    return out.length;
  }
}

const chrome = new FakeChrome();
globalThis.nnTestTabStrip = chrome;
const { useBrowser } = await import("./browser.ts");
const model = await import("./model.ts");
const { startChromeTabs } = await import("../lib/chromeTabs.ts");
startChromeTabs();

const S = () => useBrowser.getState();
const tick = () => new Promise((r) => setImmediate(r));
const urlOf = (id) => S().tabs[id].url.replace(/^https:\/\/|\.com\/?$/g, "");
const shown = (w) => urlOf(model.activeTabId(S(), w));
const shownIn = (w) => urlOf(S().windows[w].activeTabIds[S().windows[w].profileId]);
const order = (w) => S().windows[w].tabIds.map(urlOf);
const chromeOrder = (strip) => chrome.strips.get(strip).tabs.map((t) => urlOf(t.key));
const chromeShown = (strip) => urlOf(chrome.strips.get(strip).tabs.find((t) => t.browser === chrome.strips.get(strip).active).key);

let nextStrip = 1;
// One window whose tabs live in a strip of their own. Its views make browsers as the store loads tabs.
function windowWith(...urls) {
  S().hydrate({});
  S().updateSettings({ cmdClickCreatesTabGroup: false, newTabPosition: "bottom" });
  return anotherWindow(...urls);
}
function anotherWindow(...urls) {
  const w = S().createWindow({ url: urls[0] ? `${urls[0]}.com` : undefined });
  for (const u of urls.slice(1)) S().newTab(w, { url: `${u}.com`, background: true });
  const strip = nextStrip++;
  chrome.strip(strip).appWindow = w;
  return { w, strip };
}
// What ContentCard does: a browser for every loaded tab, none for closed ones.
function mountViews({ w, strip }) {
  for (const id of S().windows[w]?.tabIds ?? []) {
    const t = S().tabs[id];
    if ((t.navigation || t.adoptId) && !chrome.find(id)) chrome.create(strip, id);
  }
  for (const s of chrome.strips.values()) for (const t of [...s.tabs]) if (!S().tabs[t.key]) chrome.remove(t.key);
}
// Lets every message cross until nothing moves; returns how many transactions crossed.
async function settle(win) {
  let crossed = 0;
  for (let i = 0; i < 200; i++) {
    await tick();
    if (win) mountViews(win);
    const delivered = chrome.deliver();
    crossed += delivered;
    await tick();
    const ran = chrome.runOne();
    if (!delivered && !ran && !chrome.outbox.length && !chrome.commands.length) return crossed;
  }
  throw new Error("never settled: commands and transactions kept coming");
}

await settle();

test("the app's own switches never come back as switches, however late Chrome reports them", async () => {
  const win = windowWith("a");
  await settle(win);
  let switches = 0;
  const stop = useBrowser.subscribe((s, prev) => {
    const a = s.windows[win.w]?.activeTabIds[s.windows[win.w].profileId];
    const b = prev.windows[win.w]?.activeTabIds[prev.windows[win.w].profileId];
    if (a !== b) switches++;
  });
  // Twenty tabs opened faster than Chrome runs the app's commands: each activation lands after the store has
  // moved on, and its transaction arrives after that.
  for (let i = 0; i < 20; i++) {
    S().newTab(win.w, { url: `t${i}.com` });
    mountViews(win);
    chrome.deliver();
    await tick();
    if (i % 4 === 3) chrome.runOne();
  }
  const crossed = await settle(win);
  stop();
  assert.equal(switches, 20, "one switch per tab opened, none back");
  assert.equal(shown(win.w), "t19");
  assert.equal(chromeShown(win.strip), "t19", "Chrome shows what the app shows");
  assert.deepEqual(chromeOrder(win.strip), order(win.w));
  assert.ok(crossed < 80, `bounded traffic (${crossed} transactions)`);
});

test("an extension's move, pin and activation reach the sidebar", async () => {
  const win = windowWith("a", "b", "c", "d");
  await settle(win);
  const [a, , c, d] = S().windows[win.w].tabIds;
  chrome.move(d, 0);
  await settle(win);
  assert.deepEqual(order(win.w), ["d", "a", "b", "c"]);
  chrome.pin(c, true);
  await settle(win);
  assert.equal(S().tabs[c].pinned, true);
  assert.deepEqual(order(win.w), ["c", "d", "a", "b"]);
  chrome.activate(d);
  await settle(win);
  assert.equal(shown(win.w), "d");
  assert.deepEqual(chromeOrder(win.strip), order(win.w), "Chrome and the sidebar agree");
  assert.equal(S().tabs[a].pinned, false);
  // Moved between two tabs of a group, a tab joins it (as in Chrome); the group's tabs stay in it.
  const id = (u) => S().windows[win.w].tabIds.find((t) => urlOf(t) === u);
  const g = S().groupTabs([id("a"), id("b")], { pinned: false });
  await settle(win);
  assert.deepEqual(order(win.w), ["c", "d", "a", "b"]);
  chrome.move(d, 2);
  await settle(win);
  assert.deepEqual(order(win.w), ["c", "a", "d", "b"]);
  assert.deepEqual(S().groups[g].tabIds.map(urlOf), ["a", "d", "b"]);
  assert.deepEqual(chromeOrder(win.strip), order(win.w));
  // Several tabs moved in one change land in Chrome's order.
  chrome.reorder(win.strip, ["c", "b", "d", "a"].map(id));
  await settle(win);
  assert.deepEqual(order(win.w), ["c", "b", "d", "a"]);
  assert.deepEqual(chromeOrder(win.strip), order(win.w));
});

test("the tab Chrome shows after a close doesn't override the app's successor rule", async () => {
  const win = windowWith("a", "b");
  const [a] = S().windows[win.w].tabIds;
  // A link of a's, opened behind, lines up after it; closing it goes back to a (store/openers.ts), while
  // Chrome's own rule shows the tab after it, b.
  const c = S().newTab(win.w, { url: "c.com", openerId: a, background: true });
  await settle(win);
  assert.deepEqual(order(win.w), ["a", "c", "b"]);
  S().activate(c);
  await settle(win);
  S().closeTab(c);
  await settle(win);
  assert.equal(shown(win.w), "a", "the store's pick stands");
  assert.equal(chromeShown(win.strip), "a", "and Chrome shows it too");
});

test("a command on its way wins over Chrome's earlier change; stale transactions are dropped", async () => {
  const win = windowWith("a", "b", "c");
  await settle(win);
  const [a, b, c] = S().windows[win.w].tabIds;
  S().activate(c);
  await settle(win);
  S().activate(b);
  await tick();
  // An extension shows a before the app's command for b runs: the command comes later and wins.
  chrome.activate(a);
  await settle(win);
  assert.equal(shown(win.w), "b");
  assert.equal(chromeShown(win.strip), "b");
  // A transaction from before the last one applied changes nothing.
  const before = S().windows[win.w];
  chrome.listener({ rev: chrome.rev - 1, cmd: null, strips: [{ ...chrome.state(win.strip), tabs: [] }] });
  assert.equal(S().windows[win.w], before);
});

test("an extension's tab groups reach the sidebar, and the sidebar's groups reach Chrome", async () => {
  const win = windowWith("a", "b", "c", "d");
  await settle(win);
  const id = (u) => S().windows[win.w].tabIds.find((t) => urlOf(t) === u);
  const ext = chrome.group([id("b"), id("c")], "Reading");
  await settle(win);
  const made = Object.values(S().groups).find((g) => g.windowId === win.w);
  assert.ok(made, "the store made the group");
  assert.deepEqual(made.tabIds.map(urlOf), ["b", "c"]);
  assert.equal(made.name, "Reading");
  assert.equal(made.color, "blue");
  chrome.retitle(ext, "Later");
  await settle(win);
  assert.equal(S().groups[made.id].name, "Later");
  // The sidebar groups a and d: Chrome gets a group for them, with the store's name.
  const mine = S().groupTabs([id("d"), id("a")], { pinned: false, name: "Mine" });
  await settle(win);
  const strip = chrome.strips.get(win.strip);
  const tokens = new Set(strip.tabs.filter((t) => [id("a"), id("d")].includes(t.key)).map((t) => t.group));
  assert.equal(tokens.size, 1);
  const token = [...tokens][0];
  assert.ok(token && token !== ext);
  assert.equal(strip.groups.get(token).title, "Mine");
  assert.deepEqual(chromeOrder(win.strip), order(win.w));
  assert.ok(S().groups[mine]);
  // A whole group moved in Chrome stays a group; a rename in the sidebar alone reaches Chrome.
  const before = order(win.w);
  const groupKeys = S().groups[made.id].tabIds;
  chrome.reorder(win.strip, [...groupKeys, ...S().windows[win.w].tabIds.filter((t) => !groupKeys.includes(t))]);
  await settle(win);
  assert.notDeepEqual(order(win.w), before);
  assert.deepEqual(S().groups[made.id].tabIds, groupKeys);
  assert.deepEqual(chromeOrder(win.strip), order(win.w));
  S().updateGroup(mine, { name: "Renamed" });
  await settle(win);
  assert.equal(chrome.strips.get(win.strip).groups.get(token).title, "Renamed");
});

test("an extension that closes the shown tab and shows another in one go is obeyed", async () => {
  const win = windowWith("a", "b");
  const [a, b] = S().windows[win.w].tabIds;
  // c, opened behind from a, shown: closing it on its own would go back to a (the opener rule).
  const c = S().newTab(win.w, { url: "c.com", openerId: a, background: true });
  await settle(win);
  S().activate(c);
  await settle(win);
  chrome.removeAndActivate(c, b);
  S().closeTab(c);
  await settle(win);
  assert.equal(shown(win.w), "b", "the extension's tab, not the opener rule's");
  assert.equal(chromeShown(win.strip), "b");
  assert.ok(S().tabs[a]);
});

test("an extension moving a tab into a window of New Tab pages, or into a one-tab window, moves it there", async () => {
  const one = windowWith("a", "b");
  await settle(one);
  const empty = anotherWindow();
  await settle(one);
  const [, b] = S().windows[one.w].tabIds;
  chrome.moveTo(b, empty.strip);
  await settle(one);
  assert.equal(S().tabs[b].windowId, empty.w, "the window the engine named");
  assert.equal(shownIn(empty.w), "b");
  // The last tab of a window into a window with one tab: the engine names the window, nothing to guess.
  const lone = anotherWindow("c");
  await settle(lone);
  const [a] = S().windows[one.w].tabIds;
  chrome.moveTo(a, lone.strip);
  await settle(lone);
  assert.equal(S().tabs[a].windowId, lone.w);
  assert.deepEqual(S().windows[lone.w].tabIds.map(urlOf), ["c", "a"]);
});

test("as in Dia: an extension pinning one pane of a split leaves the split; collapsing goes both ways", async () => {
  const win = windowWith("a", "b", "c");
  const [a, b, c] = S().windows[win.w].tabIds;
  S().createSplit([a, b]);
  await settle(win);
  chrome.pin(b, true);
  await settle(win);
  assert.equal(S().tabs[b].pinned, false, "the pane isn't pinned");
  assert.ok(Object.values(S().splits).some((v) => v.tabIds.includes(a) && v.tabIds.includes(b)), "the split stays");
  assert.equal(chrome.find(b).tab.pinned, false, "Chrome is put back");
  // A group collapsed in the sidebar is collapsed for extensions, and the other way; the shown tab stays.
  S().activate(c);
  const g = S().groupTabs([c], { pinned: false, name: "C" });
  await settle(win);
  S().updateGroup(g, { collapsed: true });
  await settle(win);
  const token = chrome.find(c).tab.group;
  assert.equal(chrome.find(c).s.groups.get(token).collapsed, true);
  assert.equal(chromeShown(win.strip), "c");
  chrome.collapse(token, false);
  await settle(win);
  assert.equal(S().groups[g].collapsed, false);
  assert.equal(shown(win.w), "c");
});

test("an extension's new tab is shown when Chrome made it in front, and stays behind when Chrome made it behind", async () => {
  const win = windowWith("a");
  await settle(win);
  const [a] = S().windows[win.w].tabIds;
  for (const [active, url, expected] of [[true, "e", "e"], [false, "f", "e"]]) {
    // Chrome's tab is in the strip, without a key, before the app hears of it: the app doesn't put its own shown tab
    // back over it meanwhile.
    const browser = chrome.made(win.strip, active);
    await settle();
    // The app's view announces it (openFromPage: a new tab of the window, in front), then takes it.
    const id = S().newTab(win.w, { url: `${url}.com`, adoptId: `tab:${browser}`, openerId: a });
    await settle();
    chrome.adopted(browser, id);
    await settle(win);
    assert.equal(shown(win.w), expected, `tabs.create({ active: ${active} })`);
    assert.equal(chromeShown(win.strip), expected, "Chrome shows what the app shows");
    assert.deepEqual(chromeOrder(win.strip), order(win.w));
  }
});

test("a switch while Chrome's new tab waits for the app wins; a parked tab Chrome still shows doesn't hold the strip", async () => {
  const win = windowWith("a", "b");
  await settle(win);
  const [a, b] = S().windows[win.w].tabIds;
  // The user picks b after the extension's tab appeared in Chrome, after the app opened it: b stays shown.
  const browser = chrome.made(win.strip, true);
  await settle();
  const id = S().newTab(win.w, { url: "g.com", adoptId: `tab:${browser}`, openerId: a });
  await settle();
  S().activate(b);
  await settle();
  assert.equal(chromeShown(win.strip), "b", "the switch reaches Chrome before the adoption");
  chrome.adopted(browser, id);
  await settle(win);
  assert.equal(shown(win.w), "b");
  assert.equal(chromeShown(win.strip), "b");
  // b's browser parked (keyless, still Chrome's active tab): the store's switch to a still goes out.
  chrome.parked(b);
  await settle();
  S().activate(a);
  await settle();
  assert.equal(chromeShown(win.strip), "a");
});
