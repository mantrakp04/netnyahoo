# Netnyahoo launch video

A 21.5-second, 4:5 (1080×1350) loop for X, made with Remotion: a deadpan campaign ad for a browser.
The browser leads (six pledges, each on a real window capture), the game comes in late ("And when the
Wi-Fi dies, Chrome gives you a dinosaur" → "Find him."), Big Yahu comes up out of the crowd, and the ad
ends on its call to action, "Impeach Chrome. Make Netnyahoo your default. It won't step down." The last
frame is the first (the opening poster), so it loops.

Standalone package (excluded from the root workspace, like `apps/site`):

```bash
cd apps/launch-video
pnpm install
pnpm prepare-assets   # site shots, the Big Yahu model, fonts, your clips/; synthesizes public/sound/track.wav
pnpm capture          # renders the game's rounds from apps/browser/assets/offline-game, frame by frame
pnpm dev              # Remotion Studio
pnpm render           # → output/launch-video/netnyahoo-launch.mp4
pnpm cover            # → the cover still and the answer still
```

Where the pictures come from:

- The pledges and the poster are the site's real window captures of Netnyahoo 0.1.0
  (`apps/site/src/assets/shots`), with camera moves on them. They are stills.
- The offline window is a window capture of Netnyahoo 0.1.2 on x.com while offline
  (`assets/window-offline.webp`); its tab shows frames of the real offline game, captured at the tab's
  exact size by `scripts/capture-game.mjs` in headless Chromium on a frame-exact clock (real motion).
- Big Yahu is the site's model (`apps/site/public/models/big-yahu.glb`), rendered with three.js per frame.

## Shot list (real UI motion to replace the stills)

Record each as a window-only clip of a Netnyahoo window at **1440×900 points** (dark mode, sidebar open,
a wallpaper behind it so the sidebar's translucency shows), 30 fps, about **2.5 s**, H.264 `.mp4`,
cropped to the window. Save it as `apps/launch-video/clips/<name>.mp4`, run `pnpm prepare-assets` and
`pnpm render`; the clip plays in place of that pledge's still (`src/Launch.tsx`, `clip`).

| File | Pledge | What to do on camera |
|---|---|---|
| `sidebar.mp4` | Tabs belong in the sidebar. | Six pinned tiles (GitHub, YouTube, Wikipedia, Hacker News, Reddit, Spotify) and a few tabs. Hover down the tiles, then click two tabs so the page changes. |
| `split.mp4` | Two pages. No coalition talks. | Start on one page, drag a sidebar tab onto the page's right half, let the split settle, scroll the right pane a little. |
| `profiles.mp4` | Separate profiles for separate lives. | Three profiles with different colours. Two-finger swipe across the sidebar from the first to the third, pausing about half a second on each. |
| `extensions.mp4` | Forms a coalition with any extension. | On a Chrome Web Store extension page, move to "Add to Netnyahoo", click it, confirm, and hold on the added state. |
| `ublock.mp4` | Tracks nothing. | Open Settings › Privacy & Security, toggle "Block ads" off and on, then hover the rules-loaded count. |
| `command-bar.mp4` | AI features: zero. | Press ⌘T or ⌘L, type a short query letter by letter so suggestions appear, press Return, and hold on the results. |
