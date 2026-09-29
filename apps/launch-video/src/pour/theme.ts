import { SANS } from "../theme";

export const P = {
  black: "#0a0807",
  champagne: "#dcc49a",
  red: "#d9432a",
};

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
  marginRight: `-${tracking}em`,
});

export const line = (size: number, weight = 300): React.CSSProperties => ({
  fontFamily: SANS,
  fontWeight: weight,
  fontStretch: "100%",
  fontSize: size,
  lineHeight: 1.2,
  letterSpacing: "0.015em",
  color: P.champagne,
});
