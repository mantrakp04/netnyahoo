import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const model = await import("./model.ts");
const { ECHO_MS, isActivationEcho, isChromeSwitch, noteActivations } = await import("../lib/tabStripEcho.ts");

const S = () => useBrowser.getState();

function setup() {
  S().hydrate({});
  const w = S().createWindow({ url: "a.com" });
  const a = model.activeTabId(S(), w);
  const b = S().newTab(w, { url: "b.com", background: true });
  const c = S().newTab(w, { url: "c.com", background: true });
  return { w, a, b, c };
}

function activate(id, now) {
  const prev = S();
  S().activate(id);
  noteActivations(S(), prev, now);
}

test("a report for the tab the app just left is an echo until Chrome reports the new one", () => {
  const { w, a, b, c } = setup();
  activate(b, 1000);
  assert.equal(isActivationEcho(w, a, b, 1100), true, "Chrome hasn't caught up: a's report is stale");
  assert.equal(isActivationEcho(w, c, b, 1100), false, "c was never shown: Chrome activating it is a real switch");
  assert.equal(isActivationEcho(w, b, b, 1150), false, "Chrome reports b: caught up");
  assert.equal(isActivationEcho(w, a, b, 1200), false, "after that, Chrome activating a (an extension) is real");
});

test("switching on before Chrome catches up keeps every left tab an echo; the window expires", () => {
  const { w, a, b, c } = setup();
  activate(b, 1000);
  activate(c, 1100);
  assert.equal(isActivationEcho(w, a, c, 1200), true);
  assert.equal(isActivationEcho(w, b, c, 1200), true);
  activate(a, 1300);
  assert.equal(isActivationEcho(w, a, a, 1350), false, "the shown tab is never an echo");
  activate(b, 2000);
  assert.equal(isActivationEcho(w, a, b, 2000 + ECHO_MS), false, "a report after ECHO_MS is a real switch");
});

test("updates that don't switch tabs record nothing", () => {
  const { w, a, c } = setup();
  const prev = S();
  S().updateTab(c, { title: "C" });
  noteActivations(S(), prev, 1000);
  assert.equal(isActivationEcho(w, c, a, 1100), false);
});

test("with the engine's flags, only an activation the app didn't ask for is a switch", () => {
  const { w, a, b, c } = setup();
  activate(b, 1000);
  const place = (active, activated, byApp) => ({ index: 0, pinned: false, active, activated, byApp });
  assert.equal(isChromeSwitch(w, a, b, place(true, false, false), 1100), false, "a was already Chrome's active tab: its index moved");
  assert.equal(isChromeSwitch(w, b, b, place(true, true, true), 1100), false, "the app's own switch echoing back");
  assert.equal(isChromeSwitch(w, c, b, place(true, true, true), 1100), false, "activated by the app's request (a moved tab)");
  assert.equal(isChromeSwitch(w, a, b, place(true, true, false), 1100), true, "Chrome activating a tab the app just left is real");
  assert.equal(isChromeSwitch(w, c, b, place(false, false, false), 1100), false, "not active");
});

test("without the flags (older engines), the timed echo window decides", () => {
  const { w, a, b, c } = setup();
  activate(b, 1000);
  const place = { index: 0, active: true, pinned: false };
  assert.equal(isChromeSwitch(w, a, b, place, 1100), false, "a's report is still an echo");
  assert.equal(isChromeSwitch(w, c, b, place, 1100), true);
  assert.equal(isChromeSwitch(w, b, b, place, 1100), false, "the shown tab");
});
