// The bar asks for a profile's known hosts on every key; the answer is kept while the tabs and history are the same objects
// and must follow them when they change.
import assert from "node:assert/strict";
import { test } from "node:test";
import { knownHosts } from "./knownHosts.ts";

const tab = (id, profileId, url) => ({ id, profileId, url });
const entry = (url) => ({ url, title: "", favicon: null, visits: 1, lastVisit: 0 });

test("known hosts: open tabs of the profile, then its history hosts, once each", () => {
  const tabs = { a: tab("a", "p", "https://www.github.com/x"), b: tab("b", "q", "https://other.org/"), c: tab("c", "p", ""), d: tab("d", "p", "https://x.com/") };
  const history = { p: [entry("https://x.com/home"), entry("https://news.ycombinator.com/"), entry("https://x.com/b")] };
  const s = { tabs, history };
  assert.deepEqual(knownHosts(s, "p"), ["github.com", "x.com", "x.com", "news.ycombinator.com"]);
  assert.equal(knownHosts(s, "p"), knownHosts(s, "p"));
  assert.deepEqual(knownHosts(s, "q"), ["other.org"]);
  assert.deepEqual(knownHosts(s, "p"), ["github.com", "x.com", "x.com", "news.ycombinator.com"]);
});

test("known hosts follow a new tabs map and a new history list", () => {
  const history = { p: [entry("https://a.com/")] };
  const s1 = { tabs: { a: tab("a", "p", "https://b.com/") }, history };
  assert.deepEqual(knownHosts(s1, "p"), ["b.com", "a.com"]);
  const s2 = { tabs: { ...s1.tabs, c: tab("c", "p", "https://c.com/") }, history };
  assert.deepEqual(knownHosts(s2, "p"), ["b.com", "c.com", "a.com"]);
  const s3 = { tabs: s2.tabs, history: { p: [entry("https://d.com/")] } };
  assert.deepEqual(knownHosts(s3, "p"), ["b.com", "c.com", "d.com"]);
  assert.deepEqual(knownHosts({ tabs: {}, history: {} }, "none"), []);
});
