import { loadFont } from "@remotion/fonts";
import { continueRender, delayRender, staticFile } from "remotion";

// The site's palette and type (apps/site/src/styles/global.css). Three colours, nothing else: paper, ink, campaign red.
export const C = {
  paper: "#f1ece2",
  paperDeep: "#e6dfd1",
  ink: "#16130f",
  inkSoft: "#5a524a",
  stamp: "#c3371f",
};

export const POSTER = "Archivo Poster";
export const MONO = "Martian Mono";

// Every frame waits for both faces, so no frame is ever laid out in a fallback font.
const fonts = delayRender("Loading fonts");
Promise.all([
  loadFont({ family: POSTER, url: staticFile("fonts/archivo-wdth.woff2"), weight: "100 900", format: "woff2" }),
  loadFont({ family: MONO, url: staticFile("fonts/martian-mono-wdth.woff2"), weight: "100 800", format: "woff2" }),
])
  .then(() => document.fonts.ready)
  .then(() => continueRender(fonts));

/** The site's `.poster` style: Archivo at 62% width, heavy, uppercase, tight. */
export const poster = (size: number): React.CSSProperties => ({
  fontFamily: POSTER,
  fontWeight: 860,
  fontStretch: "62%",
  fontSize: size,
  lineHeight: 0.86,
  textTransform: "uppercase",
  letterSpacing: "-0.005em",
  color: C.ink,
});

export const mono = (size: number, weight = 500): React.CSSProperties => ({
  fontFamily: MONO,
  fontWeight: weight,
  fontStretch: "87.5%",
  fontSize: size,
  letterSpacing: "0.02em",
  textTransform: "uppercase",
  color: C.ink,
});
