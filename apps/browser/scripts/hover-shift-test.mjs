// Hovering moves or resizes nothing but a HoverSlot's contents, in the sidebar, the tab strip and the downloads popover.
// Launches a hidden instance with a fixture (tabs, an open and a collapsed group, a live folder with an open item, a
// finished download) and runs the dev harness's check (src/lib/hoverShift.ts) on each surface.
//   node apps/browser/scripts/hover-shift-test.mjs <Debug Netnyahoo.app> [cdpPort]
// One line per surface; the details go to hover-shift-test.log beside the instance's data.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch, reporter, session, sleep } from "../../../scripts/lib/instance.mjs";

const [appArg, port] = process.argv.slice(2);
if (!appArg) {
  console.error("usage: node hover-shift-test.mjs <Debug Netnyahoo.app> [cdpPort]");
  process.exit(2);
}
const scratch = mkdtempSync(join(tmpdir(), "nn-hover-shift-"));
const data = join(scratch, "data");
mkdirSync(data);
const rep = reporter(join(scratch, "hover-shift-test.log"), { name: "hover-shift-test" });
const file = join(data, "report.pdf");
writeFileSync(file, "%PDF-1.4\n");

const ids = ["pin1", "pin2", "a1", "a2", "a3", "b1", "b2", ...Array.from({ length: 12 }, (_, i) => `t${i}`)];
const tab = (id) => {
  const pinned = id.startsWith("pin");
  return { id, url: `https://example.com/?${id}`, title: `Tab ${id} with a title long enough to fade`, pinned,
    pinnedUrl: pinned ? `https://example.com/?${id}` : null };
};

let app;
try {
  app = await launch(resolve(appArg), {
    data, port,
    session: session({ profiles: ["Personal", "Work"], windows: [{ id: "w1", tabIds: ids, activeTabIds: { default: "t2" } }], tabs: ids.map(tab) }),
    ready: "return !!nn.hoverShift",
  });
  const nn = (body) => app.eval(body, { timeout: 120000 });

  // The fixture: groups, a live folder with an open item (its row shows ✕ on hover) and a finished download.
  await nn(`
    const s = nn.store.getState();
    s.createGroup(["a1", "a2", "a3"], { name: "Open group" });
    const shut = s.createGroup(["b1", "b2"], { name: "Shut group", color: "blue" });
    s.updateGroup(shut, { collapsed: true });
    const { store, engine } = nn.live;
    const folder = store.createFolder("default", "pullRequests");
    const pr = (n, extra) => ({ number: n, repo: "netnyahoo/app", author: "a", authorAvatar: null, draft: false, headRef: "h" + n, baseRef: "main",
      review: null, mergeable: "mergeable", checks: [], comments: 0, unresolvedThreads: 0, additions: 1, deletions: 1, changedFiles: 1, ...extra });
    const item = (n, extra) => ({ id: "pr" + n, source: "github", url: "https://example.com/pr/" + n, title: "Pull request " + n + " with a long title",
      subtitle: "", icon: null, updatedAt: Date.now() - n, section: "authored", pr: pr(n, extra) });
    const items = [item(1, { review: "approved" }), item(2, {}), item(3, { mergeable: "conflicting" })];
    store.applyFetch(folder, items, {});
    store.setStatus(folder, { state: "idle", lastFetch: Date.now(), error: null });
    engine.openLiveItem("w1", folder, items[1], { background: true });
    engine.openLiveItem("w1", folder, items[2], { background: true });
    nn.store.setState((st) => ({ downloads: [{ id: "d1", url: "https://example.com/report.pdf", filename: "report.pdf", path: ${JSON.stringify(file)},
      state: "finished", paused: false, received: 9, total: 9, speed: 0, mimeType: "application/pdf" }, ...st.downloads] }));
    return true;
  `);
  await sleep(1500);

  const surfaces = [
    ["sidebar", `nn.store.getState().updateSettings({ tabLayout: "sidebar" });`, ["Sidebar"]],
    ["tab strip", `nn.store.getState().updateSettings({ tabLayout: "top" });`, ["TopTabStrip"]],
    ["downloads", `nn.store.getState().updateSettings({ tabLayout: "sidebar" }); nn.store.getState().setDownloadsOpen("w1", true);`, ["DownloadsPopover"]],
  ];
  for (const [name, setup, scopes] of surfaces) {
    await rep.check(name, async () => {
      await nn(`${setup} return true;`);
      await sleep(1200);
      const { hovered, shifts } = await nn(`return nn.hoverShift.check({ scopes: ${JSON.stringify(scopes)} });`);
      if (!hovered) throw new Error("nothing hover-tracked found");
      if (shifts.length) {
        throw new Error([`${shifts.length} views moved or resized (${hovered} hovered)`,
          ...shifts.slice(0, 20).flatMap((s) => [`hovering ${s.hovered}`, `  ${s.view}: ${s.before.join(", ")} -> ${s.after.join(", ")}`])].join("\n"));
      }
      return `${hovered} hovered views, nothing moved`;
    });
  }
} catch (error) {
  rep.record("setup", { error });
} finally {
  await app?.quit();
  rmSync(data, { recursive: true, force: true });
}
process.exit(rep.summary() ? 0 : 1);
