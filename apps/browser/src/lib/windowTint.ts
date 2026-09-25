/**
 * Dia 1.50's window background (docs/dia-spec.md › Window translucency), `PlatformWindowViewController`
 * `backgroundBaseView` + `backgroundOverlayTintView`:
 * - the desktop behind the window, blurred: an NSVisualEffectView (material 29 dark / `.hudWindow`
 *   light) that AppKit turns into an opaque fill while the window is inactive or Reduce
 *   Transparency is on;
 * - `WindowBackground/BaseTint` over it: black 0.4 (dark) / white 0.8 (light);
 * - a vertical gradient of the profile colour at `gradientAlpha`, in a view at alpha 0.5 (dark) /
 *   0.75 (light): the colour at the top, the colour with its HSL lightness raised by
 *   `gradientLightnessDelta` at the bottom (HSL of the P3 components).
 * The native side (WindowBackdrop `vibrancy`) has the fixed parts; these are the per-window inputs,
 * from `WindowViewModel.State.BackgroundTintInfo`.
 */
export type BackdropTint = {
  /** The profile colour as Display P3 hex: Dia's is a P3 colour, lightened in P3. */
  tintColor: string;
  tintAlpha: number;
  tintLightness: number;
};

/** `gradientLightnessDelta`: 0.25 with the New Tab rebrand (on in 1.50), 0.4 without. */
const LIGHTNESS = 0.25;

export function backdropTint(color: string, neutral: boolean): BackdropTint {
  // `gradientAlpha ?? (isNeutralTheme ? 0.12 : 0.36)`.
  return { tintColor: color, tintAlpha: neutral ? 0.12 : 0.36, tintLightness: LIGHTNESS };
}

/**
 * The blur's opaque fill while the window is inactive (Display P3, measured over this Mac's
 * wallpaper, which AppKit tints it with): material 29 (dark) and `.hudWindow` (light).
 */
const INACTIVE_FILL = { dark: [40.7, 33.1, 31.8], light: [235, 231, 230] };

/**
 * What the backdrop looks like with the blur opaque (inactive window, Reduce Transparency), top →
 * bottom: for surfaces that need the window colour as a solid fill (P3 values written as sRGB hex,
 * a close enough approximation for these dark and light greys).
 */
export function opaqueTint(tint: BackdropTint, dark: boolean): [string, string] {
  const a = tint.tintAlpha * (dark ? 0.5 : 0.75);
  const under = dark ? INACTIVE_FILL.dark.map((f) => 0.6 * f) : INACTIVE_FILL.light.map((f) => 0.8 * 255 + 0.2 * f);
  const top = rgb(tint.tintColor);
  const bottom = lighten(top, tint.tintLightness);
  const over = (c: number[]) => hex(c.map((v, i) => a * v + (1 - a) * under[i]!));
  return [over(top), over(bottom)];
}

/**
 * The profile colour for a swatch's hue, at the saturation and lightness of the one measured from
 * Dia (pink profile, P3 #B25B6B: HSL 349°, 0.36, 0.53). Other colours are unmeasured.
 */
export function tintForHue(swatch: string, grey = false): string {
  const [h] = hsl(rgb(swatch));
  return hex(fromHsl(h, grey ? 0 : 0.36, 0.527));
}

const rgb = (hex: string) => [0, 1, 2].map((i) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16));
const hex = (c: number[]) =>
  `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

function hsl([r, g, b]: number[]): [number, number, number] {
  const [R, G, B] = [r! / 255, g! / 255, b! / 255];
  const max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h / 6, s, l];
}

function fromHsl(h: number, s: number, l: number): number[] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const ch = (t: number) => {
    t = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  return [ch(h + 1 / 3), ch(h), ch(h - 1 / 3)].map((v) => v * 255);
}

/** HSL lightness + `delta`, clamped: Dia's colour helper (and WindowBackdropView's). */
function lighten(c: number[], delta: number): number[] {
  const [h, s, l] = hsl(c);
  return fromHsl(h, s, Math.min(1, Math.max(0, l + delta)));
}
