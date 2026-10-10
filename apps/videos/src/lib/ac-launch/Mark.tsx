// Arcadia's logo in the film: the oil-painted hills and sun (docs/brand/arcadia), as two layers cut from the same
// painting by scripts/prepare-assets.sh (public/brand/hills.png and sun.png, on the mark's own 931 × 702 canvas), so
// the sun can rise from behind the hills, hop and glow while the hills rise, lean and shove. Pure in time.
import type { CSSProperties } from "react";
import { Img, staticFile } from "remotion";
import { useStudioObject } from "../studio-objects-v6";
import { useAspect } from "./kit";

/** The mark's canvas, and the sun's centre and radius on it (fractions of its width and height; prepare-assets.sh). */
const MARK = { w: 931, h: 702 };
const SUN = { x: 0.5623, y: 0.1724, r: 0.1316 };
/** The brand's sun (docs/brand/arcadia/README.md). */
export const SUN_COLOR = "#E6BC62";
/** How far the sun sinks to set behind the hills, in the mark's heights: its disc then sits wholly inside them. */
const SET = 0.52;

/** The painted sun alone, filling a `size` square (cut from the sun layer). */
export function SunDisc({ size, style }: { size: number; style?: CSSProperties }) {
  const w = size / (2 * SUN.r);
  const h = (w * MARK.h) / MARK.w;
  return (
    <div style={{ position: "absolute", width: size, height: size, overflow: "hidden", borderRadius: "50%", ...style }}>
      <Img
        src={staticFile("brand/sun.png")}
        style={{ position: "absolute", width: w, height: h, left: size / 2 - SUN.x * w, top: size / 2 - SUN.y * h, maxWidth: "none" }}
      />
    </div>
  );
}

/** A warm glow behind the sun: `amount` 0–1. */
function Glow({ cx, cy, radius, amount }: { cx: number; cy: number; radius: number; amount: number }) {
  if (amount <= 0.001) return null;
  const r = radius * (1.9 + 0.5 * amount);
  return (
    <div
      style={{
        position: "absolute", left: cx - r, top: cy - r, width: r * 2, height: r * 2, borderRadius: "50%",
        background: `radial-gradient(circle, ${SUN_COLOR} 0%, rgba(230,188,98,0.55) 38%, rgba(230,188,98,0) 70%)`,
        opacity: 0.6 * Math.min(1, amount),
      }}
    />
  );
}

export interface MarkPose {
  /** 0–1: the whole mark comes up from below its box (a spring may overshoot). */
  rise?: number;
  /** 0–1: the sun rises from behind the hills (0: set, hidden in them). */
  sun?: number;
  /** The sun's hop above its place, in px. */
  sunLift?: number;
  /** Squash (+) and stretch (−) of the sun, about its lowest point. */
  sunSquash?: number;
  /** 0–1: the glow behind the sun. */
  glow?: number;
  /** The mark shoved sideways, in px, and leaning (degrees, about its base). */
  dx?: number;
  lean?: number;
  /** Squash (+) and stretch (−) of the whole mark, about its base. */
  squash?: number;
  /** Fade the lower part out (a mark peeking up from the bottom of the frame). */
  fade?: boolean;
  /** Extra lift of the whole mark, in px. */
  lift?: number;
}

/**
 * The mark in its Studio box, fitted to the box and standing on its floor. In portrait the frame's floor is the safe
 * zone's (y 1480), with captions below: it comes up a short way and fades in there, instead of rising from below.
 */
export function Mark({ id, pose }: { id: string; pose: MarkPose }) {
  const { rise = 1, sun = 1, sunLift = 0, sunSquash = 0, glow = 0, dx = 0, lean = 0, squash = 0, fade = false, lift = 0 } = pose;
  const object = useStudioObject(id);
  const port = useAspect() === "port";
  const bw = object.number("width");
  const bh = object.number("height");
  const travel = port ? 0.18 : 1.1;
  const geometry = object.geometry(
    { x: "x", y: "y", width: "width", height: "height", rotation: "rotation" },
    // A spring may overshoot; the rise never lifts it above its box.
    { offset: { x: dx, y: (1 - Math.min(1, rise)) * bh * travel - lift } },
  );
  if (rise <= 0.001) return null;
  // The painting fitted to the box, centred, standing on the box's floor.
  const scale = Math.min(bw / MARK.w, bh / MARK.h);
  const mw = MARK.w * scale;
  const mh = MARK.h * scale;
  const left = (bw - mw) / 2;
  const top = bh - mh;
  const d = 2 * SUN.r * mw;
  const cx = SUN.x * mw;
  const cy = SUN.y * mh + (1 - sun) * SET * mh - sunLift;
  const mask = fade ? { maskImage: "linear-gradient(to bottom, black 62%, transparent 94%)", WebkitMaskImage: "linear-gradient(to bottom, black 62%, transparent 94%)" } : {};
  return (
    <div {...object.bind} {...geometry.bind} style={{ ...geometry.style, ...mask, opacity: port ? Math.min(1, rise * 1.5) : 1 }}>
      <div
        style={{
          position: "absolute", left, top, width: mw, height: mh, transformOrigin: "50% 100%",
          transform: `rotate(${lean}deg) scale(${1 + squash * 0.1}, ${1 - squash * 0.1})`,
        }}
      >
        <Glow cx={cx} cy={cy} radius={d / 2} amount={glow * Math.min(1, Math.max(0, sun))} />
        <SunDisc
          size={d}
          style={{
            left: cx - d / 2, top: cy - d / 2, transformOrigin: "50% 100%",
            transform: `scale(${1 + sunSquash * 0.14}, ${1 - sunSquash * 0.14})`,
          }}
        />
        <Img
          src={staticFile("brand/hills.png")}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", filter: "drop-shadow(0 14px 18px rgba(32,63,50,0.22))" }}
        />
      </div>
    </div>
  );
}

/**
 * The sun alone in its Studio box, peeking up from behind something drawn over it. `up` 0–1. Its centre rests at 42% of
 * the box in 16:9 and at 72% in 9:16, where the window's top edge sits at the box's foot.
 */
export function SunPeek({ id, up, squash = 0, glow = 0 }: { id: string; up: number; squash?: number; glow?: number }) {
  const object = useStudioObject(id);
  const port = useAspect() === "port";
  const bw = object.number("width");
  const bh = object.number("height");
  const geometry = object.geometry(
    { x: "x", y: "y", width: "width", height: "height", rotation: "rotation" },
    { offset: { y: (1 - Math.min(1, up)) * bh * 0.85 } },
  );
  if (up <= 0.001) return null;
  const d = Math.min(bw, bh) * 0.7;
  const cx = bw / 2;
  const cy = bh * (port ? 0.72 : 0.42);
  return (
    <div {...object.bind} {...geometry.bind} style={geometry.style}>
      <Glow cx={cx} cy={cy} radius={d / 2} amount={glow} />
      <SunDisc size={d} style={{ left: cx - d / 2, top: cy - d / 2, transformOrigin: "50% 100%", transform: `scale(${1 + squash * 0.14}, ${1 - squash * 0.14})` }} />
    </div>
  );
}
