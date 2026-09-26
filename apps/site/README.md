# Netnyahoo site

The landing page. Astro, built to static files (`dist/`), deployable to GitHub Pages or Cloudflare Pages.

It's a standalone package: the repo's pnpm workspace excludes it (the root hoists `node_modules` for React
Native), so install it on its own.

```bash
cd apps/site
pnpm install
pnpm dev        # http://localhost:4321
pnpm build      # → dist/
pnpm preview    # serve dist/
```

`SITE_URL` sets the canonical/OG origin, `SITE_BASE` the path prefix (e.g. `SITE_BASE=/netnyahoo` for GitHub
Pages without a custom domain).

## Updating

- **A release:** bump `VERSION` and `DMG_SIZE` in `src/data/release.ts`. The download button links to
  `releases/latest/download/Netnyahoo-<version>.dmg`.
- **Release notes:** `/release-notes` renders the repo's `docs/release-notes/<version>.md` (one file per version,
  `src/content.config.ts`), newest first, each at `/release-notes#<version>`. The app opens that anchor after it
  updates, so rebuild and redeploy the site when a release ships (`docs/releasing.md`).
- **Screenshots:** `src/assets/shots/*.webp` are real window captures of Netnyahoo (2×, transparent outside
  the window). `office.webp` and `profile-*.webp` are from 0.2.1 (`screencapture -l <windowID> -o` of a hidden
  test instance), `address-*.webp` from the address-bar-in-sidebar build, and `split`, `extensions` and
  `privacy` from 0.1.0 (`privacy.webp` is the app's own offscreen render of that Settings pane, no window
  frame). `game/crowd.webp` is a work-in-progress capture of the offline game; its hotspot coordinates are in
  `Game.astro`. Replace a file with a new capture of the same name; Astro makes the AVIF/WebP sizes. On phones
  a shot shows only its `focus` region (see `Shot.astro` and `data/pledges.ts`), so check the crop after
  replacing one.
- **Big Yahu:** `public/models/big-yahu.glb` is a drop-in slot. Any rigged GLB with clips named `Griddy` and
  `Default Dance` works; the page frames him from his bounding box. `node scripts/build-model.mjs` rebuilds it
  from the brand sources in the main checkout's `output/` (simplify, WebP textures, meshopt). The hero's
  poster (`src/assets/yahu-poster.webp`, shown until WebGL is ready or when it isn't available) is a render of
  the same scene: in `pnpm dev`, `__yahu.snapshot()` in the console returns it as a PNG data URL.
