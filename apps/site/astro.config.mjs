import { defineConfig } from "astro/config";

export default defineConfig({
  site: process.env.SITE_URL ?? "https://netnyahoo.example",
  base: process.env.SITE_BASE ?? "/",
  output: "static",
  trailingSlash: "ignore",
  build: { inlineStylesheets: "always", assets: "_assets" },
  image: { responsiveStyles: false },
  devToolbar: { enabled: false },
});
