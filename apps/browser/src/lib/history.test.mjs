// How Chrome's history changes land in the app's view (lib/history.ts applyHistoryChange): the straightforward
// version below is the specification; the real one is the same function written to copy a 5000-entry list once.
import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;

const { applyHistoryChange } = await import("./history.ts");
const { MAX_HISTORY, MAX_VISIT_TIMES } = await import("../store/history.ts");

const shown = (url) => /^(https?|file):/i.test(url);

function reference(list, change) {
  switch (change.kind) {
    case "visit": {
      if (!shown(change.url)) return list;
      const old = list.find((h) => h.url === change.url);
      if (old?.visitTimes?.includes(change.at)) return list;
      const times = [...(old?.visitTimes ?? []), change.at].sort((a, b) => a - b).slice(-MAX_VISIT_TIMES);
      const entry = {
        url: change.url,
        title: change.title || old?.title || "",
        favicon: null,
        visits: Math.max(change.visits, 1),
        lastVisit: times[times.length - 1],
        visitTimes: times,
      };
      const rest = list.filter((h) => h !== old);
      const at = rest.findIndex((h) => h.lastVisit <= entry.lastVisit);
      return (at < 0 ? [...rest, entry] : [...rest.slice(0, at), entry, ...rest.slice(at)]).slice(0, MAX_HISTORY);
    }
    case "modified": {
      const rows = new Map(change.rows.map((r) => [r.url, r]));
      let changed = false;
      const next = list.map((h) => {
        const row = rows.get(h.url);
        if (!row || ((row.title === h.title || !row.title) && row.visits === h.visits)) return h;
        changed = true;
        return { ...h, title: row.title || h.title, visits: row.visits };
      });
      return changed ? next : list;
    }
    case "deleted": {
      const gone = new Set(change.urls);
      const next = list.filter((h) => !gone.has(h.url));
      return next.length === list.length ? list : next;
    }
  }
}

const entry = (i, visitTimes = [1_000_000 - i * 1000]) => ({
  url: `https://example.com/p/${i}`,
  title: `Page ${i}`,
  favicon: null,
  visits: visitTimes.length,
  lastVisit: visitTimes[visitTimes.length - 1],
  visitTimes,
});
const view = (n) => Array.from({ length: n }, (_, i) => entry(i));

