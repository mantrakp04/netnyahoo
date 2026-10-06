// The bar's preloading (lib/preload.ts): what it tells Chrome's predictor (engine: nn_omnibox.h), and when.
import assert from "node:assert/strict";
import { mock, test } from "node:test";

globalThis.__DEV__ = false;
const { useBrowser } = await import("../store/browser.ts");
const preload = await import("./preload.ts");
preload.setEngineForTests(true);

const S = () => useBrowser.getState();
let calls = [];
let answer = () => Promise.resolve({});
globalThis.nnTestEngineCall = (name, profile, args) => {
  calls.push({ name, profile, ...args });
  return answer(name);
};

const setup = () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.com" });
  const tab = S().windows[w].tabIds[0];
  calls = [];
  answer = () => Promise.resolve({});
  return tab;
};

const page = (url, extra = {}) => ({ kind: "page", url, title: "", favicon: null, ...extra });
const search = (q, suggested) => ({ kind: "search", query: q, url: `https://s.example/?q=${q}`, engine: "S", ...(suggested ? { suggested } : {}) });

test("a burst of keystrokes asks once, with the last text, once typing pauses", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const tab = setup();
  preload.barTyped(tab, "g", [page("https://g.com/")], 0);
  preload.barTyped(tab, "gi", [page("https://gi.com/")], 0);
  preload.barTyped(tab, "git", [page("https://github.com/", { visited: true })], 0);
  t.mock.timers.tick(59);
  assert.equal(calls.length, 0);
  t.mock.timers.tick(1);
  assert.deepEqual(calls, [{ name: "nn_omnibox_typed", profile: "", tab: 0, text: "git", matches: [{ url: "https://github.com/", kind: "history" }], default: 0 }]);
});

test("suggestions map to Chrome's match types; the default skips the bar's actions", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const tab = setup();
  const items = [
    { kind: "action", id: "settings", title: "Settings" },
    page("https://b.com/", { bookmarked: true }),
    page("https://t.com/", { tabId: "x" }),
    page("https://typed.com/"),
    search("q"),
    search("qq", true),
    { kind: "calc", expression: "1+1", value: "2", url: "https://s.example/?q=1%2B1" },
  ];
  preload.barTyped(tab, "x", items, 3);
  t.mock.timers.tick(60);
  assert.deepEqual(calls[0].matches.map((m) => m.kind), ["bookmark", "tab", "typed", "search", "suggest", "other"]);
  assert.equal(calls[0].default, 2);
  calls = [];
  // Enter would run an action: no page to preload, but the shown pages still teach the predictor.
  preload.barTyped(tab, "xy", items, 0);
  t.mock.timers.tick(60);
  assert.equal(calls[0].default, -1);
});

test("clearing the text drops what was waiting", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const tab = setup();
  preload.barTyped(tab, "git", [page("https://github.com/")], 0);
  preload.barTyped(tab, "", [], 0);
  t.mock.timers.tick(200);
  assert.equal(calls.length, 0);
});

test("opening a page sends its text first; closing the bar drops it", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const tab = setup();
  preload.barTyped(tab, "git", [page("https://github.com/")], 0);
  preload.barOpened(tab, "https://github.com/");
  assert.deepEqual(calls.map((c) => [c.name, c.text ?? c.url]), [["nn_omnibox_typed", "git"], ["nn_omnibox_opened", "https://github.com/"]]);
  calls = [];
  preload.barTyped(tab, "gi", [page("https://github.com/")], 0);
  preload.barOpened(tab, "");
  t.mock.timers.tick(200);
  assert.deepEqual(calls.map((c) => [c.name, c.url]), [["nn_omnibox_opened", ""]]);
});

test("the tab's Chrome id is read when the call goes (a prewarmed tab can come after the text)", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const tab = setup();
  preload.barTyped(tab, "git", [page("https://github.com/")], 0);
  preload.noteChromeTab(tab, 42);
  t.mock.timers.tick(60);
  assert.equal(calls[0].tab, 42);
  preload.forgetChromeTab(tab);
});

test("each bar's text waits on its own: one bar opening or closing leaves another's alone", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = setup();
  const w2 = S().createWindow({ url: "https://b.com" });
  const b = S().windows[w2].tabIds[0];
  preload.barTyped(a, "git", [page("https://github.com/")], 0);
  preload.barTyped(b, "news", [page("https://news.com/")], 0);
  preload.barOpened(a, "");
  assert.deepEqual(calls.map((c) => c.name), ["nn_omnibox_opened"]);
  t.mock.timers.tick(60);
  assert.deepEqual(calls.map((c) => c.text ?? c.url), ["", "news"]);
});

test("a bar whose tab closed still says it opened nothing", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const tab = setup();
  S().newTab(S().tabs[tab].windowId, { url: "https://keep.com", background: true });
  preload.barTyped(tab, "git", [page("https://github.com/")], 0);
  t.mock.timers.tick(60);
  S().closeTab(tab);
  preload.barOpened(tab, "");
  assert.deepEqual(calls.map((c) => [c.name, c.profile]), [["nn_omnibox_typed", ""], ["nn_omnibox_opened", ""]]);
});

test("Paste and Go teaches nothing and sends nothing", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const tab = setup();
  preload.barTyped(tab, "git", [page("https://github.com/")], 0);
  preload.barOpened(tab, "https://pasted.com/", { learn: false });
  t.mock.timers.tick(200);
  assert.equal(calls.length, 0);
});

test("an engine without the calls is asked once", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const tab = setup();
  answer = () => Promise.reject(new Error("nn_omnibox_typed: the engine has no nn_omnibox_typed"));
  preload.barTyped(tab, "git", [page("https://github.com/")], 0);
  t.mock.timers.tick(60);
  await new Promise((r) => setImmediate(r));
  preload.barTyped(tab, "gith", [page("https://github.com/")], 0);
  t.mock.timers.tick(60);
  preload.barOpened(tab, "https://github.com/");
  assert.equal(calls.length, 1);
});

// Last: it leaves the module on an engine without the calls.
test("an engine without the bar's calls (older than the JS): no prewarm, nothing sent", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const tab = setup();
  preload.setEngineForTests(false);
  assert.equal(preload.newTabPrewarmOn(), false);
  preload.barTyped(tab, "git", [page("https://github.com/")], 0);
  t.mock.timers.tick(200);
  preload.barOpened(tab, "https://github.com/");
  assert.equal(calls.length, 0);
});
