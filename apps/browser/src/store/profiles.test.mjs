// Profiles: shared data (Dia's "Share data with another profile") and ordering.
// Run from apps/browser:  node --import ./src/store/test-loader.mjs --test src/store/profiles.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const model = await import("./model.ts");
const { dataGroups, sharingProfiles } = await import("./profiles.ts");
const { isBookmarked } = await import("./bookmarks.ts");

const S = () => useBrowser.getState();
const reset = () => S().hydrate({});

test("a profile created to share data uses the other's engine context, bookmarks and history", () => {
  reset();
  S().recordVisit("default", "https://a.com/", "A", null, true);
  S().addBookmark({ profileId: "default", url: "https://b.com/", title: "B" });
  const work = S().createProfile({ name: "Work", shareWith: "default" });
  assert.equal(S().profiles[work].dataId, "default");
  assert.equal(model.engineProfile(work), "", "default profile's engine context");
  assert.deepEqual(S().bookmarks.roots[work], S().bookmarks.roots.default);
  assert.ok(isBookmarked(S().bookmarks, work, "https://b.com/"));
  assert.deepEqual(S().history[work].map((h) => h.url), ["https://a.com/"]);

  // Either side's visits show in both.
  S().recordVisit(work, "https://c.com/", "C", null, true);
  assert.deepEqual(S().history.default.map((h) => h.url), ["https://c.com/", "https://a.com/"]);
  assert.equal(S().history.default, S().history[work]);
  S().clearHistory("default");
  assert.deepEqual(S().history[work], []);

  // A profile of its own stays separate.
  const school = S().createProfile({ name: "School" });
  assert.equal(model.engineProfile(school), school);
  assert.notDeepEqual(S().bookmarks.roots[school], S().bookmarks.roots.default);
  assert.deepEqual(sharingProfiles(S(), "default"), [work]);
  assert.deepEqual(dataGroups(S()), [
    { dataId: "default", profileIds: ["default", work] },
    { dataId: school, profileIds: [school] },
  ]);

  // Sharing with a sharer joins the same data.
  const home = S().createProfile({ name: "Home", shareWith: work });
  assert.equal(S().profiles[home].dataId, "default");
});

test("deleting a profile keeps the data others share", () => {
  reset();
  const a = S().createProfile({ name: "A" });
  S().recordVisit(a, "https://a.com/", "A", null, true);
  const bookmark = S().addBookmark({ profileId: a, url: "https://b.com/", title: "B" });
  const b = S().createProfile({ name: "B", shareWith: a });
  S().deleteProfile(a);
  assert.equal(S().profiles[a], undefined);
  assert.equal(model.engineProfile(b), a, "still on A's engine context");
  assert.ok(S().bookmarks.nodes[bookmark], "shared bookmarks stay");
  assert.deepEqual(S().history[b].map((h) => h.url), ["https://a.com/"]);
  // B's visits keep working once it's alone.
  S().recordVisit(b, "https://c.com/", "C", null, true);
  assert.equal(S().history[b].length, 2);
  // The last one removes them.
  S().deleteProfile(b);
  assert.equal(S().bookmarks.nodes[bookmark], undefined);
});

test("shared data survives a save and reload", () => {
  reset();
  const a = S().createProfile({ name: "A" });
  const b = S().createProfile({ name: "B", shareWith: a });
  S().recordVisit(b, "https://a.com/", "A", null, true);
  const saved = JSON.parse(JSON.stringify({ profiles: S().profiles, profileOrder: S().profileOrder, history: S().history, bookmarks: S().bookmarks }));
  reset();
  assert.equal(model.engineProfile(b), b, "registry follows the loaded profiles");
  S().hydrate(saved);
  assert.equal(model.engineProfile(b), a);
  assert.equal(S().history[a], S().history[b]);
  assert.deepEqual(S().bookmarks.roots[a], S().bookmarks.roots[b]);
});

test("reorderProfiles moves profiles and keeps unknown ids out", () => {
  reset();
  const a = S().createProfile({ name: "A" });
  const b = S().createProfile({ name: "B" });
  S().reorderProfiles([b, "default", "nope", a]);
  assert.deepEqual(S().profileOrder, [b, "default", a]);
  S().reorderProfiles([a]);
  assert.deepEqual(S().profileOrder, [a, b, "default"]);
});
