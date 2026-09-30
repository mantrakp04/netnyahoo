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

const { useBrowser } = await import("../../store/browser.ts");
const model = await import("../../store/model.ts");
const S = () => useBrowser.getState();

// Drops the last slot's tab `dx` points along, as the strip does on release.
function drag(w, slots, from, dx) {
  const geometry = m.dragGeometry(slots, 4);
  const tabId = slots[from].tabIds[0];
  const section = S().windows[w].tabIds.filter((id) => !S().tabs[id].pinned);
  const index = m.moveIndex(section, tabId, slots, from, m.dropIndex(geometry, from, dx));
  if (index !== null) S().moveTab(tabId, index);
  return model.viewTabIds(S(), w);
}

test("drag: a split is one two-tab-wide slot (the old maths counted it as nothing and overshot)", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "x.com" });
  const x = model.viewTabIds(S(), w)[0];
  S().activate(S().newTab(w, { url: "s1.com" }));
  const { splitId } = S().openSplitPane(w, { url: "s2.com" });
  const [s1, s2] = S().splits[splitId].tabIds;
  const y = S().newTab(w, { url: "y.com" });
  assert.deepEqual(model.viewTabIds(S(), w), [x, s1, s2, y]);
  const slots = [{ tabIds: [x], width: 100 }, { tabIds: [s1, s2], width: 200 }, { tabIds: [y], width: 100 }];
  // One tab's pitch left: still short of the split's centre, nothing moves.
  assert.deepEqual(drag(w, slots, 2, -104), [x, s1, s2, y]);
  // Past the split's centre: y lands between x and the split (the old maths put it before x).
  assert.deepEqual(drag(w, slots, 2, -210), [x, y, s1, s2]);
});

test("drag: a group is one block, so a tab never lands between its members", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "x.com" });
  const x = model.viewTabIds(S(), w)[0];
  const [a, b, c] = ["a.com", "b.com", "c.com"].map((url) => S().newTab(w, { url }));
  const y = S().newTab(w, { url: "y.com" });
  const g = S().createGroup([a, b, c], { name: "G" });
  S().updateGroup(g, { collapsed: true });
  const group = { tabIds: [a, b, c], width: 240, marginLeft: 3.5, marginRight: 4 };
  let slots = [{ tabIds: [x], width: 100 }, group, { tabIds: [y], width: 100 }];
  // The old maths (visible index 1 = the shown member b) moved y to [x, a, y, b, c].
  assert.deepEqual(drag(w, slots, 2, -200), [x, y, a, b, c]);
  assert.deepEqual(S().groups[g].tabIds, [a, b, c]);
  slots = [{ tabIds: [x], width: 100 }, { tabIds: [y], width: 100 }, group];
  assert.deepEqual(drag(w, slots, 1, 400), [x, a, b, c, y]);
  // Inside an open group, members reorder among themselves only.
  const members = [a, b, c].map((id) => ({ tabIds: [id], width: 100 }));
  const geometry = m.dragGeometry(members, 4);
  assert.deepEqual(m.dragRange(geometry, 0), [0, 208]);
  const section = S().windows[w].tabIds;
  S().moveTab(a, m.moveIndex(section, a, members, 0, m.dropIndex(geometry, 0, 1000)));
  assert.deepEqual(model.viewTabIds(S(), w), [x, b, c, a, y]);
  assert.deepEqual(S().groups[g].tabIds, [b, c, a]);
});

test("tab width leaves room for a long group name", () => {
  const base = { pageWidth: 1200, dockWidth: 0, tabUnits: 6, gap: 4, plus: 32, min: 96, max: 173 };
  const short = m.stripTabWidth({ ...base, groups: [{ chip: 49, expanded: true, shown: false }] });
  const long = m.stripTabWidth({ ...base, groups: [{ chip: 160, expanded: true, shown: false }] });
  assert.ok(long < short, `${long} < ${short}`);
  // Everything fits: tabs + group + plus = page.
  const used = 6 * (long + 4) + 3.5 + 4 + 160 + 6.5 + 30.25 + 4 + 32 + 4;
  assert.ok(Math.abs(used - 1200) <= 3, `${used}`);
  assert.equal(m.stripTabWidth({ ...base, pageWidth: 300, groups: [] }), 96);
});

test("members take clicks only once they're out", () => {
  assert.equal(m.memberInteractive(true, false, true), true);
  assert.equal(m.memberInteractive(false, false, false), false);
  assert.equal(m.memberInteractive(false, true, true), false, "still sliding out");
  assert.equal(m.memberInteractive(false, true, false), true);
});
