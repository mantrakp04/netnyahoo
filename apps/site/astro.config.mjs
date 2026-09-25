import { defineConfig } from "astro/config";

// SITE_URL / SITE_BASE let the same build go to a custom domain (base "/") or to GitHub Pages
// under the repo path (SITE_BASE=/netnyahoo).
export default defineConfig({
  site: process.env.SITE_URL ?? "https://netnyahoo.example",
  base: process.env.SITE_BASE ?? "/",
  output: "static",
  trailingSlash: "ignore",
  build: { inlineStylesheets: "always", assets: "_assets" },
  image: { responsiveStyles: false },
  devToolbar: { enabled: false },
});
