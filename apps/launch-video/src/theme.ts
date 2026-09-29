import { loadFont } from "@remotion/fonts";
import { continueRender, delayRender, staticFile } from "remotion";

export const C = {
  black: "#060607",
  white: "#f5f3ef",
  grey: "#a09c96",
  red: "#d9432a",
};

export const SANS = "Archivo";

const fonts = delayRender("Loading fonts");
loadFont({ family: SANS, url: staticFile("fonts/archivo-wdth.woff2"), weight: "100 900", format: "woff2" })
  .then(() => document.fonts.ready)
  .then(() => continueRender(fonts));

export const type = (size: number, weight = 640): React.CSSProperties => ({
  fontFamily: SANS,
  fontWeight: weight,
  fontStretch: "100%",
  fontSize: size,
  lineHeight: 1.04,
  letterSpacing: "-0.025em",
  color: C.white,
});
