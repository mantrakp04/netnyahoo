import { defineConfig } from "astro/config";
import { createHash } from "node:crypto";
import { copyFileSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { constants, gzipSync } from "node:zlib";

// Big Yahu's model stays at public/models/big-yahu.glb (pages from before a deploy ask for that path). A build
// also writes it as big-yahu.<content hash>.glb, the name the page asks for (scripts/stage.ts) and the only one
// nginx caches for good (infra/site/nginx.conf). `astro dev` serves public/ as it is, so there the page asks for
// the plain name.
const modelSource = new URL("./public/models/big-yahu.glb", import.meta.url);
const modelHash = createHash("sha256").update(readFileSync(modelSource)).digest("hex").slice(0, 10);
const hashedModel = `big-yahu.${modelHash}.glb`;

/** The model under its hashed name, and a gzip at the highest level next to every text file and the model,
 * served as-is by nginx's gzip_static (infra/site/nginx.conf), so no request waits on compression and none
 * gets a quick, larger one. */
function dist() {
  const compressible = /\.(html|css|js|mjs|json|svg|xml|txt|glb)$/;
  const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  return {
    name: "netnyahoo:dist",
    hooks: {
      "astro:config:setup": ({ command, updateConfig }) => {
        const model = command === "build" ? hashedModel : "big-yahu.glb";
        updateConfig({ vite: { define: { __YAHU_MODEL__: JSON.stringify(model) } } });
      },
      "astro:build:done": ({ dir, logger }) => {
        copyFileSync(modelSource, new URL(`models/${hashedModel}`, dir));
        let files = 0;
        for (const path of walk(fileURLToPath(dir)).filter((p) => compressible.test(p))) {
          const raw = readFileSync(path);
          const gz = gzipSync(raw, { level: constants.Z_BEST_COMPRESSION, memLevel: 9 });
          if (gz.length > raw.length * 0.95) continue;
          writeFileSync(`${path}.gz`, gz);
          files++;
        }
        logger.info(`gzipped ${files} files`);
      },
    },
  };
}

export default defineConfig({
  site: process.env.SITE_URL ?? "https://netnyahoo.com",
  base: process.env.SITE_BASE ?? "/",
  output: "static",
  trailingSlash: "ignore",
  build: { inlineStylesheets: "always", assets: "_assets" },
  image: { responsiveStyles: false },
  devToolbar: { enabled: false },
  integrations: [dist()],
});
