// The offer to be the default browser again after the rename (lib/defaultBrowserOffer.ts): asked once, only when the
// launch migration left the offer, never in a test instance or over onboarding.
import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { DEFAULT_BROWSER_OFFER, offerDefaultBrowserAgain } = await import("./defaultBrowserOffer.ts");

function deps(offer, overrides = {}) {
  const docs = new Map(offer === undefined ? [] : [[DEFAULT_BROWSER_OFFER, typeof offer === "string" ? offer : JSON.stringify(offer)]]);
  const calls = [];
  return {
    docs,
    calls,
    read: (name) => docs.get(name) ?? null,
    save: async (name, contents) => void docs.set(name, contents),
    testInstance: false,
    onboarding: false,
    isDefault: async () => (calls.push("isDefault"), false),
    setDefault: async () => (calls.push("setDefault"), true),
    ...overrides,
  };
}
const askedAt = (d) => JSON.parse(d.docs.get(DEFAULT_BROWSER_OFFER)).askedAt;

test("asks once, through the set-default path, and records it first", async () => {
  const d = deps({ version: 1, askedAt: null });
  assert.equal(await offerDefaultBrowserAgain(d), "asked");
  assert.deepEqual(d.calls, ["isDefault", "setDefault"]);
  assert.equal(typeof askedAt(d), "number");
  assert.equal(await offerDefaultBrowserAgain(d), "none");
  assert.deepEqual(d.calls, ["isDefault", "setDefault"]);
});

test("nothing without the migration's offer, or a broken one", async () => {
  for (const offer of [undefined, "{", "null"]) {
    const d = deps(offer);
    assert.equal(await offerDefaultBrowserAgain(d), "none");
    assert.deepEqual(d.calls, []);
  }
});

test("never in a test instance, and the offer stays for nothing else to take", async () => {
  const d = deps({ version: 1, askedAt: null }, { testInstance: true });
  assert.equal(await offerDefaultBrowserAgain(d), "testInstance");
  assert.deepEqual(d.calls, []);
  assert.equal(askedAt(d), null);
});

test("a marker that can't be saved never asks", async () => {
  const d = deps({ version: 1, askedAt: null }, { save: async () => { throw new Error("read-only"); } });
  await assert.rejects(offerDefaultBrowserAgain(d));
  assert.deepEqual(d.calls, []);
});

test("onboarding's own step asks instead; already the default asks nothing", async () => {
  const onboarding = deps({ version: 1, askedAt: null }, { onboarding: true });
  assert.equal(await offerDefaultBrowserAgain(onboarding), "onboarding");
  assert.deepEqual(onboarding.calls, []);
  assert.equal(typeof askedAt(onboarding), "number");
  const already = deps({ version: 1, askedAt: null }, { isDefault: async () => true });
  assert.equal(await offerDefaultBrowserAgain(already), "alreadyDefault");
  assert.equal(typeof askedAt(already), "number");
});
