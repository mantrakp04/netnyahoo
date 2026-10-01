// What changed between two versions of an id-keyed record of the store (`tabs`, `live`): the ids whose entry is new,
// replaced or gone. Several store listeners ask it of the same update, so it's worked out once per pair: a pass over
// 200 tabs costs Hermes ~15 µs (a `for…in` alone costs that), and listeners each made their own on every update.

const NONE: readonly string[] = [];
const memo = new WeakMap<object, { prev: object; ids: readonly string[] }>();

export function changedIds<T>(next: Record<string, T>, prev: Record<string, T>): readonly string[] {
  if (next === prev) return NONE;
  const hit = memo.get(next);
  if (hit?.prev === prev) return hit.ids;
  const ids: string[] = [];
  const keys = Object.keys(next);
  let added = 0;
  for (let i = 0; i < keys.length; i++) {
    const id = keys[i]!;
    const before = prev[id];
    if (next[id] === before) continue;
    ids.push(id);
    if (before === undefined) added++;
  }
  // Fewer kept ids than `prev` had: some are gone.
  const before = Object.keys(prev);
  if (before.length > keys.length - added) for (const id of before) if (next[id] === undefined) ids.push(id);
  memo.set(next, { prev, ids });
  return ids;
}
