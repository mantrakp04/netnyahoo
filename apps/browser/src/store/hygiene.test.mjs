import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const { downloadsIn, downloadVisibleIn } = await import("./ui.ts");
const { withoutVisitsSince, MAX_VISIT_TIMES } = await import("./history.ts");
const { flushPersistence, loadSession, startPersistence } = await import("../lib/persist.ts");
const stub = await import("./test-native-stub.mjs");

const S = () => useBrowser.getState();
const HOUR = 3_600_000;

function withClock(times, run) {
  const now = Date.now;
  let i = 0;
  Date.now = () => times[Math.min(i++, times.length - 1)];
  try {
    run();
  } finally {
    Date.now = now;
  }
}

test("clearing a time range removes visits, not pages", () => {
  S().hydrate({});
  const t0 = 1_700_000_000_000;
  withClock([t0 - 5 * HOUR], () => S().recordVisit("default", "https://a.com/", "A", null, true));
  withClock([t0 - 10 * 60_000], () => S().recordVisit("default", "https://a.com/", "A", null, true));
  withClock([t0 - 5 * 60_000], () => S().recordVisit("default", "https://b.com/", "B", null, true));
  assert.deepEqual(S().history.default.map((h) => [h.url, h.visits]), [["https://b.com/", 1], ["https://a.com/", 2]]);

  S().clearHistory("default", t0 - HOUR);
  const [a, ...rest] = S().history.default;
  assert.equal(rest.length, 0, "b.com was only visited in the last hour");
  assert.equal(a.url, "https://a.com/");
  assert.equal(a.visits, 1);
  assert.equal(a.lastVisit, t0 - 5 * HOUR);
  assert.deepEqual(a.visitTimes, [t0 - 5 * HOUR]);

  S().clearHistory("default");
  assert.deepEqual(S().history.default, []);
});

test("withoutVisitsSince handles old entries and capped visit lists", () => {
  const since = 1000;
  assert.equal(withoutVisitsSince({ url: "u", title: "", favicon: null, visits: 7, lastVisit: 2000 }, since), null);
  const old = { url: "u", title: "", favicon: null, visits: 7, lastVisit: 500 };
  assert.equal(withoutVisitsSince(old, since), old);
  const times = Array.from({ length: MAX_VISIT_TIMES }, (_, i) => 900 + i * 10);
  const kept = withoutVisitsSince({ url: "u", title: "", favicon: null, visits: 60, lastVisit: times.at(-1), visitTimes: times }, since);
  assert.equal(kept.visitTimes.length, 10);
  assert.equal(kept.visits, 20);
  assert.equal(kept.lastVisit, 990);
});

test("recordVisit caps visit times", () => {
  S().hydrate({});
  for (let i = 0; i < MAX_VISIT_TIMES + 5; i++) withClock([1000 + i], () => S().recordVisit("default", "https://a.com/", "A", null, true));
  const [a] = S().history.default;
  assert.equal(a.visits, MAX_VISIT_TIMES + 5);
  assert.equal(a.visitTimes.length, MAX_VISIT_TIMES);
  assert.equal(a.visitTimes[0], 1005);
});

const download = (id, profile, state = "finished") => ({
  id,
  url: `https://files.example/${id}`,
  filename: `${id}.zip`,
  path: `/tmp/${id}.zip`,
  state,
  paused: false,
  received: 1,
  total: 1,
  speed: 0,
  mimeType: "application/zip",
  profile,
});

test("incognito downloads show only in their own window", () => {
  S().hydrate({});
  const normal = S().createWindow();
  const incognito = S().createWindow({ incognito: true });
  const privateProfile = S().windows[incognito].profileId;
  assert.ok(privateProfile.startsWith("incognito:"));

  S().setFocusedWindow(normal);
  S().upsertDownload(download("1", ""));
  S().setFocusedWindow(incognito);
  S().upsertDownload(download("2", privateProfile));
  S().upsertDownload(download("3", undefined));

  assert.deepEqual(downloadsIn(S(), normal).map((d) => d.id), ["3", "1"]);
  assert.deepEqual(downloadsIn(S(), incognito).map((d) => d.id), ["2"]);
  assert.equal(S().windowUi[incognito]?.downloadsOpen, true);
  assert.equal(downloadVisibleIn(download("x", privateProfile), S().windows[normal]), false);

  S().clearDownloads(normal);
  assert.deepEqual(S().downloads.map((d) => d.id), ["2"]);
  S().forgetDownloads(privateProfile);
  assert.deepEqual(S().downloads, []);
});

