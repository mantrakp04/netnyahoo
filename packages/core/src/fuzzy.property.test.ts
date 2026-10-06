// matchActions and fuzzyScore against their frozen spec (fuzzy.reference.ts): random action lists and typed queries.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fuzzyScore, matchActions, type ActionCandidate } from "./fuzzy.ts";
import * as reference from "./fuzzy.reference.ts";

function rng(seed: number) {
  let s = seed >>> 0;
  const next = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const int = (n: number) => Math.floor(next() * n);
  return { int, pick: <T,>(l: readonly T[]): T => l[int(l.length)]! };
}

const WORDS = ["new", "tab", "window", "incognito", "close", "all", "reload", "page", "Copy", "URL", "Markdown", "zoom", "in", "out", "Developer", "Tools", "dark", "mode", "Settings", "preferences", "clear", "browsing", "data", "history", "keyboard", "shortcuts", "Move", "to", "Top", "Apps", "pin", "unpin", "x", "a1", "9", "café", "naïve", "re-open", "(1)", "C++"];

test("matchActions ranks and matches exactly as the reference does", () => {
  let hits = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const r = rng(seed);
    const phrase = () => Array.from({ length: 1 + r.int(4) }, () => r.pick(WORDS)).join(r.int(6) ? " " : r.pick(["-", "  ", "\t", ", "]));
    const actions: (ActionCandidate & { hint?: string })[] = Array.from({ length: r.int(60) }, (_, i) => ({
      id: `a${i}`,
      title: phrase(),
      ...(r.int(2) ? { keywords: Array.from({ length: 1 + r.int(5) }, phrase) } : {}),
      ...(r.int(3) ? { hint: "⌘T" } : {}),
    }));
    for (let n = 0; n < 40; n++) {
      const source = actions.length && r.int(3) ? r.pick(actions) : null;
      const base = source ? r.pick([source.title, ...(source.keywords ?? [])]) : phrase();
      let query = base.slice(0, 1 + r.int(base.length));
      if (r.int(4) === 0) query = query.toUpperCase();
      if (r.int(5) === 0) query = ` ${query}  `;
      if (r.int(8) === 0) query = query.replace(/ /g, "   ");
      const limit = r.pick([3, 3, 1, 5, 100]);
      const want = reference.matchActions(query, actions, limit);
      assert.deepStrictEqual(matchActions(query, actions, limit), want, `seed ${seed} query ${JSON.stringify(query)}`);
      // The same list again (the prepared names are reused) and a fresh copy of it.
      assert.deepStrictEqual(matchActions(query, actions, limit), want);
      assert.deepStrictEqual(matchActions(query, [...actions], limit), want);
      hits += want.length;
      if (source) assert.equal(fuzzyScore(query, source.title), reference.fuzzyScore(query, source.title));
    }
  }
  assert.ok(hits > 1000, `only ${hits} matches were compared`);
});

test("an actions list edited in place is read again", () => {
  const actions: ActionCandidate[] = [{ id: "reload", title: "Reload" }];
  const same = (query: string) => assert.deepStrictEqual(matchActions(query, actions), reference.matchActions(query, actions), query);
  same("reload");
  actions[0]!.title = "New Tab";
  same("new tab");
  actions.push({ id: "close", title: "Close Tab", keywords: ["shut"] });
  same("close tab");
  actions[1]!.keywords = ["quit"];
  same("quit");
  actions.length = 1;
  same("close tab");
});
