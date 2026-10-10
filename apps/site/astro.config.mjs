import { defineConfig } from "astro/config";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { constants, gzipSync } from "node:zlib";

/** A gzip at the highest level next to every text file, served as-is by nginx's gzip_static
 * (infra/site/nginx.conf), so no request waits on compression and none gets a quick, larger one. */
function dist() {
  const compressible = /\.(html|css|js|mjs|json|svg|xml|txt)$/;
  const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  return {
    name: "arcadia:dist",
    hooks: {
      "astro:build:done": ({ dir, logger }) => {
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
