// Runs one capture scene in the film's hidden DEV instance and saves its raw frames.
// usage: node scripts/capture/cap.mjs <instance data dir> <scene> → .capture/<scene>/{0000.png…, pages/*.jpg, manifest.json}
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { attach } from "../../../../scripts/lib/instance.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const [dataDir, scene] = process.argv.slice(2);
const out = resolve(here, "../../.capture", scene);
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "pages"), { recursive: true });
const body = readFileSync(join(here, "prelude.js"), "utf8").replaceAll("__OUT__", out) + "\n" + readFileSync(join(here, "scenes", `${scene}.js`), "utf8");
const app = attach(dataDir);
const t0 = Date.now();
const result = JSON.parse(await app.eval(body, { timeout: 600000 }));
for (const [key, p] of Object.entries(result.pages)) {
  const file = `pages/${key.replace(/[^\w-]+/g, "_")}.jpg`;
  writeFileSync(join(out, file), Buffer.from(p.data, "base64"));
  result.pages[key] = { file, frame: p.frame };
}
writeFileSync(join(out, "manifest.json"), JSON.stringify(result, null, 1));
console.log(`${scene}: ${result.frames.length} frames, ${Object.keys(result.pages).length} pages, ${((Date.now() - t0) / 1000).toFixed(1)} s → ${out}`);
