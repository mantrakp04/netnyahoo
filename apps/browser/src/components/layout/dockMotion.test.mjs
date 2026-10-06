// Hiding and showing the sidebar (⌘S, the toolbar's sidebar button): Dia's spring, the traffic lights riding with the
// sidebar, the card's edge, the motion flag the card waits on, and the per-window state across a relaunch.
import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const dm = await import("./dockMotion.ts");
const { toolbarGeometry } = await import("./geometry.ts");
const { useBrowser } = await import("../../store/browser.ts");
const { flushPersistence, loadSession, startPersistence } = await import("../../lib/persist.ts");
const stub = await import("../../test-native-stub.mjs");

const S = () => useBrowser.getState();

// The card's left edge in the owner's 240 fps recording of Dia (2026-10-06), as a fraction of its travel, against
// seconds after the fitted start of each motion (two collapses, 191 → 6 pt, and one expansion, 6 → 191 pt).
const DIA = [
  [0.0337, 0.303], [0.0629, 0.616], [0.0837, 0.805], [0.1212, 0.968], [0.1379, 1.011], [0.1629, 1.011], [0.1837, 1.003],
  [0.0263, 0.246], [0.0596, 0.524], [0.0805, 0.8], [0.1055, 0.951], [0.1305, 1.008], [0.1555, 1.011], [0.1805, 1.003],
  [0.0324, 0.316], [0.0657, 0.586], [0.0949, 0.846], [0.1032, 0.973], [0.1365, 1.011], [0.1532, 1.011], [0.1782, 1.005],
];

test("the spring follows Dia's measured motion (rms under 4 % of the travel, the recorder's own timing jitter)", () => {
  const rms = Math.sqrt(DIA.reduce((sum, [t, x]) => sum + (dm.springAt(t) - x) ** 2, 0) / DIA.length);
  assert.ok(rms < 0.04, `rms ${rms.toFixed(3)}`);
  // 90 % of the way by 100 ms, a small overshoot (no bounce anyone sees), at rest within 0.3 s.
  assert.ok(dm.springAt(0.1) > 0.88);
  const peak = Math.max(...Array.from({ length: 60 }, (_, i) => dm.springAt(i / 120)));
  assert.ok(peak > 1.005 && peak < 1.03, `peak ${peak}`);
  assert.ok(Math.abs(dm.springAt(0.3) - 1) < 0.003);
});

test("React Native's spring parameters are the same spring", () => {
  const { stiffness, damping, mass } = dm.springConfig(dm.DOCK_SPRING);
  assert.equal(mass, 1);
  const omega = Math.sqrt(stiffness);
  assert.ok(Math.abs(omega - (2 * Math.PI) / 0.215) < 1e-9);
  assert.ok(Math.abs(damping / (2 * omega) - 0.79) < 1e-9);
});

test("the traffic lights go with the sidebar: at their place when it's shown, past the window's edge when it's hidden", () => {
  assert.equal(dm.lightsCenter(0), null, "shown: nothing to move");
  assert.equal(dm.lightsCenter(0.2), null, "a rounding hair from shown: still their place");
  assert.deepEqual(dm.lightsCenter(95), [25 - 95, 27], "half way out");
  for (const width of [160, 190, 400]) {
    const [x] = dm.lightsCenter(width);
    // The zoom button is the rightmost: 46 pt right of the close button's centre, 7 pt to its edge.
    assert.ok(x + 46 + 7 < 0, `width ${width}: all three past the left edge`);
  }
});

test("the card's left edge runs from the inset to the sidebar's width", () => {
  assert.equal(dm.cardLeft(1, 190, 7), 190);
  assert.equal(dm.cardLeft(0, 190, 7), 7);
  assert.equal(dm.cardLeft(0.5, 190, 7), 98.5);
});

test("the motion flag is per window, and ending it twice is harmless", () => {
  dm.setDockMoving("a", true);
  assert.equal(dm.dockMoving("a"), true);
  assert.equal(dm.dockMoving("b"), false);
  const before = dm.useDockMotion.getState();
  dm.setDockMoving("a", true);
  assert.equal(dm.useDockMotion.getState(), before, "no store update for no change");
  dm.setDockMoving("a", false);
  dm.setDockMoving("a", false);
  assert.equal(dm.dockMoving("a"), false);
  assert.deepEqual(dm.useDockMotion.getState().moving, {});
});

test("the toolbar's buttons don't move with the sidebar: the hidden sidebar's toolbar starts at the card's edge, as Dia's", () => {
  const g = toolbarGeometry({ sidebarButton: true });
  // Dia, collapsed: the button at x 27 = the card's edge (6) + 21; back, forward, reload at 56, 92, 127 from it.
  assert.deepEqual([g.sidebarButton, g.back, g.forward, g.reload], [21, 56, 92, 127]);
});

test("the sidebar's own button (address bar in the sidebar) always fits; back, forward and reload as there's room", () => {
  assert.equal(dm.navButtonsFitting(160), 1);
  assert.equal(dm.navButtonsFitting(190), 2, "the default width: the button, back and forward");
  assert.equal(dm.navButtonsFitting(224.75), 3);
  assert.equal(dm.navButtonsFitting(400), 3);
  assert.equal(dm.navButtonsFitting(100), 0);
});

test("hidden or shown is each window's own, and survives a quit and relaunch; new windows open with it shown", () => {
  stub.docs.clear();
  S().hydrate({});
  const stop = startPersistence();
  const a = S().createWindow({ url: "a.com" });
  const b = S().createWindow({ url: "b.com" });
  S().toggleSidebar(a);
  assert.equal(S().windows[a].sidebarOpen, false);
  assert.equal(S().windows[b].sidebarOpen, true, "the other window keeps its sidebar");
  flushPersistence();
  S().hydrate(loadSession());
  assert.equal(S().windows[a].sidebarOpen, false, "relaunch: still hidden");
  assert.equal(S().windows[b].sidebarOpen, true, "relaunch: still shown");

  // Shown again, then a relaunch: shown (the saved state follows the change, not the first value).
  S().toggleSidebar(a);
  flushPersistence();
  S().hydrate(loadSession());
  assert.equal(S().windows[a].sidebarOpen, true);

  // Hidden, closed, reopened (⇧⌘T): hidden. A new window: shown.
  S().toggleSidebar(a);
  S().closeWindow(a);
  flushPersistence();
  S().hydrate(loadSession());
  assert.equal(S().windows[a], undefined, "closed: gone after a relaunch");
  S().reopenClosedWindow();
  const reopened = S().windowOrder.find((id) => id !== b);
  assert.ok(reopened, "the closed window came back");
  assert.equal(S().windows[reopened].sidebarOpen, false, "reopened as it was closed");
  const c = S().createWindow({ url: "c.com" });
  assert.equal(S().windows[c].sidebarOpen, true);
  stop();
});
