// Synced records from Macs on the app's former name apply in today's names (sync/engine.ts inTodaysNames).
import assert from "node:assert/strict";
import { test } from "node:test";
const { fromLegacy, fromLegacyUrl, LEGACY_KEYS, LEGACY_URLS } = await import("./legacy.ts");

// The old names come from legacy.ts, the only file that may spell them.
const [[oldGame], [oldChromeGame], [oldScheme]] = LEGACY_URLS;
const old = (name) => Object.keys(LEGACY_KEYS).find((key) => LEGACY_KEYS[key] === name);

test("app URLs move to today's scheme; other text stays", () => {
  assert.equal(fromLegacyUrl(`${oldScheme}history`), "arcadia://history");
  assert.equal(fromLegacyUrl(`view-source:${oldScheme}settings/sync`), "view-source:arcadia://settings/sync");
  assert.equal(fromLegacyUrl(`${oldGame}?level=2`), "arcadia://game?level=2");
  assert.equal(fromLegacyUrl(oldChromeGame), "chrome://game");
  assert.equal(fromLegacyUrl(`${oldChromeGame}u`), `${oldChromeGame}u`);
  assert.equal(fromLegacyUrl(`https://example.com/?next=${oldScheme}history`), `https://example.com/?next=${oldScheme}history`);
});

test("records: settings and shortcut ids renamed, the rest kept as the same objects", () => {
  const tab = { u: "https://example.com", t: "Example" };
  assert.equal(fromLegacy(tab), tab);
  assert.deepEqual(fromLegacy({ v: { [old("newLittleArcadia")]: ["cmd+opt+n"], newTab: ["cmd+t"] } }), {
    v: { newLittleArcadia: ["cmd+opt+n"], newTab: ["cmd+t"] },
  });
  assert.deepEqual(fromLegacy({ u: `${oldScheme}downloads`, t: "Downloads" }), { u: "arcadia://downloads", t: "Downloads" });
  assert.deepEqual(fromLegacy({ [old("littleArcadiaSize")]: [1, 2], littleArcadiaSize: [3, 4] }), { littleArcadiaSize: [3, 4] });
});

test("a bookmark saved before Chrome kept them gets the UUID 0.2.32 gave it, on every Mac", async () => {
  const { bookmarkUuidFor } = await import("./store/bookmarks.ts");
  assert.equal(bookmarkUuidFor("bm-1"), "de8f26f1-cf94-4896-bcf5-f260fa6f106a");
});
