import { Easing, Img, interpolate, OffthreadVideo, staticFile, useCurrentFrame } from "remotion";
import { C, mono, poster } from "./theme";

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const outCubic = Easing.bezier(0.22, 1, 0.36, 1);
export const inOut = Easing.bezier(0.65, 0, 0.35, 1);
/** 0 → 1 between frames a and b, eased. */
export const ease = (f: number, a: number, b: number, e = inOut) => interpolate(f, [a, b], [0, 1], { ...clamp, easing: e });
export const mix = (a: number, b: number, k: number) => a + (b - a) * k;

export type Rect = { x: number; y: number; w: number; h: number };
export const mixRect = (a: Rect, b: Rect, k: number): Rect => ({ x: mix(a.x, b.x, k), y: mix(a.y, b.y, k), w: mix(a.w, b.w, k), h: mix(a.h, b.h, k) });
export const FULL: Rect = { x: 0, y: 0, w: 1080, h: 1350 };

/**
 * A capture shown through a frame rect (`box`, in video px) looking at `cam` (a rect in the capture's own
 * pixels). The capture keeps its aspect; the box crops it. `video` plays from the enclosing Sequence's start.
 */
export const Media: React.FC<{
  src: string;
  size: { w: number; h: number };
  cam: Rect;
  box: Rect;
  video?: boolean;
  startFrom?: number;
  playbackRate?: number;
  radius?: number;
  filter?: string;
  mask?: string;
  background?: string;
  shadow?: boolean;
}> = ({ src, size, cam, box, video, startFrom = 0, playbackRate = 1, radius = 0, filter, mask, background, shadow }) => {
  const s = box.w / cam.w;
  const style: React.CSSProperties = {
    position: "absolute",
    left: -cam.x * s,
    top: -cam.y * s,
    width: size.w * s,
    height: size.h * s,
    maxWidth: "none",
    ...(mask ? { maskImage: `url(${staticFile(mask)})`, maskSize: "100% 100%", WebkitMaskImage: `url(${staticFile(mask)})`, WebkitMaskSize: "100% 100%" } : {}),
  };
  return (
    <div
      style={{
        position: "absolute",
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        overflow: "hidden",
        borderRadius: radius,
        background,
        filter,
        boxShadow: shadow ? "0 30px 60px rgba(22,19,15,0.28), 0 6px 16px rgba(22,19,15,0.18)" : undefined,
      }}
    >
      {video ? (
        <OffthreadVideo src={staticFile(src)} startFrom={startFrom} playbackRate={playbackRate} muted style={style} />
      ) : (
        <Img src={staticFile(src)} style={style} />
      )}
    </div>
  );
};

/** Film grain: a fresh noise field every frame. */
export const Grain: React.FC<{ opacity: number; dark?: boolean }> = ({ opacity, dark }) => {
  const f = useCurrentFrame();
  return (
    <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, opacity, mixBlendMode: dark ? "screen" : "multiply", pointerEvents: "none" }}>
      <filter id={`g${f}`}>
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={f % 97} stitchTiles="stitch" />
        <feColorMatrix values={dark ? "0 0 0 0 0.9  0 0 0 0 0.9  0 0 0 0 0.9  0 0 0 0.5 0" : "0 0 0 0 0.45  0 0 0 0 0.4  0 0 0 0 0.33  0 0 0 0.2 0"} />
      </filter>
      <rect width="100%" height="100%" filter={`url(#g${f})`} />
    </svg>
  );
};

/** The attack ad's look: black and white, soft (archival footage; small print and brands don't survive), crushed. */
export const ATTACK_FILTER = "grayscale(1) contrast(1.35) brightness(0.86) blur(1.6px)";

export const Vignette: React.FC<{ strength?: number }> = ({ strength = 0.7 }) => (
  <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 45%, rgba(0,0,0,${strength}) 100%)` }} />
);

/** A line that pops in (6 frames: a touch large → settled) and optionally out. */
export const Pop: React.FC<{ at: number; out?: number; children: React.ReactNode; origin?: string; style?: React.CSSProperties }> = ({ at, out, children, origin = "0% 50%", style }) => {
  const f = useCurrentFrame();
  const k = ease(f, at, at + 6, outCubic);
  const o = ease(f, at, at + 3, outCubic) * (out === undefined ? 1 : 1 - ease(f, out - 4, out));
  return <div style={{ transformOrigin: origin, transform: `scale(${mix(1.06, 1, k)})`, opacity: o, ...style }}>{children}</div>;
};

/** The campaign half's supers, over the paper: a red kicker, the claim, the small print. */
export const Supers: React.FC<{ from: number; to: number; kicker: string; title: string; size: number; sub?: string; last?: boolean; titleAt?: number }> = ({ from, to, kicker, title, size, sub, last, titleAt = from + 2 }) => (
  <div style={{ position: "absolute", left: 44, top: 52, right: 44 }}>
    <Pop at={from} out={last ? undefined : to}>
      <div style={{ ...mono(28, 700), color: C.stamp }}>{kicker}</div>
    </Pop>
    <Pop at={titleAt} out={last ? undefined : to}>
      <div style={{ ...poster(size), marginTop: 18, whiteSpace: "pre" }}>{title}</div>
    </Pop>
    {sub && (
      <Pop at={titleAt + 3} out={last ? undefined : to}>
        <div style={{ fontFamily: "Archivo Poster", fontWeight: 620, fontStretch: "87.5%", fontSize: 38, lineHeight: 1.18, color: C.inkSoft, marginTop: 22, whiteSpace: "pre" }}>{sub}</div>
      </Pop>
    )}
  </div>
);

/** A rubber stamp that slams in (big → set, 5 frames) at `at`. */
export const Stamp: React.FC<{ at: number; lines: string[]; size: number; rotate?: number; style?: React.CSSProperties; color?: string; paper?: string }> = ({
  at,
  lines,
  size,
  rotate = -6,
  style,
  color = C.stamp,
  paper = "transparent",
}) => {
  const f = useCurrentFrame();
  if (f < at) return null;
  const s = interpolate(f - at, [0, 5], [1.9, 1], { ...clamp, easing: outCubic });
  return (
    <div
      style={{
        position: "absolute",
        transform: `rotate(${rotate}deg) scale(${s})`,
        opacity: interpolate(f - at, [0, 2], [0, 1], clamp),
        border: `${Math.round(size / 11)}px solid ${color}`,
        borderRadius: size / 6,
        padding: `${size * 0.16}px ${size * 0.22}px ${size * 0.02}px`,
        background: paper,
        ...style,
      }}
    >
      {lines.map((l) => (
        <div key={l} style={{ ...poster(size), color, textAlign: "center" }}>
          {l}
        </div>
      ))}
    </div>
  );
};

/** macOS's pointing hand (HIServices' own cursor artwork), hot spot at (13, 8) of 32 pt. */
export const Cursor: React.FC<{ x: number; y: number; scale: number; opacity: number }> = ({ x, y, scale, opacity }) => {
  const size = 32 * scale;
  return (
    <Img
      src={staticFile("web/hand.png")}
      style={{
        position: "absolute",
        left: x - (13 / 32) * size,
        top: y - (8 / 32) * size,
        width: size,
        height: size,
        opacity,
        filter: "drop-shadow(0 1.5px 2px rgba(0,0,0,0.45))",
      }}
    />
  );
};
