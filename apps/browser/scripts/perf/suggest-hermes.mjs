#!/usr/bin/env node
// Typing "github.com/net" and "react native perf" on the seed profile (5000 history, 1000 bookmarks, all 200 tabs) in
// Hermes, the engine the app runs, instead of V8: the omnibox core is transpiled to one script and run by the `hermes`
// CLI from the app's Pods. Per-key time is the mean of many rounds (Date.now has 1 ms steps). Not a gate: wall-clock, so
// run it under `scripts/agent/locked perflab -- …`.
//
//   node scripts/perf/suggest-hermes.mjs [--impl <suggest.ts|suggest.reference.ts>] [--rounds 300] [--keys]
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../..");
const core = join(root, "packages/core/src");
const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const impl = flag("impl", "suggest.ts");
const rounds = Number(flag("rounds", 300));
const perKey = args.includes("--keys");
const hermes = ["apps/browser/macos/Pods/hermes-engine-Release/destroot/bin/hermes", "apps/browser/macos/Pods/hermes-engine/destroot/bin/hermes", "node_modules/react-native/sdks/hermesc/osx-bin/hermes"].map((p) => join(root, p)).find((p) => spawnSync(p, ["-version"]).status === 0);
if (!hermes) throw new Error("no hermes binary found");
// The app's own transform (babel-preset-expo, Hermes profile: classes down to helpers, the rest kept), so Hermes runs what Metro
// would give it. Modules are keyed by absolute path; `require` in the script resolves relative to the requiring module.
const babel = createRequire(join(root, "apps/browser/package.json"))("@babel/core");
const presetExpo = createRequire(join(root, "apps/browser/package.json")).resolve("babel-preset-expo");
const resolveFrom = (from, name) => (name.startsWith(".") ? resolve(dirname(from), name) : createRequire(from).resolve(name));
const modules = {};
const load = (file) => {
  if (modules[file]) return;
  let code = readFileSync(file, "utf8");
  if (/\.(ts|mjs)$/.test(file)) {
    if (file.endsWith("seed.mjs")) code = code.replace(/import[^\n]+node:[^\n]+\n/g, "").replace(/export function writeSeed[\s\S]*$/, "");
    code = babel.transformSync(code, {
      filename: file.replace(/\.mjs$/, ".js"), babelrc: false, configFile: false, presets: [presetExpo],
      caller: { name: "metro", bundler: "metro", platform: "ios", engine: "hermes", isDev: false, supportsStaticESM: false },
    }).code;
  }
  modules[file] = { code, deps: {} };
  for (const m of code.matchAll(/require\("([^"]+)"\)/g)) {
    const dep = resolveFrom(file, m[1]);
    modules[file].deps[m[1]] = dep;
    load(dep);
  }
};
const out = process.env.SUGGEST_HERMES_DIR ?? join(root, "output/suggest-hermes");
mkdirSync(out, { recursive: true });
const implFile = join(core, impl);
load(implFile);
const seedFile = join(here, "seed.mjs");
load(seedFile);
const knownHostsFile = join(here, "../../src/components/omnibox/knownHosts.ts");
load(knownHostsFile);
const coreFile = join(core, "index.ts");
load(coreFile);
const actionsJson = readFileSync(join(here, "bar-actions.json"), "utf8");

const driver = `
var seed = __require(${JSON.stringify(seedFile)}).buildSeed("http://127.0.0.1:47817");
var impl = __require(${JSON.stringify(implFile)});
var history = seed["history.json"].history.default;
var tabs = seed["session.json"].tabs;
var bookmarks = [];
var nodes = seed["bookmarks.json"].bookmarks.nodes;
Object.keys(nodes).forEach(function (k) { var n = nodes[k]; if (n.kind === "url") bookmarks.push({ url: n.url, title: n.title, favicon: n.favicon }); });
var source = { tabs: tabs, history: history, bookmarks: bookmarks };
// One key of the command bar: the known-hosts check, the window's actions, the suggestions (see keystroke in micro-bench.mjs).
var BEFORE = ${/reference/.test(impl)};
var coreIndex = __require(${JSON.stringify(coreFile)});
var knownHosts = __require(${JSON.stringify(knownHostsFile)}).knownHosts;
var BAR_ACTIONS = ${actionsJson};
var state = { tabs: {}, history: { default: history } };
tabs.forEach(function (t) { state.tabs[t.id] = t; });
var pastHosts = null;
function hostsFor() {
  if (!BEFORE) return knownHosts(state, "default");
  var hosts = [];
  Object.keys(state.tabs).forEach(function (k) { var t = state.tabs[k]; if (t.profileId === "default" && t.url) hosts.push(coreIndex.hostOf(t.url)); });
  if (!pastHosts) { var seen = new Set(); history.forEach(function (h) { seen.add(coreIndex.hostOf(h.url)); }); seen.delete(""); pastHosts = Array.from(seen); }
  return hosts.concat(pastHosts);
}
function keystroke(q) {
  coreIndex.findScope(q, { engines: coreIndex.BUILT_IN_ENGINES, hosts: hostsFor() });
  var actions = BEFORE ? BAR_ACTIONS.map(function (a) { return Object.assign({}, a); }) : BAR_ACTIONS;
  return impl.buildSuggestions(q, source, { now: at, actions: actions });
}
var at = Date.now();
var t0 = Date.now();
impl.prepareSuggestions(source, Infinity);
print("prepare (cold): " + (Date.now() - t0) + " ms");
hostsFor();
var seqs = { url: "github.com/net", phrase: "react native perf" };
var ROUNDS = ${rounds};
Object.keys(seqs).forEach(function (name) {
  var q = seqs[name];
  for (var w = 0; w < 5; w++) for (var i = 1; i <= q.length; i++) keystroke(q.slice(0, i));
  var per = [];
  for (var i = 1; i <= q.length; i++) per.push(0);
  var total = 0;
  for (var r = 0; r < ROUNDS; r++) {
    for (var i = 1; i <= q.length; i++) {
      var t = Date.now();
      keystroke(q.slice(0, i));
      per[i - 1] += Date.now() - t;
    }
  }
  var sum = per.reduce(function (a, b) { return a + b; }, 0);
  print(name + " (" + q + "): " + (sum / ROUNDS).toFixed(2) + " ms per sequence, " + (sum / ROUNDS / q.length).toFixed(3) + " ms per key");
  ${perKey ? 'print("  " + per.map(function (p, i) { return JSON.stringify(q.slice(0, i + 1)) + " " + (p / ROUNDS).toFixed(2); }).join("\\n  "));' : ""}
});
`;
const body = Object.entries(modules).map(([n, m]) => `__defs[${JSON.stringify(n)}] = [function (module, exports, require) {\n${m.code}\n}, ${JSON.stringify(m.deps)}];`).join("\n");
const script = `var __defs = {}, __cache = {};
function __require(file) {
  if (__cache[file]) return __cache[file].exports;
  var module = (__cache[file] = { exports: {} });
  var def = __defs[file];
  def[0](module, module.exports, function (name) { return __require(def[1][name]); });
  return module.exports;
}
${body}
${driver}`;
const file = join(out, `bench-${impl.replace(/\.ts$/, "")}.js`);
writeFileSync(file, script);
const r = spawnSync(hermes, [file], { encoding: "utf8" });
process.stdout.write(r.stdout);
if (r.status !== 0) {
  process.stderr.write(r.stderr);
  process.exit(1);
}
