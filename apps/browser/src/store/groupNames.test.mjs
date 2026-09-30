import assert from "node:assert/strict";
import { test } from "node:test";
const { autoGroupName } = await import("./groupNames.ts");

// Run: node --import ./src/store/test-loader.mjs --test src/store/groupNames.test.mjs
const t = (url, title = "") => ({ url, title });

test("one site, one page: site and page", () => {
  assert.equal(autoGroupName([t("https://x.com/home", "Home / X"), t("https://x.com/home", "Home / X"), t("https://x.com/home", "Home / X")]), "X Home");
});

test("one site, several pages: the site", () => {
  assert.equal(autoGroupName([t("https://x.com/home", "Home / X"), t("https://x.com/elonmusk", "Elon Musk (@elonmusk) / X")]), "X");
  assert.equal(
    autoGroupName([t("https://www.youtube.com/watch?v=1", "Never Gonna Give You Up - YouTube"), t("https://www.youtube.com/watch?v=2", "Lo-fi beats - YouTube")]),
    "YouTube",
  );
  assert.equal(
    autoGroupName([t("https://github.com/a/b", "GitHub - a/b: A thing"), t("https://github.com/c/d/pulls", "Pull requests · c/d · GitHub")]),
    "GitHub",
  );
});

test("tabs still loading take the site from a loaded tab of their host, or from the host", () => {
  assert.equal(autoGroupName([t("https://x.com/home", "Home / X"), t("https://x.com/home"), t("https://x.com/home")]), "X Home");
  assert.equal(autoGroupName([t("https://x.com/home", "Home / X"), t("https://x.com/explore")]), "X");
  assert.equal(autoGroupName([t("https://x.com/home"), t("https://x.com/home")]), "X");
  assert.equal(autoGroupName([t("https://news.ycombinator.com/"), t("https://news.ycombinator.com/newest")]), "Ycombinator");
});

test("the site at the start of the title, and hosts that don't spell it", () => {
  assert.equal(
    autoGroupName([t("https://en.wikipedia.org/wiki/Cat", "Cat - Wikipedia"), t("https://en.wikipedia.org/wiki/Dog", "Dog - Wikipedia")]),
    "Wikipedia",
  );
  assert.equal(
    autoGroupName([t("https://mail.google.com/mail/u/0/#inbox", "Inbox (3) - someone@example.com - Gmail"), t("https://mail.google.com/mail/u/0/#sent", "Sent - someone@example.com - Gmail")]),
    "Gmail",
  );
});

test("different sites: the first tab's site", () => {
  assert.equal(autoGroupName([t("https://x.com/home", "Home / X"), t("https://www.youtube.com/", "YouTube")]), "X");
  assert.equal(autoGroupName([]), "");
});
