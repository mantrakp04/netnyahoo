#!/usr/bin/env node
// Omnibox ranking (packages/core) on the benchmark's big profile: 5000 history entries, 200 tabs,
// 1000 bookmarks. Node's JIT runs this far faster than Hermes in the app; use it to compare
// changes to core, and js-bench.mjs `typing` for what a keystroke costs in the app.
//
//   node core-bench.mjs [query]

import { buildSuggestions, prepareSuggestions } from "../../../../packages/core/src/index.ts";
import { buildSeed } from "./seed.mjs";

const query = process.argv[2] ?? "github.com/facebook/react/pull";
const seed = buildSeed("http://127.0.0.1:47817");
const history = seed["history.json"].history.default;
const tabs = seed["session.json"].tabs.filter((t) => t.profileId === "default");
const bookmarks = Object.values(seed["bookmarks.json"].bookmarks.nodes)
  .filter((n) => n.kind === "url")
  .map((n) => ({ url: n.url, title: n.title, favicon: n.favicon }));

const now = () => performance.now();
const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

let t = now();
const source = { tabs, history, bookmarks };
prepareSuggestions(source, Infinity);
const prepareMs = now() - t;

const rounds = [];
for (let r = 0; r < 20; r++) {
  const keys = [];
  for (let i = 1; i <= query.length; i++) {
    t = now();
    buildSuggestions(query.slice(0, i), source, { now: Date.now() });
    keys.push(now() - t);
  }
  rounds.push(keys);
}
const perKey = rounds.slice(5).flat();
console.log(`prepare (cold) ${prepareMs.toFixed(1)} ms`);
console.log(`keystroke median ${median(perKey).toFixed(3)} ms, max ${Math.max(...perKey).toFixed(3)} ms (${query.length} keys × 15 warm rounds)`);
console.log(`first round ${rounds[0].reduce((a, b) => a + b, 0).toFixed(1)} ms total`);
