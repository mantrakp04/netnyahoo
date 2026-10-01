import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const model = await import("./model.ts");

// Chrome's opener rules (store/openers.ts). Run: node --import ./src/store/test-loader.mjs --test src/store/openers.test.mjs

const S = () => useBrowser.getState();
const reset = (settings = {}) => {
  S().hydrate({});
  S().updateSettings({ cmdClickCreatesTabGroup: false, newTabPosition: "bottom", ...settings });
};
const hosts = (w) => S().windows[w].tabIds.map((id) => S().tabs[id].url.replace(/^https:\/\/|\.com$/g, ""));
const active = (w) => S().tabs[model.activeTabId(S(), w)].url.replace(/^https:\/\/|\.com$/g, "");
const open = (w, url, opener, background = true) => S().newTab(w, { url: `${url}.com`, openerId: opener, background });
const setup = (...urls) => {
  const w = S().createWindow({ url: `${urls[0]}.com` });
  const ids = [S().windows[w].tabIds[0], ...urls.slice(1).map((u) => S().newTab(w, { url: `${u}.com` }))];
  S().activate(ids[0]);
  return [w, ...ids];
};

test("links opened behind line up after their opener in order", () => {
  reset();
  const [w, a] = setup("a", "b");
  open(w, "c1", a);
  open(w, "c2", a);
  open(w, "c3", a);
  assert.deepEqual(hosts(w), ["a", "c1", "c2", "c3", "b"]);
  assert.equal(active(w), "a", "opened behind: the opener stays in front");
});

test("switching to a tab another page opened forgets the run; the next link goes right after the opener", () => {
  reset();
  const [w, a, b] = setup("a", "b");
  open(w, "c1", a);
  open(w, "c2", a);
  S().activate(b);
  S().activate(a);
  open(w, "c3", a);
  assert.deepEqual(hosts(w), ["a", "c1", "c2", "c3", "b"], "Chrome keeps openers across tabs no page opened");
  S().activate(b);
  const d = open(w, "d", b);
  S().activate(d);
  S().activate(a);
  open(w, "c4", a);
  assert.deepEqual(hosts(w), ["a", "c4", "c1", "c2", "c3", "b", "d"]);
});

test("moving between an opener and the tabs it opened keeps the run, grandchildren included", () => {
  reset();
  const [w, a] = setup("a", "b");
  const c1 = open(w, "c1", a);
  S().activate(c1);
  open(w, "g1", c1);
  S().activate(a);
  open(w, "c2", a);
  assert.deepEqual(hosts(w), ["a", "c1", "g1", "c2", "b"]);
});

test("a link opened in front goes right after its opener and ends the run", () => {
  reset();
  const [w, a] = setup("a", "b");
  const c1 = open(w, "c1", a);
  open(w, "f", a, false);
  assert.deepEqual(hosts(w), ["a", "f", "c1", "b"]);
  assert.equal(active(w), "f");
  assert.equal(S().tabs[c1].openerId, null);
});

test("typing an address forgets the openers", () => {
  reset();
  const [w, a] = setup("a", "b");
  open(w, "c1", a);
  S().navigate(a, "elsewhere.com");
  open(w, "c2", a);
  assert.deepEqual(hosts(w), ["a", "c2", "c1", "b"]);
});

test("closing a page opened in front returns to its opener unless you moved away", () => {
  reset();
  const [w, a, b] = setup("a", "b");
  const c = open(w, "c", a, false);
  S().closeTab(c);
  assert.equal(active(w), "a");

  const d = open(w, "d", a, false);
  S().activate(b);
  S().activate(d);
  S().closeTab(d);
  assert.equal(active(w), "b", "after moving away, the tab after it");
});

test("closing goes to the page's own tabs, then its siblings, then its opener", () => {
  reset();
  const [w, a] = setup("a", "b");
  const c1 = open(w, "c1", a);
  const c2 = open(w, "c2", a);
  S().activate(c1);
  const g = open(w, "g", c1);
  S().closeTab(c1);
  assert.equal(active(w), "g", "a tab it opened");
  assert.equal(S().tabs[g].openerId, a, "a closed tab's tabs take its opener");
  S().activate(a);
  S().activate(c2);
  S().closeTab(c2);
  assert.equal(active(w), "g", "a sibling");
  S().closeTab(g);
  assert.equal(active(w), "a", "no siblings left: the opener");
});

