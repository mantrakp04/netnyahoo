# Netnyahoo launch video

A 25-second, 4:5 (1080×1350) loop for X, made with Remotion. "Only 1% can find him": three rounds of
Where's Big Yahu? (the offline game) on a 3-second clock, then the reveal that it's the browser's
no-internet page, four receipts, and the end card. The last frame is the first, so it loops.

Standalone package (excluded from the root workspace, like `apps/site`):

```bash
cd apps/launch-video
pnpm install
pnpm prepare-assets   # copies site shots, the Big Yahu model, fonts; synthesizes public/sound/track.wav
pnpm capture          # renders the three rounds from apps/browser/assets/offline-game, frame by frame
pnpm dev              # Remotion Studio
pnpm render           # → output/launch-video/netnyahoo-launch.mp4
pnpm cover            # → the cover still and the round 3 answer still
```

Where the pictures come from:

- `scripts/capture-game.mjs` loads the real offline game page in headless Chromium at the tab's exact
  size in the capture window (923×806 at 2×), with a fixed seed and the game's `debug=1` hook, and steps
  a frame-exact clock (`scripts/clock.js`) so the game's own HUD, reveal animation and banknote confetti
  are captured at 30 fps.
- `assets/window-offline.webp` is a window capture of Netnyahoo 0.1.2 showing that page for x.com while
  offline. The video lays the captured game frames into its tab area (`src/Stage.tsx`).
- The receipts are the site's window captures (`apps/site/src/assets/shots`); Big Yahu is the site's
  model (`apps/site/public/models/big-yahu.glb`), rendered with three.js per frame.
