// Swipe gesture motion (Dia's numbers). Run from apps/browser:
//   node --import ./src/store/test-loader.mjs --test src/components/layout/swipeMotion.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
const m = await import("./swipeMotion.ts");

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test("rubber band: linear up to the limit, then approaches limit + dimension", () => {
  assert.equal(m.rubberBand(50, 86, 86), 50);
  assert.equal(m.rubberBand(86, 86, 86), 86);
  const a = m.rubberBand(100, 86, 86);
  const b = m.rubberBand(200, 86, 86);
  assert.ok(a > 86 && b > a && b < 86 + 86);
  // Apple's formula: (1 − 1/(x·c/d + 1))·d past the limit.
  close(m.rubberBand(186, 86, 86), 86 + (1 - 1 / ((100 * 0.15) / 86 + 1)) * 86);
});

test("capsule: hidden at rest, 14 pt in at the threshold, whatever its size", () => {
  close(m.capsuleOffset(0, m.CAPSULE_SIZE), -m.CAPSULE_SIZE);
  close(m.capsuleOffset(1, m.CAPSULE_SIZE), m.CAPSULE_INSET);
  close(m.capsuleOffset(1, m.CAPSULE_SIZE_CONFIRMED), m.CAPSULE_INSET);
  close(m.capsuleOffset(1, 200), m.CAPSULE_INSET);
  // Past the threshold it keeps moving, ever slower.
  const d1 = m.capsuleOffset(1.5, 82) - m.capsuleOffset(1, 82);
  const d2 = m.capsuleOffset(2, 82) - m.capsuleOffset(1.5, 82);
  assert.ok(d1 > 0 && d2 > 0 && d2 < d1);
});

test("progress: 75 pt of scroll per unit, never negative", () => {
  assert.equal(m.swipeProgress(75), 1);
  assert.equal(m.swipeProgress(37.5), 0.5);
  assert.equal(m.swipeProgress(-20), 0);
});

test("springs from response and damping ratio", () => {
  const s = m.springParams(0.18, 0.7);
  close(s.stiffness, 1218.46, 0.01);
  close(s.damping, 48.87, 0.01);
  assert.equal(s.mass, 1);
});

test("destination list: a row per 75 pt, rubber band past the ends", () => {
  assert.deepEqual(m.listSelection(0, 4), { index: 0, nudge: 0 });
  assert.equal(m.listSelection(80, 4).index, 1);
  assert.equal(m.listSelection(75 * 2.6, 4).index, 3);
  const past = m.listSelection(75 * 5, 4);
  assert.equal(past.index, 3);
  assert.ok(past.nudge > 0 && past.nudge < m.LIST_ROW / 2);
  const before = m.listSelection(-60, 4);
  assert.equal(before.index, 0);
  assert.ok(before.nudge < 0);
});

test("profile paging: half speed, rubber band at the ends, commits past halfway", () => {
  assert.equal(m.pagingOffset(100, "back", true, 250), 50);
  assert.equal(m.pagingOffset(100, "forward", true, 250), -50);
  const end = m.pagingOffset(100, "back", false, 250);
  assert.ok(end > 0 && end < 50);
  assert.equal(m.pagingCommits(130, 0, true, 250), true);
  assert.equal(m.pagingCommits(100, 0, true, 250), false);
  // A flick carries it over.
  assert.equal(m.pagingCommits(100, 400, true, 250), true);
  assert.equal(m.pagingCommits(200, 0, false, 250), false);
});
