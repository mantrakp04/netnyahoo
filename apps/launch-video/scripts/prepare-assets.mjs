// Copies what the video uses into public/ (gitignored): the site's real window captures and
// mascot model, the game's Big Yahu portraits, fonts, and this package's own window capture.
// Run before `pnpm dev` / `pnpm render` (the `capture` script fills public/capture/).
import { cpSync, mkdirSync } from "node:fs";
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
for (const s of ["browse", "extensions", "privacy", "split", "command-bar", "profile-plum", "profile-blue", "profile-green"]) {
  copy(join(repo, `apps/site/src/assets/shots/${s}.webp`), `shots/${s}.webp`);
}
copy(join(repo, "apps/site/src/assets/game/wanted.webp"), "game/wanted.webp");
copy(join(repo, "apps/site/src/assets/app-icon.png"), "game/app-icon.png");
copy(join(root, "assets/window-offline.webp"), "window/window-offline.webp");
const fonts = join(root, "node_modules/@fontsource-variable");
copy(join(fonts, "archivo/files/archivo-latin-wdth-normal.woff2"), "fonts/archivo-wdth.woff2");
copy(join(fonts, "martian-mono/files/martian-mono-latin-wdth-normal.woff2"), "fonts/martian-mono-wdth.woff2");
console.log("assets ready in", pub);
