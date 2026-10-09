// A hidden tab's pane follows only its own tab (3963c7f0: popovers, the New Tab page state, splits and the hiding
// toolbar's mode are read while it's shown), and the card mounts panes from memoized lists (861b3b73): what changed while
// a tab was hidden is on screen the moment it's shown, and the mounted panes follow tabs opening, sleeping and closing.
//
//   node apps/browser/scripts/hidden-pane-test.mjs <Arcadia.app> [--bundle <main.jsbundle>] [--out <dir>]
//
// A hidden instance on a small session; while tab B is hidden it gets a new page (URL and title), loading state, zoom,
// an open find bar and a permission prompt; then B is shown and the rendered components (the perf probe's fiber lookup,
// acPerf.findFibers) must show each. One line per check; exits 1 on any failure.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { evaluate, launch, quit } from "./perf/js-bench.mjs";

const { values: flags, positionals } = parseArgs({ allowPositionals: true, options: { bundle: { type: "string" }, out: { type: "string" }, port: { type: "string" } } });
if (!positionals[0]) {
  console.error("usage: node hidden-pane-test.mjs <Arcadia.app> [--bundle <main.jsbundle>] [--out <dir>]");
  process.exit(2);
}
const out = resolve(flags.out ?? join(tmpdir(), "ac-hidden-pane"));
mkdirSync(out, { recursive: true });
let app = resolve(positionals[0]);
if (flags.bundle) {
  const clone = join(out, "app", "Arcadia.app");
  rmSync(dirname(clone), { recursive: true, force: true });
  mkdirSync(dirname(clone), { recursive: true });
  execFileSync("cp", ["-cR", app, clone]);
  cpSync(resolve(flags.bundle), join(clone, "Contents/Resources/main.jsbundle"));
  const identity = spawnSync("codesign", ["-dvv", app], { encoding: "utf8" }).stderr.match(/^Authority=(.+)$/m)?.[1] ?? "-";
  writeFileSync(`${clone}.entitlements.plist`, execFileSync("codesign", ["-d", "--entitlements", "-", "--xml", app], { encoding: "utf8" }));
  execFileSync("codesign", ["--force", "--sign", identity, "--timestamp=none", "--options", "runtime", "--entitlements", `${clone}.entitlements.plist`, clone], { stdio: "inherit" });
  app = clone;
}

const data = join(out, "data");
rmSync(data, { recursive: true, force: true });
mkdirSync(data, { recursive: true });
const page = (name) => `data:text/html,<title>${name}</title><p>${name}-findme</p>`;
const tab = (id, url) => ({ id, url, title: id, favicon: null, pinned: false, muted: false, zoom: 1, customTitle: null, customIcon: null, pinnedUrl: null, navigation: null, openerId: null, createdAt: Date.now(), lastActiveAt: Date.now() });
const ids = ["a", "b", "c", "d"];
writeFileSync(
  join(data, "session.json"),
  JSON.stringify({
    version: 2,
    profiles: { default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 } },
    profileOrder: ["default"],
    orphanedProfileData: [],
    settings: { searchSuggestions: false, warnBeforeClosingLastTab: false, warnBeforeClosingWindow: false },
    windows: [{ id: "w1", profileId: "default", incognito: false, tabIds: ids, activeTabIds: { default: "a" }, sidebarOpen: true, frame: [100, 100, 1200, 800], createdAt: 0 }],
    windowOrder: ["w1"],
    focusedWindowId: "w1",
    tabs: ids.map((id) => ({ ...tab(id, page(`Tab-${id}`)), windowId: "w1", profileId: "default" })),
    groups: [],
    splits: [],
    closedTabs: [],
    closedWindows: [],
  }),
);
writeFileSync(join(data, "onboarding.json"), JSON.stringify({ version: 1, completedAt: 1 }));
writeFileSync(join(data, "perf-probe"), "");

