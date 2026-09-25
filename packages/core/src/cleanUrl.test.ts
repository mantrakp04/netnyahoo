import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanUrl, hasTrackingParams, isTrackingParam, markdownLink } from "./cleanUrl.ts";

test("cleanUrl drops campaign and click-id parameters", () => {
  assert.equal(
    cleanUrl("https://example.com/post?utm_source=newsletter&utm_medium=email&utm_campaign=fall"),
    "https://example.com/post",
  );
  assert.equal(cleanUrl("https://example.com/?fbclid=IwAR0abc"), "https://example.com/");
  assert.equal(cleanUrl("https://shop.example/item?id=42&gclid=Cj0KCQ&color=red"), "https://shop.example/item?id=42&color=red");
  assert.equal(cleanUrl("https://news.example/a?mc_eid=123&mc_cid=456&page=2"), "https://news.example/a?page=2");
  assert.equal(cleanUrl("https://x.example/?_hsenc=p2A&_hsmi=1&msclkid=9"), "https://x.example/");
  assert.equal(cleanUrl("https://example.com/?UTM_Source=caps"), "https://example.com/");
});

test("cleanUrl keeps the rest of the URL exactly as it was", () => {
  assert.equal(cleanUrl("https://example.com/a?q=a%20b&utm_source=x#section-2"), "https://example.com/a?q=a%20b#section-2");
  assert.equal(cleanUrl("https://example.com/a?utm_source=x#frag?utm_medium=y"), "https://example.com/a#frag?utm_medium=y");
  assert.equal(cleanUrl("https://example.com/search?q=utm_source"), "https://example.com/search?q=utm_source");
  assert.equal(cleanUrl("https://example.com/?b=2&a=1"), "https://example.com/?b=2&a=1");
  assert.equal(cleanUrl("https://example.com/path"), "https://example.com/path");
  assert.equal(cleanUrl("https://user:pw@example.com:8443/p?utm_term=x&k"), "https://user:pw@example.com:8443/p?k");
});

test("site-specific parameters are only stripped on their site", () => {
  assert.equal(cleanUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abcDEF"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(cleanUrl("https://youtu.be/dQw4w9WgXcQ?si=abc&t=42"), "https://youtu.be/dQw4w9WgXcQ?t=42");
  assert.equal(cleanUrl("https://open.spotify.com/track/1?si=zz"), "https://open.spotify.com/track/1");
  assert.equal(cleanUrl("https://x.com/user/status/1?s=20&t=abc"), "https://x.com/user/status/1");
  assert.equal(cleanUrl("https://www.instagram.com/p/xyz/?igsh=MWQ1"), "https://www.instagram.com/p/xyz/");
  // `si`, `s` and `t` mean something else elsewhere.
  assert.equal(cleanUrl("https://example.com/?si=1&s=2&t=3"), "https://example.com/?si=1&s=2&t=3");
  assert.equal(
    cleanUrl("https://www.amazon.com/dp/B00X?pd_rd_w=a&pf_rd_p=b&th=1&psc=1"),
    "https://www.amazon.com/dp/B00X?th=1",
  );
});

test("non-web and unparsable URLs pass through", () => {
  assert.equal(cleanUrl("file:///tmp/a.html?utm_source=x"), "file:///tmp/a.html?utm_source=x");
  assert.equal(cleanUrl("not a url?utm_source=x"), "not a url?utm_source=x");
  assert.equal(cleanUrl(""), "");
});

test("helpers", () => {
  assert.equal(isTrackingParam("utm_content"), true);
  assert.equal(isTrackingParam("si", "music.youtube.com"), true);
  assert.equal(isTrackingParam("si", "example.com"), false);
  assert.equal(hasTrackingParams("https://a.com/?gclid=1"), true);
  assert.equal(hasTrackingParams("https://a.com/?id=1"), false);
});

test("markdownLink escapes brackets and cleans the URL", () => {
  assert.equal(markdownLink("A [b] c", "https://x.com/?utm_source=a&q=1"), "[A \\[b\\] c](https://x.com/?q=1)");
  assert.equal(markdownLink("", "https://x.com/"), "[https://x.com/](https://x.com/)");
});
