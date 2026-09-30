// Run from apps/browser:  node --import ./src/store/test-loader.mjs --test src/components/layout/stripGroups.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
const m = await import("./stripGroups.ts");

test("group layout: Dia's chip-only, collapsed-with-tab and expanded containers", () => {
  const widths = [173, 173, 173];
  // Chip only (no member active): the 49 pt chip of a group named "X".
  assert.deepEqual(m.groupLayout(49, widths, 4, false, -1), { offsets: [0, 177, 354], width: 49 });
  // The active member stays out after the chip: 49 + 6.5 + 173 + 4.5.
  assert.equal(m.groupLayout(49, widths, 4, false, 2).width, 233);
  // Expanded: every member on the 177 pitch, then the divider and Close Group.
  assert.equal(m.groupLayout(49, widths, 4, true, 2).width, 49 + 6.5 + 527 + 30.25);
  assert.equal(m.groupLayout(49, [], 4, true, -1).width, 49);
});

test("spring: response 0.30 s, damping 0.82", () => {
  const { stiffness, damping, mass } = m.GROUP_SPRING;
  const omega = Math.sqrt(stiffness / mass);
  assert.ok(Math.abs((2 * Math.PI) / omega - 0.3) < 1e-9);
  assert.ok(Math.abs(damping / (2 * omega) - 0.82) < 1e-9);
});

test("tuck target: the most recently active tab outside the group, same window and profile", () => {
  const tab = (id, profileId, lastActiveAt, windowId = "w") => ({ id, windowId, profileId, lastActiveAt });
  const s = {
    windows: { w: { id: "w", profileId: "p", tabIds: ["pin", "a", "b", "c", "other", "d"] } },
    tabs: {
      pin: tab("pin", "p", 50),
      a: tab("a", "p", 90),
      b: tab("b", "p", 100),
      c: tab("c", "p", 10),
      other: tab("other", "q", 99),
      d: tab("d", "p", 20),
    },
    groups: { g: { id: "g", tabIds: ["a", "b"] } },
  };
  assert.equal(m.tuckTarget(s, "w", "p", "g"), "pin");
  s.tabs.d.lastActiveAt = 60;
  assert.equal(m.tuckTarget(s, "w", "p", "g"), "d");
  s.groups.g.tabIds = ["pin", "a", "b", "c", "d"];
  assert.equal(m.tuckTarget(s, "w", "p", "g"), undefined);
});
