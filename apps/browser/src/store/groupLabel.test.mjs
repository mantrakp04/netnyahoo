import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const model = await import("./model.ts");
const { groupLabel } = await import("./organize.ts");
const { autoGroupName } = await import("./groupNames.ts");

const S = () => useBrowser.getState();

test("an unnamed group's label follows its members' titles and ignores everything else", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://github.com/a" });
  const a = model.activeTabId(S(), w);
  const b = S().newTab(w, { url: "https://github.com/b" });
  const other = S().newTab(w, { url: "https://x.com/" });
  S().updateTab(a, { title: "Issues · a - GitHub" });
  S().updateTab(b, { title: "Pulls · b - GitHub" });
  const id = S().groupTabs([a, b]);
  const group = () => S().groups[id ?? Object.keys(S().groups)[0]];
  const expected = () => autoGroupName(group().tabIds.map((t) => S().tabs[t]));
  assert.equal(groupLabel(S(), group()), expected());
  S().updateTab(other, { title: "Home / X" });
  S().updateLive(a, { progress: 0.5 });
  assert.equal(groupLabel(S(), group()), expected(), "unrelated changes keep the label");
  S().updateTab(b, { title: "Rick Astley - YouTube", url: "https://youtube.com/watch" });
  assert.equal(groupLabel(S(), group()), expected(), "a member's new title renames it");
  S().updateTab(a, { title: "Rick Astley - YouTube", url: "https://youtube.com/watch" });
  assert.equal(groupLabel(S(), group()), "YouTube Rick Astley", "both members' titles count");
  S().updateGroup(group().id, { name: "Mine" });
  assert.equal(groupLabel(S(), group()), "Mine");
});

test("a loading tab takes its page from a loaded tab of the same URL", () => {
  const members = [
    { url: "https://x.com/home", title: "" },
    { url: "https://x.com/home", title: "Home / X" },
  ];
  assert.equal(autoGroupName(members), "X Home");
});

test("adding ungrouped tabs to a group makes a new groups map (indexes keyed by it stay right)", async () => {
  const { groupIndex } = await import("./structure.ts");
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.com/" });
  const a = model.activeTabId(S(), w);
  const b = S().newTab(w, { url: "https://b.com/" });
  const c = S().newTab(w, { url: "https://c.com/" });
  S().groupTabs([a, b]);
  const g = Object.keys(S().groups)[0];
  const before = S().groups;
  assert.equal(groupIndex(before).get(c), undefined);
  S().addTabsToGroup(g, [c]);
  assert.notEqual(S().groups, before, "the store's previous map is left as it was");
  assert.equal(before[g].tabIds.includes(c), false);
  assert.equal(groupIndex(S().groups).get(c)?.id, g);
});
