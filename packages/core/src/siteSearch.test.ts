import assert from "node:assert/strict";
import { test } from "node:test";
import { allEngines, BUILT_IN_ENGINES } from "./engines.ts";
import { findScope, scopedSearchUrl } from "./siteSearch.ts";

const engines = allEngines([{ id: "c1", name: "Wikipedia (en)", keyword: "w", url: "https://en.wikipedia.org/w/index.php?search=%s" }]);
const google = BUILT_IN_ENGINES[0]!;

test("Tab-to-search: popular sites by host, by name, or by a completed URL", () => {
  assert.equal(findScope("youtube.com", { engines })?.name, "YouTube");
  assert.equal(findScope("https://www.youtube.com/", { engines })?.name, "YouTube");
  assert.equal(findScope("youtube", { engines })?.name, "YouTube");
  assert.equal(findScope("youtube.com/watch?v=abc", { engines })?.host, "youtube.com");
  assert.equal(findScope("en.wikipedia.org", { engines })?.name, "Wikipedia");
  assert.equal(findScope("you", { engines }), null);
  assert.equal(findScope("youtube cats", { engines }), null);
});

test("Tab-to-search: engine hosts and custom keywords", () => {
  assert.deepEqual(findScope("duckduckgo.com", { engines }), {
    kind: "engine",
    name: "DuckDuckGo",
    host: "duckduckgo.com",
    url: "https://duckduckgo.com/?q=%s",
    engineId: "duckduckgo",
  });
  assert.equal(findScope("bing", { engines })?.engineId, "bing");
  assert.equal(findScope("W", { engines })?.engineId, "c1");
  // A custom keyword beats a site with the same text.
  assert.equal(findScope("w", { engines })?.kind, "engine");
});

test("Tab-to-search: visited hosts without a known search use site:", () => {
  const scope = findScope("docs.example.com", { engines, hosts: ["docs.example.com"] });
  assert.deepEqual(scope, { kind: "history", name: "docs.example.com", host: "docs.example.com", url: "" });
  assert.equal(scopedSearchUrl(scope!, "install guide", google), "https://www.google.com/search?q=site%3Adocs.example.com%20install%20guide");
  assert.equal(findScope("docs.example.com", { engines }), null);
});

test("scopedSearchUrl uses the site's own search", () => {
  const yt = findScope("youtube.com", { engines })!;
  assert.equal(scopedSearchUrl(yt, "lo-fi beats", google), "https://www.youtube.com/results?search_query=lo-fi%20beats");
});
