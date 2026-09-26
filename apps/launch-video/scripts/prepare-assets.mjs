// Copies what the video uses into public/ (gitignored): the captures (assets/web, assets/footage), the
// soundtrack's parts (assets/sound), the site's Big Yahu model and app icon, and the fonts.
// Run before `pnpm dev` / `pnpm render`; `pnpm sound` then builds public/sound/track.wav.
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

copy(join(root, "assets/web"), "web");
copy(join(root, "assets/footage"), "footage");
copy(join(root, "assets/sound"), "sound/parts");
copy(join(repo, "apps/site/public/models/big-yahu.glb"), "models/big-yahu.glb");
copy(join(repo, "apps/site/src/assets/app-icon.png"), "web/app-icon.png");
const fonts = join(root, "node_modules/@fontsource-variable");
copy(join(fonts, "archivo/files/archivo-latin-wdth-normal.woff2"), "fonts/archivo-wdth.woff2");
copy(join(fonts, "martian-mono/files/martian-mono-latin-wdth-normal.woff2"), "fonts/martian-mono-wdth.woff2");
console.log("assets ready in", pub);
