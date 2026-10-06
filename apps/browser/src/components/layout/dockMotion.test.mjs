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

// Arc (the owner's recording, 2026-10-06): the peek panel's right edge and the card's left edge as a fraction of their
// travel, against seconds after the fitted start of each motion (docs/dia-spec.md, "Arc note").
const springAt = (t, s) => dm.springAt(t, s);
const fitT0 = (points, curve) => {
  let best = Infinity;
  for (let t0 = -0.04; t0 <= 0.04; t0 += 0.001) {
    const err = points.reduce((sum, [t, x]) => sum + (curve(t - t0) - x) ** 2, 0);
    best = Math.min(best, err);
  }
  return Math.sqrt(best / points.length);
};
const ARC_PEEK_IN = [
  [[0, 0.219], [0.025, 0.473], [0.041, 0.686], [0.066, 0.931], [0.083, 0.983], [0.1, 1.006], [0.116, 1.015], [0.133, 1.015], [0.15, 1.013], [0.166, 1.009], [0.183, 1.004], [0.2, 1.002], [0.216, 1]],
  [[0, 0.09], [0.034, 0.462], [0.042, 0.677], [0.059, 0.832], [0.092, 0.959], [0.109, 0.998], [0.117, 1.013], [0.134, 1.015], [0.15, 1.013], [0.184, 1.006], [0.2, 1.004], [0.217, 1.002], [0.234, 1]],
  [[0, 0.254], [0.017, 0.503], [0.033, 0.71], [0.05, 0.903], [0.067, 0.968], [0.083, 1], [0.1, 1.013], [0.117, 1.015], [0.133, 1.013], [0.158, 1.009], [0.175, 1.004], [0.2, 1.002], [0.217, 1]],
];
const ARC_HIDE = [
  [[0, 0], [0.017, 0.452], [0.042, 0.83], [0.059, 0.945], [0.075, 1]],
  [[0, 0], [0.017, 0.328], [0.034, 0.654], [0.05, 0.853], [0.075, 0.956], [0.092, 1]],
];

test("Arc's peek slides in on its measured spring and leaves on its ease-in-out; its hide is a 100 ms ease-out", () => {
  for (const motion of ARC_PEEK_IN) {
    const rms = fitT0(motion, (t) => springAt(t, dm.ARC_PEEK_SPRING));
    assert.ok(rms < 0.04, `peek in rms ${rms.toFixed(3)}`);
  }
  const hide = (t) => (t <= 0 ? 0 : t >= dm.ARC_HIDE_MS / 1000 ? 1 : dm.easeOutCubic(t / (dm.ARC_HIDE_MS / 1000)));
  for (const motion of ARC_HIDE) {
    const rms = fitT0(motion, hide);
    assert.ok(rms < 0.05, `hide rms ${rms.toFixed(3)}`);
  }
  // Faster than Dia's spring: Dia's would miss Arc's hide by far more.
  const dia = Math.max(...ARC_HIDE.map((m) => fitT0(m, (t) => dm.springAt(t))));
  assert.ok(dia > 0.06, `Dia's spring against Arc's hide: rms ${dia.toFixed(3)}`);
  assert.equal(dm.easeInOutCubic(0), 0);
  assert.equal(dm.easeInOutCubic(0.5), 0.5);
  assert.equal(dm.easeInOutCubic(1), 1);
  const peak = Math.max(...Array.from({ length: 60 }, (_, i) => springAt(i / 120, dm.ARC_PEEK_SPRING)));
  assert.ok(peak > 1.01 && peak < 1.03, `the panel's overshoot ${peak}`);
});

test("a peek that's out is remembered per window (Arc docks from it at once)", () => {
  assert.equal(dm.peekShown("w1"), false);
  dm.setPeekShown("w1", true);
  assert.equal(dm.peekShown("w1"), true);
  assert.equal(dm.peekShown("w2"), false);
  dm.setPeekShown("w1", false);
  assert.equal(dm.peekShown("w1"), false);
});

test("Arc's layout keeps the address bar in a hidden sidebar (no toolbar on the card); Dia's layout and the switch off don't", async () => {
  const { addressBarInSidebar } = await import("./windowLayout.ts");
  const { reloadSwitches } = await import("../../lib/killSwitches.ts");
  stub.docs.clear();
  reloadSwitches();
  S().hydrate({});
  const w = S().createWindow({ url: "a.com" });
  S().updateSettings({ addressBar: "sidebar", tabLayout: "sidebar" });
  assert.equal(addressBarInSidebar(S(), w), true, "shown");
  S().toggleSidebar(w);
  assert.equal(addressBarInSidebar(S(), w), true, "hidden: still in the sidebar (Arc)");
  S().updateSettings({ addressBar: "toolbar" });
  assert.equal(addressBarInSidebar(S(), w), false, "Dia's layout: the toolbar's");
  S().updateSettings({ addressBar: "sidebar" });
  stub.docs.set("switches-cache.json", JSON.stringify({ version: 1, switches: { sidebarSlide: false } }));
  reloadSwitches();
  assert.equal(addressBarInSidebar(S(), w), false, "switch off: a hidden sidebar's bar moves to the card, as before");
  S().toggleSidebar(w);
  assert.equal(addressBarInSidebar(S(), w), true, "switch off, shown: in the sidebar");
  stub.docs.clear();
  reloadSwitches();
});
