// When the New Tab page's release notes postcard shows: updates, fresh installs, expiry, retiring.
// Run from apps/browser:  node --import ./src/store/test-loader.mjs --test src/components/ntp/releaseNotes.test.mjs
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
globalThis.__DEV__ = false;
const shell = await import("@netnyahoo/shell");
const notes = await import("./releaseNotes.ts");

const saved = () => JSON.parse(shell.docs.get("release-notes.json"));
const pendingVersion = () => saved().pending?.version ?? null;

beforeEach(() => {
  shell.docs.clear();
  shell.appInfo.appVersion = "1.0";
  notes.retireReleaseNotes();
});

test("a fresh install records its version and shows nothing", () => {
  notes.trackAppVersion();
  assert.equal(saved().lastVersion, "1.0");
  assert.equal(pendingVersion(), null);
});

test("an update to a version with notes queues the postcard, once", () => {
  shell.docs.set("release-notes.json", JSON.stringify({ version: 1, lastVersion: "0.9", pending: null }));
  notes.trackAppVersion();
  assert.equal(pendingVersion(), "1.0");
  // Relaunching the same version keeps it until it's opened or dismissed…
  notes.trackAppVersion();
  assert.equal(pendingVersion(), "1.0");
  // …and retiring it is remembered.
  notes.retireReleaseNotes();
  notes.trackAppVersion();
  assert.equal(pendingVersion(), null);
});

test("installs from before release notes existed count as updated", () => {
  shell.docs.set("session.json", "{}");
  notes.trackAppVersion();
  assert.equal(pendingVersion(), "1.0");
});

test("an update without notes shows nothing", () => {
  shell.appInfo.appVersion = "9.9";
  shell.docs.set("release-notes.json", JSON.stringify({ version: 1, lastVersion: "1.0", pending: null }));
  notes.trackAppVersion();
  assert.equal(saved().lastVersion, "9.9");
  assert.equal(pendingVersion(), null);
});

test("the postcard expires after a day", () => {
  const since = Date.now() - (notes.POSTCARD_SECONDS + 60) * 1000;
  shell.docs.set("release-notes.json", JSON.stringify({ version: 1, lastVersion: "1.0", pending: { version: "1.0", since } }));
  notes.trackAppVersion();
  assert.equal(pendingVersion(), null);
});