const { pid } = await launch(app, data, Number(flags.port ?? 9795));
const ac = (body, ms) => evaluate(data, pid, body, ms);
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
};
try {
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) ready = await ac("return !!ac.store.getState().windows.w1;", 2000).then((v) => v, () => false);
  if (!ready) throw new Error("the dev harness never answered");
  // Helpers in the app (Hermes evaluates no async functions: promise chains).
  await ac(`
    globalThis.audit = {
      frames: (n) => new Promise((r) => { let k = n || 2; const step = () => (k-- > 0 ? requestAnimationFrame(step) : r()); step(); }),
      props: (name, tabId) => acPerf.findFibers(name, 500).filter((f) => !tabId || f.memoizedProps?.tabId === tabId || f.memoizedProps?.tab?.id === tabId).map((f) => ({ props: f.memoizedProps, rendered: !!f.child })),
      until: (test, ms) => new Promise((r) => { const end = Date.now() + (ms || 15000); const poll = () => (test() ? r(true) : Date.now() > end ? r(false) : setTimeout(poll, 50)); poll(); }),
    };
    return true;`);
  const S = "const S = () => ac.store.getState();";

  // B loads once (shown), then is hidden behind A with its pane mounted.
  const loaded = await ac(`${S}
    S().activate("b");
    return audit.until(() => S().tabs.b.title === "Tab-b" && ac.webviews.has("b"))
      .then(() => { S().activate("a"); return audit.frames(3); })
      .then(() => ({ b: ac.webviews.has("b"), shown: S().windows.w1.activeTabIds.default }));`, 60_000);
  check("tab B's pane stays mounted while hidden", loaded.b && loaded.shown === "a", JSON.stringify(loaded));

  // While B is hidden: a new page (URL and title through its own tab), zoom, loading, find, a permission prompt.
  const hiddenChanges = await ac(`${S}
    const url = ${JSON.stringify(page("HiddenLoad"))};
    S().updateTab("b", { navigation: { url, seq: Date.now() } });
    let ok = false;
    return audit.until(() => S().tabs.b.title === "HiddenLoad").then((loadedIt) => {
      ok = loadedIt;
      S().updateTab("b", { zoom: 1.5 });
      S().setFind("b", { open: true, query: "findme" });
      ac.pageState.setState((p) => ({ pages: { ...p.pages, b: { ...(p.pages.b || {}), permission: { id: "audit", browserId: 0, origin: "https://example.com", permissions: ["notifications"] } } } }));
      S().updateLive("b", { isLoading: true });
      return audit.frames(3);
    }).then(() => ({ ok, url: S().tabs.b.url, title: S().tabs.b.title, renderedB: audit.props("UrlField", "b").length }));`, 60_000);
  check("a hidden tab loads what it's sent to (its own tab's navigation)", hiddenChanges.ok, `${hiddenChanges.url} "${hiddenChanges.title}"`);
  check("nothing of B's toolbar renders while it's hidden", hiddenChanges.renderedB === 0);

  const shown = await ac(`${S}
    S().activate("b");
    return audit.frames(3).then(() => ({
      url: audit.props("UrlField", "b")[0]?.props.tab.url,
      zoom: audit.props("ZoomIndicator", "b")[0]?.props.zoom,
      loading: audit.props("ReloadButton", "b")[0]?.props.loading,
      find: audit.props("FindBar", "b")[0]?.rendered,
      prompt: audit.props("PermissionPrompt", "b")[0]?.rendered,
    }));`);
  check("shown: the URL it loaded while hidden", typeof shown.url === "string" && shown.url.includes("HiddenLoad"), shown.url);
  check("shown: its zoom", shown.zoom === 1.5, String(shown.zoom));
  check("shown: loading", shown.loading === true, String(shown.loading));
  check("shown: the find bar opened while hidden", shown.find === true);
  check("shown: the permission prompt that came while hidden", shown.prompt === true);

  // The mounted panes follow tabs: one opened (with a page) mounts, a closed one goes, a switch keeps the rest.
  const panes = await ac(`${S}
    const want = () => S().windows.w1.tabIds.filter((id) => S().tabs[id]?.navigation || S().tabs[id]?.adoptId).sort().join(",");
    const have = () => [...ac.webviews.keys()].filter((id) => S().tabs[id]?.windowId === "w1").sort().join(",");
    const steps = [];
    let e;
    const settle = (name) => audit.until(() => want() === have(), 8000).then(() => steps.push([name, want(), have()]));
    e = S().newTab("w1", { url: ${JSON.stringify(page("Tab-e"))}, background: true });
    return settle("open")
      .then(() => { S().closeTab("c"); return settle("close"); })
      .then(() => { S().updateTab(e, { title: "Retitled" }); S().activate(e); return settle("switch"); })
      .then(() => steps);`, 60_000);
  for (const [step, want, have] of panes) check(`mounted panes after ${step}`, want === have, `want ${want} have ${have}`);
} finally {
  await quit(pid);
}
process.exit(results.every(Boolean) ? 0 : 1);
