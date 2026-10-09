// The kill switches (lib/killSwitches.ts): the registry's cap and expiry, how values are read, fetched and cached, and the
// file the site serves.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { docs } = await import("../test-native-stub.mjs");
const ks = await import("./killSwitches.ts");

const names = Object.keys(ks.SWITCHES);
const reset = () => {
  docs.clear();
  ks.reloadSwitches();
  ks.resetRefreshForTests();
};
const answer = (body, { ok = true } = {}) => async () => ({ ok, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
const file = (switches) => ({ version: 1, switches });

test("at most 8 live switches, each on by default with an owner and a removal date still ahead", () => {
  assert.ok(names.length <= ks.MAX_SWITCHES, `${names.length} switches: delete one before adding another (cap ${ks.MAX_SWITCHES})`);
  const today = new Date().toISOString().slice(0, 10);
  for (const name of names) {
    const def = ks.SWITCHES[name];
    assert.match(def.removeBy, /^\d{4}-\d{2}-\d{2}$/, name);
    assert.ok(def.removeBy >= today, `${name} is past its removal date (${def.removeBy}): delete it and its old path, or move the date with a reason`);
    assert.ok(def.owner.trim() && def.about.trim(), name);
    assert.equal(typeof def.live, "boolean", name);
  }
  reset();
  for (const name of names) assert.equal(ks.switchOn(name), true, `${name} defaults on`);
});

test("the site's switches.json is a version 1 file naming only switches the app knows, as booleans", () => {
  const site = JSON.parse(readFileSync(new URL("../../../site/public/switches.json", import.meta.url), "utf8"));
  assert.equal(site.version, 1);
  for (const [name, value] of Object.entries(site.switches)) {
    assert.ok(names.includes(name), `switches.json names ${name}, which the app doesn't have: remove it`);
    assert.equal(typeof value, "boolean", name);
  }
  assert.ok(JSON.stringify(site).length < 4096);
});

test("a cached value is read synchronously; unknown names and non-booleans are ignored", () => {
  reset();
  docs.set("switches-cache.json", JSON.stringify(file({ sidebarSlide: false, newTabPrewarm: "no", gone: false, lazySidebarRows: 0 })));
  assert.equal(ks.switchOn("sidebarSlide"), false);
  assert.equal(ks.switchOn("newTabPrewarm"), true);
  assert.equal(ks.switchOn("lazySidebarRows"), true);
  reset();
  docs.set("switches-cache.json", "not json");
  assert.equal(ks.switchOn("sidebarSlide"), true);
});

test("ARCADIA_SWITCHES text parses to values, and ignores what it doesn't know", () => {
  assert.deepEqual(ks.parseOverride("sidebarSlide=off, lazySidebarRows=on,nope=off,newTabPrewarm=maybe,=1"), {
    sidebarSlide: false,
    lazySidebarRows: true,
  });
  assert.deepEqual(ks.parseOverride(null), {});
});

test("a fetch asks for the plain URL (no cookies, no query), saves the answer, and applies it now only to a live switch", async () => {
  reset();
  let asked;
  const fetchFn = async (url, init) => {
    asked = { url, init };
    return answer(file({ sidebarSlide: false, lazySidebarRows: false }))();
  };
  assert.equal(await ks.refreshSwitches(fetchFn), "updated");
  assert.equal(asked.url, "https://netnyahoo.com/switches.json");
  assert.equal(asked.init.credentials, "omit");
  assert.equal(asked.init.headers, undefined);
  assert.ok(!asked.url.includes("?"));
  // live: sidebarSlide is off at once; lazySidebarRows keeps this launch's value (on).
  assert.equal(ks.switchOn("sidebarSlide"), false);
  assert.equal(ks.switchOn("lazySidebarRows"), true);
  // The next launch reads both from the cache.
  ks.reloadSwitches();
  assert.equal(ks.switchOn("sidebarSlide"), false);
  assert.equal(ks.switchOn("lazySidebarRows"), false);
});

test("at most one fetch a launch", async () => {
  reset();
  let n = 0;
  const fetchFn = async () => (n++, answer(file({}))());
  assert.equal(await ks.refreshSwitches(fetchFn), "updated");
  assert.equal(await ks.refreshSwitches(fetchFn), "already");
  assert.equal(n, 1);
});

test("a switch the file stops naming goes back on (staleness: the cache follows the file, not the first answer)", async () => {
  reset();
  await ks.refreshSwitches(answer(file({ sidebarSlide: false })));
  assert.equal(ks.switchOn("sidebarSlide"), false);
  ks.resetRefreshForTests();
  await ks.refreshSwitches(answer(file({})));
  assert.equal(ks.switchOn("sidebarSlide"), true);
  ks.reloadSwitches();
  assert.equal(ks.switchOn("sidebarSlide"), true);
});

test("offline, an error, an odd answer or a slow one keeps the cached value (or the default)", async () => {
  for (const [label, fetchFn] of [
    ["offline", async () => Promise.reject(new TypeError("Network request failed"))],
    ["404", answer("", { ok: false })],
    ["html", answer("<html>")],
    ["wrong version", answer({ version: 2, switches: { sidebarSlide: true } })],
    ["no switches", answer({ version: 1 })],
    ["huge", answer(file({ sidebarSlide: true, pad: "x".repeat(5000) }))],
  ]) {
    reset();
    docs.set("switches-cache.json", JSON.stringify(file({ sidebarSlide: false })));
    const before = docs.get("switches-cache.json");
    assert.equal(await ks.refreshSwitches(fetchFn), "failed", label);
    assert.equal(ks.switchOn("sidebarSlide"), false, label);
    assert.equal(docs.get("switches-cache.json"), before, label);
  }
  reset();
  assert.equal(await ks.refreshSwitches(answer("<html>")), "failed");
  assert.equal(ks.switchOn("sidebarSlide"), true);
});

test("a slow answer is dropped after the timeout", async (t) => {
  reset();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const slow = (_url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  const result = ks.refreshSwitches(slow);
  t.mock.timers.tick(5000);
  assert.equal(await result, "failed");
  assert.equal(ks.switchOn("sidebarSlide"), true);
});