test("links from a pinned tab keep their order with new tabs at the top", () => {
  reset({ newTabPosition: "top" });
  const [w, a] = setup("a", "b");
  S().togglePin(a);
  S().activate(a);
  open(w, "c1", a);
  open(w, "c2", a);
  assert.deepEqual(hosts(w), ["a", "c1", "c2", "b"]);
  S().activate(S().windows[w].tabIds[3]);
  S().newTab(w, { url: "top.com" });
  assert.equal(hosts(w)[1], "top", "⌘T still opens at the top");
});

test("a link from a grouped tab joins the group, in front or behind", () => {
  reset();
  const [w, a, b] = setup("a", "b", "x");
  const g = S().createGroup([a, b]);
  const f = open(w, "f", a, false);
  S().activate(a);
  const c = open(w, "c", a);
  assert.deepEqual(hosts(w), ["a", "f", "c", "b", "x"]);
  assert.deepEqual(S().groups[g].tabIds, S().windows[w].tabIds.slice(0, 4));
  assert.ok(S().groups[g].tabIds.includes(f) && S().groups[g].tabIds.includes(c));
});

test("a link from a split pane goes after the split and groups the whole split", () => {
  reset({ cmdClickCreatesTabGroup: true });
  const [w, a] = setup("a", "x");
  const { tabId: b } = S().openSplitPane(w, { url: "b.com", anchorTabId: a });
  S().activate(a);
  const c = open(w, "c", a);
  assert.deepEqual(hosts(w), ["a", "b", "c", "x"]);
  const group = Object.values(S().groups)[0];
  assert.deepEqual(group.tabIds, [a, b, c]);
});

test("links from a pane of a split of two existing tabs keep their order", () => {
  reset();
  const [w, a, b] = setup("a", "b", "x");
  S().createSplit([a, b]);
  S().activate(a);
  open(w, "c1", a);
  open(w, "c2", a);
  assert.deepEqual(hosts(w), ["a", "b", "c1", "c2", "x"]);
});

test("links a Small Yahu page sends keep their order in the main window", () => {
  reset({ newTabPosition: "top" });
  const main = S().createWindow({ url: "a.com" });
  const small = S().createWindow({ small: true, url: "s.com" });
  const page = S().windows[small].tabIds[0];
  open(small, "c1", page);
  open(small, "c2", page);
  assert.deepEqual(hosts(main), ["c1", "c2", "a"]);
  assert.equal(active(main), "a");
});

test("links opened behind from a pinned tab gather in a group below the pinned tabs", () => {
  reset({ cmdClickCreatesTabGroup: true });
  const [w, a, b] = setup("a", "b");
  S().togglePin(a);
  S().activate(a);
  const c1 = open(w, "c1", a);
  const c2 = open(w, "c2", a);
  assert.deepEqual(hosts(w), ["a", "c1", "c2", "b"]);
  const group = Object.values(S().groups)[0];
  assert.deepEqual(group.tabIds, [c1, c2], "the pinned tab stays pinned, out of the group");
  assert.ok(S().tabs[a].pinned);
  S().activate(b);
  S().activate(a);
  const c3 = open(w, "c3", a);
  assert.deepEqual(S().groups[group.id].tabIds, [c1, c2, c3], "later links from it join that group");
});

test("closing a group that holds the shown tab shows the tab just above the group", () => {
  reset({ cmdClickCreatesTabGroup: true });
  const [w, pin, home] = setup("pin", "home");
  S().togglePin(pin);
  S().activate(home);
  S().activate(pin);
  const c1 = open(w, "c1", pin);
  open(w, "c2", pin);
  const group = Object.values(S().groups)[0];
  S().moveTab(home, 0);
  S().activate(c1);
  S().closeGroup(group.id);
  assert.equal(active(w), "home", "not the pinned opener");
});

test("a link kept to load when shown is dropped once the tab loads something else", () => {
  reset();
  const [w, a] = setup("a");
  const kept = S().newTab(w, { url: "form.com", background: true, wakeAdoptId: "open:7" });
  assert.equal(S().tabs[kept].wakeAdoptId, "open:7");
  S().togglePin(kept);
  S().navigate(kept, "other.com");
  assert.equal(S().tabs[kept].wakeAdoptId, undefined, "typing an address supersedes it");
  S().updateTab(kept, { url: "https://other.com" });
  S().activate(a);
  S().closeTab(kept);
  S().activate(kept);
  assert.notEqual(S().tabs[kept].adoptId, "open:7", "unloading and showing it again never replays the old request");
  assert.ok(S().tabs[kept].navigation);

  const other = S().newTab(w, { url: "form2.com", background: true, wakeAdoptId: "open:8" });
  S().updateTab(other, { navigation: { url: "https://x.com", seq: 1 } });
  assert.equal(S().tabs[other].wakeAdoptId, undefined, "any load supersedes it");
});