test("incognito downloads never reach downloads.json and leave with their window", async () => {
  stub.docs.clear();
  const stop = startPersistence();
  const normal = S().createWindow();
  const incognito = S().createWindow({ incognito: true });
  const privateProfile = S().windows[incognito].profileId;
  S().upsertDownload(download("1", ""));
  S().upsertDownload(download("2", privateProfile, "downloading"));
  flushPersistence();
  const saved = JSON.parse(stub.docs.get("downloads.json")).downloads;
  assert.deepEqual(saved.map((d) => d.id), ["1"]);

  S().closeWindow(incognito);
  assert.deepEqual(S().downloads.map((d) => d.id), ["1"]);
  assert.ok(S().windows[normal]);
  S().upsertDownload(download("2", privateProfile, "cancelled"));
  assert.deepEqual(S().downloads.map((d) => d.id), ["1"]);

  const { data } = loadSession();
  assert.deepEqual(data.downloads.map((d) => d.id), ["saved-0"]);
  stop();
});

test("favicons: incognito icons stay in memory and in their own profile", async () => {
  const { noteFavicon, resolveFavicon, flushFavicons, useFavicons } = await import("../lib/favicons.ts");
  const { webviews } = await import("../lib/webviews.ts");
  stub.docs.clear();
  const stop = startPersistence();
  const normal = S().createWindow({ url: "https://site.example/a" });
  const incognito = S().createWindow({ incognito: true, url: "https://secret.example/x" });
  const [normalTab] = S().windows[normal].tabIds;
  const [privateTab] = S().windows[incognito].tabIds;
  const privateProfile = S().windows[incognito].profileId;
  const asked = [];
  const handle = (uri) => ({ downloadFavicon: (url, name) => (asked.push({ url, name }), Promise.resolve({ uri, width: 32, height: 32 })) });
  webviews.set(normalTab, handle("file:///tmp/site.png"));
  webviews.set(privateTab, handle("data:image/png;base64,AAAA"));

  noteFavicon(normalTab, "https://site.example/favicon.ico");
  noteFavicon(privateTab, "https://secret.example/favicon.ico");
  await new Promise((r) => setTimeout(r, 0));

  assert.ok(asked.find((a) => a.url.includes("site.example")).name);
  assert.equal(asked.find((a) => a.url.includes("secret.example")).name, undefined);

  assert.equal(resolveFavicon("https://site.example/a")?.uri, "file:///tmp/site.png");
  assert.equal(resolveFavicon("https://site.example/other")?.uri, "file:///tmp/site.png", "falls back to the host");
  assert.equal(resolveFavicon("https://secret.example/x"), null);
  assert.equal(resolveFavicon("https://secret.example/x", null, "default"), null);
  assert.equal(resolveFavicon("https://secret.example/x", null, privateProfile)?.uri, "data:image/png;base64,AAAA");
  assert.equal(resolveFavicon("https://site.example/a", null, privateProfile)?.uri, "file:///tmp/site.png");

  flushFavicons();
  assert.ok(stub.docs.get("favicons-default.json")?.includes("site.example"));
  assert.ok(![...stub.docs.keys()].some((k) => k.includes("incognito")));
  assert.ok(![...stub.docs.values()].some((v) => String(v).includes("secret.example")));

  S().closeWindow(incognito);
  assert.equal(useFavicons.getState().profiles[privateProfile], undefined);
  webviews.clear();
  stop();
});

test("favicons: a page that swaps its icon with the appearance shows the one for the current appearance", async () => {
  const { noteFavicon, resolveFavicon } = await import("../lib/favicons.ts");
  const { webviews } = await import("../lib/webviews.ts");
  stub.docs.clear();
  const stop = startPersistence();
  const w = S().createWindow({ url: "https://github.example/" });
  const [tab] = S().windows[w].tabIds;
  webviews.set(tab, { downloadFavicon: (url) => Promise.resolve({ uri: `file:///tmp/${url.split("/").pop()}.png`, width: 32, height: 32 }) });
  const note = async (src) => (noteFavicon(tab, src), await new Promise((r) => setTimeout(r, 0)));
  const light = "https://assets.example/favicon.svg";
  const dark = "https://assets.example/favicon-dark.svg";

  S().setAppDark(false);
  await note(light);
  S().setAppDark(true);
  await note(light);
  await note(dark);
  assert.equal(resolveFavicon("https://github.example/", dark)?.uri, "file:///tmp/favicon-dark.svg.png");
  S().setAppDark(false);
  assert.equal(resolveFavicon("https://github.example/", dark)?.uri, "file:///tmp/favicon.svg.png");
  assert.equal(resolveFavicon("https://github.example/other")?.uri, "file:///tmp/favicon.svg.png", "the host's too");
  S().setAppDark(true);
  assert.equal(resolveFavicon("https://github.example/", light)?.uri, "file:///tmp/favicon-dark.svg.png");

  const now = Date.now;
  Date.now = () => now() + 60_000;
  try {
    await note("https://assets.example/badge.png");
  } finally {
    Date.now = now;
  }
  assert.equal(resolveFavicon("https://github.example/", "https://assets.example/badge.png")?.uri, "file:///tmp/badge.png.png");
  S().setAppDark(false);
  assert.equal(resolveFavicon("https://github.example/", "https://assets.example/badge.png")?.uri, "file:///tmp/badge.png.png");
  webviews.clear();
  S().closeWindow(w);
  stop();
});
