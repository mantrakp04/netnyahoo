// ⌘-scroll zooms with a wheel mouse or a Magic Mouse and scrolls with a trackpad.
// CDP's Input.dispatchMouseEvent reaches the renderer directly, past the app's event monitor that
// makes this decision, so the scrolls go through AppKit's dispatch instead (NNZoom devScroll),
// each claiming the device it comes from.
// usage: node zoom-scroll-test.mjs <Debug Netnyahoo.app> [cdpPort]
// One line per check; the details go to zoom-scroll-test.log beside the instance's data.
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch, reporter, session, sleep } from "../../../scripts/lib/instance.mjs";

const [appArg, port] = process.argv.slice(2);
if (!appArg) {
  console.error("usage: node zoom-scroll-test.mjs <Debug Netnyahoo.app> [cdpPort]");
  process.exit(2);
}
const scratch = mkdtempSync(join(tmpdir(), "nn-zoom-scroll-"));
const data = join(scratch, "data");
const rep = reporter(join(scratch, "zoom-scroll-test.log"), { name: "zoom-scroll-test" });

const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><title>tall</title><body style="font:20px system-ui;height:6000px"><h1>tall</h1>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;

let app;
try {
  app = await launch(resolve(appArg), {
    data, port,
    session: session({ tabs: [{ id: "t1", url, title: "tall" }] }),
    ready: "return !!globalThis.expo.modules.NetnyahooCEF.devScrollZoom",
  });
  const nn = (body) => app.eval(body, { timeout: 60000 });
  for (let i = 0; i < 60 && !(await nn(`return nn.store.getState().tabs.t1?.title === "tall";`)); i++) await sleep(500);
  await sleep(1500);

  const zoom = () => nn(`return nn.store.getState().tabs.t1.zoom;`);
  const reset = async () => {
    await nn(`return nn.webviews.get("t1")?.zoomStep(0);`);
    for (let i = 0; i < 20 && (await zoom()) !== 1; i++) await sleep(200);
  };
  const scroll = (steps) => nn(`return globalThis.expo.modules.NetnyahooCEF.devScrollZoom(${JSON.stringify(steps)});`);
  const gesture = (trackpad) => [
    { phase: "mayBegin", dy: 0, trackpad },
    { phase: "began", dy: 12, trackpad },
    ...Array.from({ length: 4 }, () => ({ phase: "changed", dy: 40, trackpad })),
    { phase: "ended", dy: 0, trackpad },
    ...Array.from({ length: 3 }, () => ({ phase: "momentum", dy: 30 })),
  ];

  const scrollCase = (name, steps, expectZoom) => rep.check(name, async () => {
    await reset();
    const zoomed = await scroll(steps);
    await sleep(800);
    const after = await zoom();
    const scrolled = zoomed.every((z) => !z);
    const detail = `zoomed per event ${JSON.stringify(zoomed)}, zoom ${after}`;
    if (!(expectZoom ? zoomed.some(Boolean) && after > 1 : scrolled && after === 1)) throw new Error(detail);
    return detail;
  });

  await scrollCase("⌘ + two-finger trackpad scroll scrolls (and its momentum too)", gesture(true), false);
  await scrollCase("⌘ + Magic Mouse scroll zooms", gesture(false), true);
  await scrollCase("⌘ + wheel-mouse notches zoom", [{ phase: "wheel", dy: 1 }, { phase: "wheel", dy: 1 }], true);
  await scrollCase("a trackpad scroll that ended doesn't stop the wheel from zooming",
    [...gesture(true), { phase: "wheel", dy: 1 }, { phase: "wheel", dy: 1 }], true);
  await reset();
} catch (error) {
  rep.record("setup", { error });
} finally {
  await app?.quit();
  server.close();
  rmSync(data, { recursive: true, force: true });
}
process.exit(rep.summary() ? 0 : 1);
