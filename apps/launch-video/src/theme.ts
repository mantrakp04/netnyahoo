import { loadFont } from "@remotion/fonts";
import { continueRender, delayRender, staticFile } from "remotion";

// Three colours and the app's own: near-black, white, and one accent (the site's campaign red), used once.
export const C = {
  black: "#060607",
  white: "#f5f3ef",
  grey: "#a09c96",
  red: "#d9432a",
};

export const SANS = "Archivo";

// Every frame waits for the face, so no frame is ever laid out in a fallback font.
const fonts = delayRender("Loading fonts");
loadFont({ family: SANS, url: staticFile("fonts/archivo-wdth.woff2"), weight: "100 900", format: "woff2" })
  .then(() => document.fonts.ready)
  .then(() => continueRender(fonts));

/** Archivo at its normal width: large, sentence case, tight. */
export const type = (size: number, weight = 640): React.CSSProperties => ({
  fontFamily: SANS,
  fontWeight: weight,
  fontStretch: "100%",
  fontSize: size,
  lineHeight: 1.04,
  letterSpacing: "-0.025em",
  color: C.white,
});
