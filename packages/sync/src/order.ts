/**
 * Order in synced lists (bookmark folders, pinned tabs) as fractional positions: strings
 * that sort in list order, so a move or insert changes one item's position and two Macs
 * reordering different items merge. Positions use base-62 digits in ASCII order and never end
 * in "0", so there's always room between two of them (David Greenspan's scheme).
 */
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;
const digit = (c: string | undefined) => (c === undefined ? 0 : DIGITS.indexOf(c));

/** A position strictly between `a` and `b` ("" = the start, null = the end). */
export function positionBetween(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`positionBetween: ${a} >= ${b}`);
  if (b !== null) {
    // Shared prefix (a padded with zeros): keep it and look past it.
    let n = 0;
    while ((a[n] ?? "0") === b[n]) n++;
    if (n > 0) return b.slice(0, n) + positionBetween(a.slice(n), b.slice(n));
  }
  const da = digit(a[0]);
  const db = b !== null ? digit(b[0]) : BASE;
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)]!;
  // Adjacent first digits: b's first digit alone sorts between them when b goes on.
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[da]! + positionBetween(a.slice(1), null);
}

/**
 * Positions for `items` in this order, keeping every position it can: the longest run of
 * existing positions that's already increasing stays, and the rest get new positions between
 * their neighbours. So a move changes only the moved item.
 */
export function assignPositions(existing: (string | undefined)[]): string[] {
  // Longest strictly increasing subsequence of the known positions (patience sorting).
  const tails: number[] = [];
  const previous = new Array<number>(existing.length).fill(-1);
  existing.forEach((p, i) => {
    if (p === undefined || !p || p.endsWith("0")) return;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (existing[tails[mid]!]! < p) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) previous[i] = tails[lo - 1]!;
    tails[lo] = i;
  });
  const keep = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1]! : -1; i >= 0; i = previous[i]!) keep.add(i);

  const out = new Array<string>(existing.length);
  for (const i of keep) out[i] = existing[i]!;
  let before = "";
  for (let i = 0; i < existing.length; i++) {
    if (keep.has(i)) {
      before = out[i]!;
      continue;
    }
    let next: string | null = null;
    for (let j = i + 1; j < existing.length; j++) {
      if (keep.has(j)) {
        next = out[j]!;
        break;
      }
    }
    out[i] = positionBetween(before, next);
    before = out[i]!;
  }
  return out;
}
