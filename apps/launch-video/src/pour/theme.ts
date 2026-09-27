import { SANS } from "../theme";

// Three colours, and the app's own: a warm near-black, champagne (the light, and the type), and the brand's
// campaign red, used once ("Impeach Chrome.") and as the flacon's one enamel dot.
export const P = {
  black: "#0a0807",
  champagne: "#dcc49a",
  red: "#d9432a",
};

/** Wide-tracked caps: the fragrance house's name, the few supers. */
export const caps = (size: number, weight = 420, tracking = 0.42): React.CSSProperties => ({
  fontFamily: SANS,
  fontWeight: weight,
  fontStretch: "118%",
  fontVariationSettings: "\"wdth\" 118",
  fontSize: size,
  lineHeight: 1,
  letterSpacing: `${tracking}em`,
  textTransform: "uppercase",
  color: P.champagne,
  // tracking adds space after the last letter too; this puts the word back on centre
  marginRight: `-${tracking}em`,
});

/** The subtitles and the last card's lines: light, sentence case, a little open. */
export const line = (size: number, weight = 300): React.CSSProperties => ({
  fontFamily: SANS,
  fontWeight: weight,
  fontStretch: "100%",
  fontSize: size,
  lineHeight: 1.2,
  letterSpacing: "0.015em",
  color: P.champagne,
});
