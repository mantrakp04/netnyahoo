#!/usr/bin/env node
// Builds the bench bundle (command channel included) of an OLD release from that release's own source tree, for
// native-bench's --control-bundle (docs/perf/README.md "Gating a release"). native-bench's own bundle is built from the
// working tree and only fits the current native API; a release from the CEF era has to run its own JS.
//
//   node legacy-bundle.mjs <tag, e.g. v0.2.17> <out dir>     writes <out dir>/main.jsbundle (and keeps <out dir>/tree)
//
// `git archive <tag>` into <out dir>/tree, the repo's hoisted node_modules cloned in (pnpm: the lockfile's versions are the
// ones that were current for that release), the tree's own packages linked as @arcadia/*, scripts/perf/legacy/ copied
// over as the tree's scripts/perf/bench-entry.js, then metro --dev false and hermesc, as native-bench's buildBundle does.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
const [tag, outArg] = process.argv.slice(2);
if (!tag || !outArg) {
  console.error("usage: legacy-bundle.mjs <tag> <out dir>");
  process.exit(64);
}
const out = resolve(outArg);
const tree = join(out, "tree");
rmSync(tree, { recursive: true, force: true });
mkdirSync(tree, { recursive: true });
execFileSync("sh", ["-c", `git -C '${repo}' archive '${tag}' | tar -x -C '${tree}'`], { stdio: "inherit" });

// A copy, not a symlink: metro only resolves from directories it crawled, and it doesn't crawl through a symlink. `cp -c` clones
// on APFS (instant, no disk), and pnpm's own links inside it are relative.
execFileSync("cp", ["-Rc", join(repo, "node_modules"), join(tree, "node_modules")]);
const scopeDir = join(tree, "apps/browser/node_modules/@arcadia");
mkdirSync(scopeDir, { recursive: true });
for (const pkg of readdirSync(join(tree, "packages"))) symlinkSync(join(tree, "packages", pkg), join(scopeDir, pkg));

const perf = join(tree, "apps/browser/scripts/perf");
mkdirSync(perf, { recursive: true });
cpSync(join(here, "legacy/bench-entry.js"), join(perf, "bench-entry.js"));
cpSync(join(here, "legacy/bench-channel.js"), join(perf, "bench-channel.js"));
cpSync(join(here, "bench-offline.js"), join(perf, "bench-offline.js"));

const app = join(tree, "apps/browser");
const js = join(out, "bench.js"), hbc = join(out, "main.jsbundle");
// The tree's own copy of react-native-macos: the repo's bundle.js rejects platform "macos" from another root.
const rn = join(tree, "node_modules/react-native-macos");
execFileSync(process.execPath, [join(rn, "scripts/bundle.js"), "bundle", "--entry-file", "scripts/perf/bench-entry.js", "--platform", "macos",
  "--dev", "false", "--minify", "false", "--bundle-output", js, "--assets-dest", join(out, "assets"),
  "--config-cmd", `'${process.execPath}' '${join(rn, "cli.js")}' config`], { cwd: app, stdio: "inherit" });
const hermesc = join(repo, "apps/browser/macos/Pods/hermes-engine/destroot/bin/hermesc");
if (!existsSync(hermesc)) throw new Error(`no hermesc at ${hermesc}`);
execFileSync(hermesc, ["-emit-binary", "-O", "-w", "-out", hbc, js], { stdio: "inherit" });
console.log(`wrote ${hbc}`);
