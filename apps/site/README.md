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
  the window). `office.webp`, `address-*.webp` and `profile-*.webp` are 0.2.9 captures on macOS 26+, with the
  Liquid Glass pinned tiles and address field (`screencapture -l <windowID> -o` of a hidden test instance drawn
  as the active window), and `split`, `extensions` and
  `privacy` from 0.1.0 (`privacy.webp` is the app's own offscreen render of that Settings pane, no window
  frame). `pip.webp` is 0.2.13 (the export, re-signed to inject the draw-active dylib): the window on Wikipedia with
  the Picture in Picture window where Chrome opened it (window-relative 1085, 692 pt), its real shadow from
  `screencapture -l`; `pip-loop.{mp4,webm}` is that rectangle over 7 s of SCK captures of the PiP window, laid
  over the still by `Shot.astro` (`loop` in `data/pledges.ts`; `scripts/loops.ts` plays it, never with reduced
  motion or Save-Data). SCK captures of the main window show macOS's "being shared" capsule in place of the
  traffic lights, so its pixels come from `screencapture`. `game/crowd.webp` is a work-in-progress capture of the offline game; its hotspot coordinates are in
  `Game.astro`. Replace a file with a new capture of the same name; Astro makes the AVIF/WebP sizes. On phones
  a shot shows only its `focus` region (see `Shot.astro` and `data/pledges.ts`), so check the crop after
  replacing one.
- **Big Yahu:** `public/models/big-yahu.glb` is a drop-in slot. Any rigged GLB with clips named `Griddy` and
  `Default Dance` works; the page frames him from his bounding box. `node scripts/build-model.mjs` rebuilds it
  from the brand sources in the main checkout's `output/` (simplify, WebP textures, meshopt). The hero's
  poster (`src/assets/yahu-poster.webp`, shown until WebGL is ready or when it isn't available) is a render of
  the same scene: in `pnpm dev`, `__yahu.snapshot()` in the console returns it as a PNG data URL. A build
  also writes it as `big-yahu.<content hash>.glb`, the name the page asks for and nginx caches for a year.
- **Fonts:** Fontsource's variable faces, with each Latin file split into the characters the site sets
  (preloaded) and the rest (`src/styles/fonts.css` and `src/assets/fonts/`, both from
  `node scripts/build-fonts.mjs`). Rerun it when new copy or a release note brings in a Latin character the
  core lacks; until then that character still renders, from the full file.

## Analytics

netnyahoo.com counts its own visitors: `src/scripts/telemetry/` posts events to `/otel/v1/logs` on the same
origin (OTLP/HTTP JSON; netnyahoo.com's nginx hands them to our OpenTelemetry Collector, which writes
ClickHouse) and rrweb session replays to `/otel/replay/<session>/<seq>.json[.gz]` (SeaweedFS, kept 30 days).
The one third-party script is PostHog's support chat ("Write to the office", `src/scripts/support.ts`): posthog-js
loads through nginx's `/relay` only when someone clicks the button, with everything but the chat switched off.
Event and property names are PostHog's (`$pageview`, `$pageleave`, `$autocapture`,
`$rageclick`, `$dead_click`, `$dead_swipe`, `$exception`, `$web_vitals`, `$feature_flag_called`, `$browser`,
`$os`, `$device_type` …), so the migrated PostHog history and new events read the same. Console warnings and
errors go out as plain logs. Replays mask every input and the text of anything marked `.nn-private` or
`data-private`; rrweb and web-vitals load in their own chunks after the page has. Settings (hosts, sample rate,
minimum session length, flags) are in `src/data/telemetry.ts`. The named events are listed at the top of
`src/scripts/analytics.ts`; tag a link with `data-track="event"` and `data-track-<prop>="value"`, or call
`track()` from `src/scripts/track.ts`.

Visitors are sorted before the first paint (`src/components/Visitor.astro`): phones and tablets get
"Send to my Mac" instead of Download (`src/scripts/send-to-mac.ts`), Windows and Linux get a "Mac only for now"
line, and only Macs evaluate the `download-band` experiment (`src/components/InOffice.astro`). On localhost,
`?nndevice=phone|mac|other` and `?nnflag=band|control` force them. The experiment log is `docs/growth.md`.

Only netnyahoo.com reports. `pnpm dev`, `pnpm preview` and any other host stay silent unless you opt in from
the console with `localStorage.setItem("nn:telemetry", "dev")` (the old `"nn:posthog"` works too), and then
events go to the same paths on that host and carry `environment: development`. Remove the item when you're done.