// Small deterministic random numbers.
function random(seed) {
  let x = seed;
  return () => (x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

test("a new URL's visit goes first when it is the newest, and the list stays as long as before plus one", () => {
  const list = view(10);
  const next = applyHistoryChange(list, { kind: "visit", profile: "", url: "https://new.test/", title: "New", visits: 1, at: 2_000_000 });
  assert.equal(next.length, 11);
  assert.equal(next[0].url, "https://new.test/");
  assert.equal(next[0].title, "New");
  assert.deepEqual(next.slice(1), list);
  assert.equal(list.length, 10, "the old list isn't changed");
});

test("a revisit moves its entry to the front, keeping its title when the visit has none", () => {
  const list = view(10);
  const next = applyHistoryChange(list, { kind: "visit", profile: "", url: list[6].url, title: "", visits: 2, at: 2_000_000 });
  assert.equal(next.length, 10);
  assert.equal(next[0].url, list[6].url);
  assert.equal(next[0].title, list[6].title);
  assert.deepEqual(next[0].visitTimes, [...list[6].visitTimes, 2_000_000]);
  assert.deepEqual(next.slice(1).map((h) => h.url), list.filter((_, i) => i !== 6).map((h) => h.url));
});

test("a visit already recorded, or to a page the history doesn't show, changes nothing", () => {
  const list = view(5);
  assert.equal(applyHistoryChange(list, { kind: "visit", profile: "", url: list[2].url, title: "x", visits: 1, at: list[2].visitTimes[0] }), list);
  assert.equal(applyHistoryChange(list, { kind: "visit", profile: "", url: "chrome-extension://abc/page.html", title: "x", visits: 1, at: 5 }), list);
});

test("a title change returns the same list when nothing differs, else a copy with just that entry replaced", () => {
  const list = view(8);
  assert.equal(applyHistoryChange(list, { kind: "modified", profile: "", rows: [{ url: list[3].url, title: list[3].title, visits: list[3].visits }] }), list);
  assert.equal(applyHistoryChange(list, { kind: "modified", profile: "", rows: [{ url: "https://absent.test/", title: "x", visits: 3 }] }), list);
  const next = applyHistoryChange(list, { kind: "modified", profile: "", rows: [{ url: list[3].url, title: "Renamed", visits: 4 }] });
  assert.notEqual(next, list);
  assert.equal(next[3].title, "Renamed");
  assert.equal(next[3].visits, 4);
  next.forEach((h, i) => i !== 3 && assert.equal(h, list[i], "the other entries are the same objects"));
  const keeps = applyHistoryChange(list, { kind: "modified", profile: "", rows: [{ url: list[1].url, title: "", visits: 9 }] });
  assert.equal(keeps[1].title, list[1].title, "an empty title keeps the old one");
});

test("the real functions match the straightforward ones on random changes", () => {
  const rand = random(7);
  let real = view(40);
  let spec = real;
  let clock = 2_000_000;
  for (let step = 0; step < 600; step++) {
    const pick = rand();
    const known = real.length ? real[Math.floor(rand() * real.length)] : null;
    let change;
    if (pick < 0.45) {
      // a visit: to a known page or a new one, now or (sometimes) at an old time
      const url = known && rand() < 0.5 ? known.url : `https://new.test/${Math.floor(rand() * 60)}`;
      const at = rand() < 0.8 ? (clock += 1 + Math.floor(rand() * 500)) : Math.floor(rand() * clock);
      change = { kind: "visit", profile: "", url: rand() < 0.05 ? "chrome://settings" : url, title: rand() < 0.5 ? `T${step}` : "", visits: 1 + Math.floor(rand() * 5), at };
    } else if (pick < 0.85) {
      const rows = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => {
        const target = real.length && rand() < 0.8 ? real[Math.floor(rand() * real.length)] : null;
        return { url: target?.url ?? "https://absent.test/", title: rand() < 0.3 ? "" : `R${step}`, visits: rand() < 0.5 ? (target?.visits ?? 1) : 1 + Math.floor(rand() * 9) };
      });
      // the same page twice in one change: the later row wins
      if (rows.length > 1 && rand() < 0.3) rows[1] = { ...rows[1], url: rows[0].url };
      change = { kind: "modified", profile: "", rows };
    } else {
      change = { kind: "deleted", profile: "", all: false, urls: known && rand() < 0.8 ? [known.url] : ["https://absent.test/"] };
    }
    real = applyHistoryChange(real, change);
    spec = reference(spec, change);
    assert.deepEqual(real, spec, `step ${step}: ${JSON.stringify(change)}`);
  }
});

test("the view holds at most MAX_HISTORY URLs, dropping the oldest", () => {
  const list = view(MAX_HISTORY);
  const next = applyHistoryChange(list, { kind: "visit", profile: "", url: "https://new.test/", title: "New", visits: 1, at: 9_000_000 });
  assert.equal(next.length, MAX_HISTORY);
  assert.equal(next[0].url, "https://new.test/");
  assert.equal(next.at(-1).url, list[MAX_HISTORY - 2].url);
  assert.deepEqual(next, reference(list, { kind: "visit", profile: "", url: "https://new.test/", title: "New", visits: 1, at: 9_000_000 }));
});

test("an old visit lands in order among the entries by last visit", () => {
  const list = view(20);
  const change = { kind: "visit", profile: "", url: "https://old.test/", title: "Old", visits: 1, at: list[9].lastVisit - 500 };
  const next = applyHistoryChange(list, change);
  assert.deepEqual(next, reference(list, change));
  assert.equal(next[10].url, "https://old.test/");
});
