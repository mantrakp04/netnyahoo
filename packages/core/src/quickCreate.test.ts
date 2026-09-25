import assert from "node:assert/strict";
import { test } from "node:test";
import { matchActions, fuzzyScore } from "./fuzzy.ts";
import { matchQuickCreate } from "./quickCreate.ts";

const titles = (q: string, limit?: number) => matchQuickCreate(q, limit).map((c) => c.title);

test("new … commands match Dia's list", () => {
  assert.deepEqual(titles("new doc"), ["New Google Doc"]);
  assert.deepEqual(titles("new sheet"), ["New Google Sheet"]);
  assert.deepEqual(titles("New Slides"), ["New Google Slides"]);
  assert.deepEqual(titles("new form"), ["New Google Form"]);
  assert.deepEqual(titles("new jira"), ["New Jira Issue"]);
  assert.deepEqual(titles("new wiki"), ["New Confluence Page"]);
  assert.deepEqual(titles("new gist"), ["New GitHub Gist"]);
  assert.deepEqual(titles("new figma"), ["New Figma Design"]);
  assert.deepEqual(titles("new meeting"), ["New Google Calendar Event"]);
  assert.deepEqual(titles("create spreadsheet"), ["New Google Sheet"]);
  assert.equal(matchQuickCreate("new doc")[0]?.url, "https://docs.new");
});

test("new … prefix matching, ambiguity and non-matches", () => {
  assert.deepEqual(titles("new ticket"), ["New Linear Issue", "New Jira Issue"]);
  assert.deepEqual(titles("new fi"), ["New Figma Design", "New FigJam Board"]);
  assert.equal(titles("new ").length, 3);
  assert.deepEqual(titles("new"), []);
  assert.deepEqual(titles("new york"), []);
  assert.deepEqual(titles("newspaper"), []);
});

test("action fuzzy matching: prefixes, words, subsequences", () => {
  const actions = [
    { id: "closeTab", title: "Close Tab" },
    { id: "closeAllTabs", title: "Close All Tabs" },
    { id: "newWindow", title: "New Window" },
    { id: "togglePin", title: "Pin Tab" },
    { id: "downloads", title: "Show Downloads", keywords: ["dl"] },
    { id: "settings", title: "Settings", keywords: ["preferences"] },
  ];
  const ids = (q: string) => matchActions(q, actions).map((m) => m.action.id);
  assert.equal(ids("close tab")[0], "closeTab");
  assert.equal(matchActions("close tab", actions)[0]?.exact, true);
  assert.equal(ids("clo")[0], "closeTab");
  assert.equal(ids("new win")[0], "newWindow");
  assert.equal(ids("nwin")[0], "newWindow");
  assert.equal(ids("pin")[0], "togglePin");
  assert.equal(ids("downloads")[0], "downloads");
  assert.equal(matchActions("dl", actions)[0]?.exact, true);
  assert.equal(ids("prefs")[0], "settings");
  assert.deepEqual(ids("x"), []);
  assert.deepEqual(ids("zebra"), []);
  assert.ok(fuzzyScore("tab", "Close Tab") > fuzzyScore("tab", "Close All Tabs") - 10);
});
