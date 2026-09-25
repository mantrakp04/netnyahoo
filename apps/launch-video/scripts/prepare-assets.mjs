// Copies what the video uses into public/ (gitignored): window captures, the site's mascot model, the game's Big Yahu portraits, fonts, and this package's own window capture.
// Run before `pnpm dev` / `pnpm render` (the `capture` script fills public/capture/).
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const repo = join(root, "../..");
const pub = join(root, "public");
const copy = (from, to) => {
  mkdirSync(join(pub, to, ".."), { recursive: true });
  cpSync(from, join(pub, to), { recursive: true });
};

copy(join(repo, "apps/site/public/models/big-yahu.glb"), "models/big-yahu.glb");
// The pledges' window captures (Netnyahoo 0.1.0, from the site's shots at a0254d18), kept here so the
// site can change its own.
copy(join(root, "assets/shots"), "shots");
// The user's recordings (README, "Shot list"): clips/<id>.mp4 replaces that pledge's still.
const clipsDir = join(root, "clips");
const clips = existsSync(clipsDir) ? readdirSync(clipsDir).filter((f) => f.endsWith(".mp4")) : [];
for (const c of clips) copy(join(clipsDir, c), `clips/${c}`);
mkdirSync(join(pub, "clips"), { recursive: true });
writeFileSync(join(pub, "clips/manifest.json"), JSON.stringify(clips.map((c) => c.replace(/\.mp4$/, ""))));
copy(join(repo, "apps/site/src/assets/game/wanted.webp"), "game/wanted.webp");
copy(join(repo, "apps/site/src/assets/app-icon.png"), "game/app-icon.png");
copy(join(root, "assets/window-offline.webp"), "window/window-offline.webp");
copy(join(root, "assets/window-sidebar.webp"), "window/window-sidebar.webp");
copy(join(root, "assets/window-toolbar.webp"), "window/window-toolbar.webp");
// The opener's live page recording, as frames (frame-exact, and the loop lands on frame 0).
mkdirSync(join(pub, "opener"), { recursive: true });
execFileSync("/opt/homebrew/bin/ffmpeg", ["-loglevel", "error", "-y", "-i", join(root, "assets/opener-page.mp4"), "-q:v", "2", join(pub, "opener/%04d.jpg")]);
const fonts = join(root, "node_modules/@fontsource-variable");
copy(join(fonts, "archivo/files/archivo-latin-wdth-normal.woff2"), "fonts/archivo-wdth.woff2");
copy(join(fonts, "martian-mono/files/martian-mono-latin-wdth-normal.woff2"), "fonts/martian-mono-wdth.woff2");
console.log("assets ready in", pub);
