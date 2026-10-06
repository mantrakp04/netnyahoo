// windowStats (frames-phase.mjs) on synthetic probe records: `node --test apps/browser/scripts/perf/frames-phase.test.mjs`
import assert from "node:assert/strict";
import test from "node:test";
import { ratchetCheck, ratchetInit, windowStats } from "./frames-phase.mjs";

const R = 1000 / 120;
const ticks = (times) => times.map((ts) => ({ k: "f", ts, now: ts + 0.4, tgt: ts + R }));
const rec = (times, extra = {}) => ({ f: ticks(times), m: [], j: [], l: [], ...extra });

test("steady 120 Hz frames: nothing over budget", () => {
  const t = Array.from({ length: 61 }, (_, i) => i * R);
  const s = windowStats(rec(t), 0, 60 * R, R);
  assert.equal(s.frames, 60);
  assert.equal(s.over8, 0);
  assert.equal(s.dropped, 0);
  assert.ok(Math.abs(s.worst - R) < 1e-9);
});

test("a 50 ms stall: one tick over 8.33 and 16.7, five refresh intervals skipped", () => {
  const t = [0, R, 2 * R, 2 * R + 50, 2 * R + 50 + R];
  const s = windowStats(rec(t), 0, 1000, R);
  assert.equal(s.frames, 4);
  assert.equal(s.over8, 1);
  assert.equal(s.over16, 1);
  assert.equal(s.dropped, 5);
  assert.equal(s.worst, 50);
});

test("a gap that ends outside the window isn't counted; one that starts before it is", () => {
  const s = windowStats(rec([0, 40, 48, 100]), 41, 60, R);
  assert.equal(s.frames, 1);
  assert.equal(s.worst, 8);
});

test("a 60 Hz screen: every tick is over 8.33 ms and none over 16.7", () => {
  const t = Array.from({ length: 11 }, (_, i) => i * 16.667);
  const s = windowStats(rec(t), 0, 200, 16.667);
  assert.equal(s.over8, 10);
  assert.equal(s.over16, 0);
  assert.equal(s.dropped, 0);
});

test("busy time is clipped to the window; the worst run-loop iteration is the one that started in it", () => {
  const m = [{ k: "r", th: "m", a: -5, d: 10 }, { k: "r", th: "m", a: 20, d: 12 }, { k: "r", th: "m", a: 95, d: 20 }];
  const s = windowStats(rec([0, R], { m, l: [{ a: 30, d: 3 }, { a: 500, d: 9 }] }), 0, 100, R);
  assert.equal(s.mainLoop, 5 + 12 + 5);
  assert.equal(s.mainWorst, 20);
  assert.equal(s.mainOver8, 2);
  assert.equal(s.layoutMs, 3);
});

const runs = (name, reps) => ({ frames: [{ interactions: { [name]: reps } }] });

test("ratchet: exact when every repetition agrees, +10% when they moved; timing-driven interactions are left out", () => {
  const results = {
    frames: [
      { interactions: { "tab switch": [{ layoutPasses: 25, commits: 4 }, { layoutPasses: 25, commits: 5 }], "new window": [{ layoutPasses: 40 }] } },
      { skipped: "display asleep" },
    ],
  };
  const r = ratchetInit(results);
  assert.deepEqual(r.ceilings, { "tab switch": { layoutPasses: 25, commits: 6 } });
});

test("ratchet: the median of the repetitions is judged against the ceiling", () => {
  const ratchet = { ceilings: { "tab switch": { layoutPasses: 25 } } };
  assert.equal(ratchetCheck(runs("tab switch", [{ layoutPasses: 25 }, { layoutPasses: 25 }, { layoutPasses: 90 }]), ratchet)[0].over, false);
  assert.equal(ratchetCheck(runs("tab switch", [{ layoutPasses: 26 }, { layoutPasses: 26 }]), ratchet)[0].over, true);
});

test("thread CPU time: the difference between the last tick before the window and the last tick in it", () => {
  const t = [0, 10, 20, 30, 40].map((ts, i) => ({ k: "f", ts, now: ts, tgt: ts + 10, mc: i * 4, jc: 100 + i * 2 }));
  const s = windowStats({ f: t, m: [], j: [], l: [] }, 15, 35, 10);
  assert.equal(s.mainBusy, 8); // ticks at 10 (mc 4) → 30 (mc 12)
  assert.equal(s.jsBusy, 4);
  assert.ok(Number.isNaN(windowStats(rec([0, 10, 20]), 5, 15, 10).mainBusy)); // no CPU samples (an older probe)
});
