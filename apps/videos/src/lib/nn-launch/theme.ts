import { continueRender, delayRender, staticFile } from "remotion";

// The site's campaign-poster system (apps/site/src/styles/global.css): warm stock, ink, the tie's blue, the stamp's red.
export const color = {
  paper: "#F1ECE2",
  paperDeep: "#E6DFD1",
  ink: "#16130F",
  ink2: "#57524A",
  rule: "rgba(22, 19, 15, 0.16)",
  tie: "#2150D9",
  stamp: "#C3371F",
  night: "#15120F",
  night2: "#221E1A",
  nightInk: "#EFE8DC",
  nightInk2: "#A79F93",
} as const;

// The app's profile swatches (apps/browser/src/lib/theme.ts PROFILE_COLORS).
export const swatch = {
  plum: "#C07A98",
  blue: "#4691C3",
  purple: "#7873AF",
  pink: "#D37B8B",
  red: "#C1575C",
  orange: "#D87249",
  yellow: "#E3AC38",
  green: "#3EB489",
  neutral: "#8E8E93",
} as const;

export const font = {
  poster: "Archivo",
  serif: "Newsreader",
  mono: "Martian Mono",
} as const;

const faces: [string, string, Record<string, string>][] = [
  [font.poster, "fonts/archivo-latin-wdth-normal.woff2", { weight: "100 900", stretch: "62% 125%" }],
  [font.mono, "fonts/martian-mono-latin-wdth-normal.woff2", { weight: "100 800", stretch: "75% 112.5%" }],
  [font.serif, "fonts/newsreader-latin-opsz-normal.woff2", { weight: "200 800" }],
  [font.serif, "fonts/newsreader-latin-opsz-italic.woff2", { weight: "200 800", style: "italic" }],
];

let loaded = false;
export function loadFonts() {
  if (loaded || typeof document === "undefined") return;
  loaded = true;
  const handle = delayRender("brand fonts");
  Promise.all(
    faces.map(([family, file, descriptors]) => {
      const face = new FontFace(family, `url(${staticFile(file)}) format("woff2")`, descriptors);
      document.fonts.add(face);
      return face.load();
    }),
  )
    .then(() => continueRender(handle))
    .catch((error: unknown) => {
      throw new Error(`fonts: ${String(error)} (run scripts/prepare-assets.sh)`);
    });
}
