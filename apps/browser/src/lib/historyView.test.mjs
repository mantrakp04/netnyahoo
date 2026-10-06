// Staleness of the history view's coalescing (db144ef6: one engine event's changes are one store update) and of the
// first-window-deferred history.json move (d7e6372a): what Chrome has is what the view shows after a visit, a title
// change, a deletion, a clear and a relaunch, and a quit at any point of the move loses nothing.
import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { useBrowser } = await import("../store/browser.ts");
const { reloadHistory, startHistory } = await import("./history.ts");
const { firstWindowCommitted } = await import("./afterFirstWindow.ts");
const stub = await import("../test-native-stub.mjs");

const S = () => useBrowser.getState();
const tick = () => new Promise((r) => setTimeout(r, 0));
const view = () => (S().history.default ?? []).map((h) => `${h.url} ${h.title} ${h.visits}`);
const until = async (ok, what) => {
  for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(ok(), what);
};

test("the view follows Chrome: a burst of visits, a retitle, a deletion, a clear, a relaunch", async () => {
  S().hydrate({});
  stub.docs.clear();
  stub.historyDbs.clear();
  const stop = startHistory();
  await reloadHistory();
  let updates = 0;
  const off = useBrowser.subscribe((s, prev) => void (s.history !== prev.history && updates++));

  // One event's changes (a visit with its redirect and title): shown together, in one store update.
  const t0 = Date.now() - 60_000;
  stub.chromeVisit("", "https://b.com/", "B", t0);
  stub.chromeVisit("", "https://a.com/", "A", t0 + 1);
  stub.chromeVisit("", "https://a.com/", "A", t0 + 2);
  await tick();
  assert.deepEqual(view(), ["https://a.com/ A 2", "https://b.com/ B 1"], "created: shows");
  assert.equal(updates, 1, "one store update for the burst");

  stub.chromeHistoryEvent({ kind: "modified", profile: "", rows: [{ url: "https://b.com/", title: "B retitled", visits: 1 }] });
  await tick();
  assert.deepEqual(view(), ["https://a.com/ A 2", "https://b.com/ B retitled 1"], "updated: the new title shows");

  // A visit and a deletion of the same page in one event: the deletion, after it, wins.
  stub.chromeVisit("", "https://c.com/", "C", t0 + 3);
  stub.chromeHistoryEvent({ kind: "deleted", profile: "", all: false, urls: ["https://c.com/"] });
  await tick();
  assert.deepEqual(view(), ["https://a.com/ A 2", "https://b.com/ B retitled 1"], "visited then deleted in one event: gone");

  S().removeHistory("default", ["https://a.com/"]);
  assert.deepEqual(view(), ["https://b.com/ B retitled 1"], "deleted: gone from the view at once");
  await tick();
  assert.deepEqual(view(), ["https://b.com/ B retitled 1"], "and stays gone once Chrome's event lands");

  // Clear Browsing Data: the view empties at once; Chrome's "deleted all" re-reads it; a visit after it shows.
  S().clearHistory("default");
  stub.chromeHistory("").clear();
  stub.chromeHistoryEvent({ kind: "deleted", profile: "", all: true, urls: [] });
  stub.chromeVisit("", "https://after.com/", "After");
  await until(() => view().length === 1, "the visit after the clear");
  assert.deepEqual(view(), ["https://after.com/ After 1"], "cleared, then the next visit only");

  // A relaunch reads Chrome again: nothing the view dropped comes back, nothing it had is lost.
  await reloadHistory();
  assert.deepEqual(view(), ["https://after.com/ After 1"], "relaunch");
  off();
  stop();
});

test("a change that lands while the view is being read joins the read, in order", async () => {
  S().hydrate({});
  stub.historyDbs.clear();
  const stop = startHistory();
  const reading = reloadHistory();
  stub.chromeVisit("", "https://during.com/", "During");
  await reading;
  await tick();
  assert.deepEqual(view(), ["https://during.com/ During 1"]);
  stop();
});

const DAY = 86_400_000;
const legacy = (urls, now) =>
  JSON.stringify({ version: 2, history: { default: urls.map((url) => ({ url, title: url, favicon: null, visits: 2, lastVisit: now - 1000, visitTimes: [now - DAY, now - 1000] })) } });

test("history.json: a quit before the first window leaves it untouched for the next launch", async () => {
  S().hydrate({});
  stub.docs.clear();
  stub.historyDbs.clear();
  const now = Date.now();
  stub.docs.set("history.json", legacy(["https://old.com/"], now));
  // Launch 1 quits before its first window committed: nothing moved, the file is still there.
  const stop1 = startHistory();
  await new Promise((r) => setTimeout(r, 30));
  stop1();
  firstWindowCommitted();
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(stub.docs.has("history.json"), "the file stays for the next launch");
  assert.equal(stub.chromeHistory("").size, 0, "nothing half-moved");
  assert.equal(S().history.default, undefined, "and no view read while it waited");
});

test("history.json: a quit right after the move keeps the file until Chrome has committed; moving again adds nothing twice", async () => {
  S().hydrate({});
  stub.docs.clear();
  stub.historyDbs.clear();
  const now = Date.now();
  stub.docs.set("history.json", legacy(["https://old.com/", "https://older.com/"], now));
  // afterFirstWindow already ran once in this process (the test above): later launches' moves run at once.
  const stop1 = startHistory();
  await until(() => (S().history.default ?? []).length === 2, "moved and shown");
  stop1();
  assert.ok(stub.docs.has("history.json"), "kept a while after the move (Chrome commits a few seconds later)");
  const visits = () => [...stub.chromeHistory("").values()].map((r) => r.visits.length);
  assert.deepEqual(visits(), [2, 2]);
  // Launch 2 (the quit came before Chrome committed): moves it again, adding nothing Chrome already has.
  S().hydrate({});
  const stop2 = startHistory();
  await until(() => (S().history.default ?? []).length === 2, "shown after the second launch");
  assert.deepEqual(visits(), [2, 2], "no visit doubled");
  assert.deepEqual(
    S().history.default.map((h) => h.url).sort(),
    ["https://old.com/", "https://older.com/"],
  );
  stop2();
});
