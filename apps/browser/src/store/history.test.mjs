import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const { historyDocument } = await import("./history.ts");

const S = () => useBrowser.getState();
const doc = () => historyDocument(2, S().history);
const reference = () => JSON.stringify({ version: 2, history: S().history });

test("history.json is byte for byte JSON.stringify's, visit after visit", () => {
  S().hydrate({});
  S().createProfile({ name: "Work" });
  const work = S().profileOrder[1];
  S().recordVisit("default", "https://a.com/", 'Quotes " and \\ and   and ✨', null, true);
  S().recordVisit("default", "https://b.com/", "B", "https://b.com/favicon.ico", true);
  S().recordVisit(work, "https://c.com/", "", null, true);
  assert.equal(doc(), reference());
  S().recordVisit("default", "https://a.com/", "A again", null, true);
  assert.equal(doc(), reference(), "a changed entry is serialized anew");
  S().recordVisit("default", "https://b.com/", "B", "https://b.com/new.ico");
  assert.equal(doc(), reference(), "a favicon update is serialized anew");
  S().removeHistory("default", ["https://b.com/"]);
  S().clearHistory(work);
  assert.equal(doc(), reference());
});

test("imported entries, numeric-looking profile keys and optional fields match too", () => {
  const history = {
    123: [{ url: "https://x.com/", title: "X", favicon: null, visits: 3, lastVisit: 5 }],
    default: [
      { url: "https://y.com/", title: "Y", favicon: null, visits: 1, lastVisit: 1, visitTimes: [1] },
      { url: "https://z.com/", title: "Z", favicon: undefined, visits: 2, lastVisit: 2, visitTimes: undefined },
    ],
    empty: [],
    broken: [null, undefined, 3, "x"],
  };
  assert.equal(historyDocument(2, history), JSON.stringify({ version: 2, history }));
  assert.equal(historyDocument(2, {}), JSON.stringify({ version: 2, history: {} }));
});
