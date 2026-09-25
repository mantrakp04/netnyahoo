/**
 * The window tint while the window is inactive. Dia's window background is vibrant while the
 * window is active, so its tint depends on what's behind the window; inactive, it falls back to
 * an opaque tint that is lighter and a little warmer. Measured on Dia's plum theme (dark) from a
 * 2x capture of an inactive window, de-grained, and fitted in OKLab along the sidebar
 * (docs/dia-spec.md): #2A191F → #312F30 becomes #352224 → #423C3C. Other dark themes get the same
 * OKLab shift. There's no light-appearance capture yet, so light tints don't change.
 */
const DARK_SHIFT: [Lab, Lab] = [
  [0.0382, -0.0002, 0.0072],
  [0.0548, 0.0035, 0.0036],
];

type Lab = [number, number, number];

export function inactiveTint(tint: [string, string], dark: boolean): [string, string] {
  if (!dark) return tint;
  return [shift(tint[0], DARK_SHIFT[0]), shift(tint[1], DARK_SHIFT[1])];
}

function shift(hex: string, d: Lab): string {
  const [L, a, b] = toOklab(hex);
  return fromOklab([L + d[0], a + d[1], b + d[2]]);
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

function toOklab(hex: string): Lab {
  const [r, g, b] = [0, 1, 2].map((i) => toLinear(parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255)) as Lab;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, a, b]: Lab): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const byte = (c: number) => Math.round(Math.min(1, Math.max(0, toGamma(c))) * 255).toString(16).padStart(2, "0");
  return `#${rgb.map(byte).join("").toUpperCase()}`;
}
