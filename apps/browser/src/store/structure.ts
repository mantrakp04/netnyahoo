import type { SplitView, TabGroup } from "./types";

// Which group and which splits hold each tab, built once per groups/splits map (the store replaces those maps
// when they change, never edits them), so per-tab lookups in selectors don't scan every group and split.
const groupIndexes = new WeakMap<Record<string, TabGroup>, Map<string, TabGroup>>();
const splitIndexes = new WeakMap<Record<string, SplitView>, Map<string, SplitView[]>>();

// The first group (in the map's order) holding each tab, as Object.values(groups).find would give.
export function groupIndex(groups: Record<string, TabGroup>): Map<string, TabGroup> {
  let index = groupIndexes.get(groups);
  if (!index) {
    index = new Map();
    for (const g of Object.values(groups)) for (const id of g.tabIds) if (!index.has(id)) index.set(id, g);
    groupIndexes.set(groups, index);
  }
  return index;
}

// Every split holding each tab, in the map's order.
export function splitIndex(splits: Record<string, SplitView>): Map<string, SplitView[]> {
  let index = splitIndexes.get(splits);
  if (!index) {
    index = new Map();
    for (const v of Object.values(splits)) {
      for (const id of v.tabIds) {
        const list = index.get(id);
        if (!list) index.set(id, [v]);
        else if (!list.includes(v)) list.push(v);
      }
    }
    splitIndexes.set(splits, index);
  }
  return index;
}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

// A list recomputed from store state that keeps its previous identity while its contents don't change, so
// subscribers compare it by reference.
export function stableList(previous: string[] | undefined, next: string[]): string[] {
  return previous && same(previous, next) ? previous : next;
}
