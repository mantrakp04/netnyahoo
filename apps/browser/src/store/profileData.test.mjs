// Run from apps/browser:  node --import ./src/store/test-loader.mjs --test src/store/profileData.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const { flushPersistence, loadSession, startPersistence } = await import("../lib/persist.ts");
const stub = await import("./test-native-stub.mjs");

const S = () => useBrowser.getState();
const settle = () => new Promise((resolve) => setTimeout(resolve, 1700));

test("deleting the original profile queues Chrome's default profile for deletion", () => {
  S().hydrate({});
  const work = S().createProfile({ name: "Work" });
  S().deleteProfile("default");
  assert.deepEqual(S().orphanedProfileData, [""]);
  S().deleteProfile(work);
  assert.deepEqual(S().orphanedProfileData, [""], "the last profile can't be deleted");
});

test("a profile sharing another's data leaves nothing to delete until the last one goes", () => {
  S().hydrate({});
  const shared = S().createProfile({ name: "Shared", shareWith: "default" });
  const other = S().createProfile({ name: "Other" });
  S().deleteProfile("default");
  assert.deepEqual(S().orphanedProfileData, []);
  S().deleteProfile(shared);
  assert.deepEqual(S().orphanedProfileData, [""]);
  S().createProfile({ name: "New" });
  S().deleteProfile(other);
  assert.deepEqual(S().orphanedProfileData, ["", other]);
});

test("queued profile data is deleted once, and stays queued in session.json until that succeeds", async () => {
  stub.docs.clear();
  stub.deletedProfileData.length = 0;
  stub.profileDataLeft.set("", ["passwords"]);
  S().hydrate({});
  const stop = startPersistence();
  const work = S().createProfile({ name: "Work" });
  S().createWindow({ profileId: work, url: "https://work.example/" });
  S().deleteProfile("default");
  await settle();
  assert.deepEqual(stub.deletedProfileData, [""]);
  assert.deepEqual(S().orphanedProfileData, [""], "a failed deletion stays queued");
  flushPersistence();
  stop();
  assert.deepEqual(loadSession().data.orphanedProfileData, [""]);

  // Next launch: it's tried again and leaves the queue once it succeeds.
  stub.profileDataLeft.clear();
  const again = startPersistence();
  await settle();
  assert.deepEqual(stub.deletedProfileData, ["", ""]);
  assert.deepEqual(S().orphanedProfileData, []);
  flushPersistence();
  assert.deepEqual(loadSession().data.orphanedProfileData, []);
  again();
});
