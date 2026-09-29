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
copy(join(root, "assets/pour"), "pour");
copy(join(repo, "apps/site/public/models/big-yahu.glb"), "models/big-yahu.glb");
copy(join(repo, "apps/site/src/assets/app-icon.png"), "web/app-icon.png");
const fonts = join(root, "node_modules/@fontsource-variable");
copy(join(fonts, "archivo/files/archivo-latin-wdth-normal.woff2"), "fonts/archivo-wdth.woff2");
copy(join(fonts, "martian-mono/files/martian-mono-latin-wdth-normal.woff2"), "fonts/martian-mono-wdth.woff2");
console.log("assets ready in", pub);
