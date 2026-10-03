import { createContext, type CSSProperties, type ReactNode, useContext } from "react";
import { AbsoluteFill, Easing, Img, interpolate, random, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { useStudioObject } from "../studio-objects-v6";
import footage from "./footage.json";
import { type Aspect, BEAT, type Shot, type TypeLayer } from "./plan";
import { color, font } from "./theme";

// ---------------------------------------------------------------------------------------------- clock

const ShotContext = createContext<Shot | null>(null);
export const ShotProvider = ShotContext.Provider;
export function useShot(): Shot {
  const shot = useContext(ShotContext);
  if (!shot) throw new Error("useShot outside a shot");
  return shot;
}
/** Beats since the shot's downbeat (plus its skip), fractional. */
export function useBeat(): number {
  const shot = useShot();
  return useCurrentFrame() / BEAT + (shot.skip ?? 0);
}
export function useAspect(): Aspect {
  const { width, height } = useVideoConfig();
  return width > height ? "land" : "port";
}

export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);
export const easeIn = Easing.bezier(0.55, 0, 0.9, 0.4);
export const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
/** 0 → 1 between two beats. */
export function seg(b: number, start: number, dur: number, ease: (t: number) => number = easeOut) {
  if (dur <= 0) return b >= start ? 1 : 0;
  return ease(clamp((b - start) / dur));
}
/** A damped spring's position for a step at `start` (beats), 0 → 1 with overshoot. Pure function of time. */
export function springAt(b: number, start: number, { stiffness = 260, damping = 17, mass = 1 } = {}) {
  const t = ((b - start) * BEAT) / 30;
  if (t <= 0) return 0;
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  }
  return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
}
/** A decaying kick (1 at `start`, back to 0), for a hit that bumps the camera. */
export function kick(b: number, start: number, decay = 0.35) {
  if (b < start) return 0;
  return Math.exp(-(b - start) / decay) * Math.cos((b - start) * 9);
}

// ---------------------------------------------------------------------------------------------- stage

/** Warm poster stock with a printed grain that changes every other frame. */
export function Paper({ tone = color.paper, children }: { tone?: string; children?: ReactNode }) {
  return (
    <AbsoluteFill style={{ backgroundColor: tone }}>
      <Grain />
      {children}
    </AbsoluteFill>
  );
}

export function Grain({ opacity = 0.09 }: { opacity?: number }) {
  const frame = useCurrentFrame();
  const seed = Math.floor(frame / 2) % 12;
  return (
    <AbsoluteFill style={{ opacity, mixBlendMode: "multiply", pointerEvents: "none" }}>
      <svg width="100%" height="100%">
        <filter id={`grain-${seed}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={seed} />
          <feColorMatrix values="0 0 0 0 0.1  0 0 0 0 0.08  0 0 0 0 0.06  0 0 0 1.4 -0.35" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#grain-${seed})`} />
      </svg>
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------------------------- footage

type Scene = keyof typeof footage;
export const SCENES = footage;
export function frameCount(scene: Scene) {
  return footage[scene].labels.length;
}
export function frameOf(scene: Scene, label: string, from = 0) {
  const i = footage[scene].labels.indexOf(label, from);
  if (i < 0) throw new Error(`${scene}: no frame labelled ${label}`);
  return i;
}
export function footageSrc(scene: Scene, index: number) {
  const n = frameCount(scene);
  const i = Math.max(0, Math.min(n - 1, Math.round(index)));
  return staticFile(`footage/${scene}/${String(i).padStart(4, "0")}.jpg`);
}

/** The camera on a window: zoom about a point of the window (0–1), then a pan and a tilt. */
export interface Cam {
  zoom: number;
  fx: number;
  fy: number;
  dx: number;
  dy: number;
  rot: number;
}
export const REST: Cam = { zoom: 1, fx: 0.5, fy: 0.5, dx: 0, dy: 0, rot: 0 };
export type CamKey = Partial<Cam> & { at: number; ease?: "spring" | "out" | "inout" | "cut"; dur?: number };

/** Camera keys over beats: each key moves from the previous pose (spring, eased or cut). Pure in time. */
export function camAt(keys: CamKey[], b: number): Cam {
  let pose: Cam = { ...REST, ...keys[0] };
  for (let k = 1; k < keys.length; k++) {
    const key = keys[k];
    if (b < key.at) break;
    const target: Cam = { ...pose, ...key };
    const e = key.ease ?? "spring";
    const t = e === "cut" ? 1 : e === "spring" ? springAt(b, key.at) : seg(b, key.at, key.dur ?? 1, e === "out" ? easeOut : easeInOut);
    pose = {
      zoom: mix(pose.zoom, target.zoom, t), fx: mix(pose.fx, target.fx, t), fy: mix(pose.fy, target.fy, t),
      dx: mix(pose.dx, target.dx, t), dy: mix(pose.dy, target.dy, t), rot: mix(pose.rot, target.rot, t),
    };
  }
  return pose;
}

const WINDOW_PT = 1440;
const CORNER_PT = 21; // macOS 26's window corner, measured from apps/site's ScreenCaptureKit captures

/**
 * A real Netnyahoo window frame (scripts/capture → public/footage) placed by its Studio object (the rest pose, which
 * the owner can drag on the canvas) and moved by the camera. Fast moves get a directional blur.
 */
export function Window({
  id, scene, index, cam, prev, shadow = 1, children, style, pointer,
}: {
  id: string;
  scene: Scene;
  index: number;
  cam: Cam;
  /** The camera a frame earlier, for the motion blur. */
  prev?: Cam;
  shadow?: number;
  children?: ReactNode;
  style?: CSSProperties;
  pointer?: PointerAt | null;
}) {
  const object = useStudioObject(id);
  const w = object.number("width");
  const h = object.number("height");
  const offset = (c: Cam) => ({ x: -(c.fx - 0.5) * w * (c.zoom - 1) + c.dx, y: -(c.fy - 0.5) * h * (c.zoom - 1) + c.dy });
  const o = offset(cam);
  const geometry = object.geometry(
    { x: "x", y: "y", width: "width", height: "height", rotation: "rotation" },
    { offset: { x: o.x, y: o.y, rotation: cam.rot }, scale: cam.zoom },
  );
  let blur = { x: 0, y: 0 };
  if (prev) {
    const p = offset(prev);
    const zoomSpeed = (Math.abs(cam.zoom - prev.zoom) / Math.max(cam.zoom, 1)) * w * 0.12;
    // Only fast moves smear (a whip, a throw, a dive), as a shutter would at 30 fps; a slow push stays sharp.
    const vx = Math.abs(o.x - p.x) + zoomSpeed;
    const vy = Math.abs(o.y - p.y) + zoomSpeed;
    blur = { x: vx > 12 ? Math.min(28, (vx - 12) * 0.16) : 0, y: vy > 12 ? Math.min(28, (vy - 12) * 0.16) : 0 };
  }
  const blurId = `mb-${id}`;
  const blurred = blur.x > 0.6 || blur.y > 0.6;
  const radius = (CORNER_PT / WINDOW_PT) * w;
  return (
    <div {...object.bind} {...geometry.bind} style={{ ...geometry.style, ...style }}>
      {blurred ? (
        <svg width="0" height="0" style={{ position: "absolute" }}>
          <filter id={blurId} x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation={`${(blur.x / cam.zoom).toFixed(2)} ${(blur.y / cam.zoom).toFixed(2)}`} />
          </filter>
        </svg>
      ) : null}
      <div
        style={{
          position: "absolute", inset: 0, borderRadius: radius, overflow: "hidden",
          boxShadow: shadow
            ? `0 ${0.004 * w}px ${0.012 * w}px rgba(22,19,15,${0.25 * shadow}), 0 ${0.03 * w}px ${0.07 * w}px rgba(22,19,15,${0.32 * shadow})`
            : undefined,
          filter: blurred ? `url(#${blurId})` : undefined,
          backgroundColor: color.night,
        }}
      >
        <Img src={footageSrc(scene, index)} style={{ width: "100%", height: "100%", display: "block", objectFit: "cover" }} />
        <div style={{ position: "absolute", inset: 0, borderRadius: radius, boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.10)" }} />
      </div>
      {pointer ? <Pointer at={pointer} width={w} /> : null}
      {children}
    </div>
  );
}

/** macOS's pointer (scripts/capture/cursor.swift), placed in window points; its size and hot spot in points. */
const POINTERS = { arrow: { pt: [28, 40], hot: [5, 5] }, hand: { pt: [32, 32], hot: [12, 8] } } as const;
export interface PointerAt {
  /** Window fractions (0–1). */
  x: number;
  y: number;
  kind: "arrow" | "hand";
  /** 0–1: pressed. */
  press?: number;
}
export function Pointer({ at, width }: { at: PointerAt; width: number }) {
  const p = POINTERS[at.kind];
  const s = width / WINDOW_PT;
  const height = (width * 900) / WINDOW_PT;
  const press = 1 - 0.14 * (at.press ?? 0);
  return (
    <Img
      src={staticFile(`brand/cursor-${at.kind}.png`)}
      style={{
        position: "absolute", left: at.x * width - p.hot[0] * s, top: at.y * height - p.hot[1] * s,
        width: p.pt[0] * s, height: p.pt[1] * s, scale: String(press), transformOrigin: `${p.hot[0] * s}px ${p.hot[1] * s}px`,
      }}
    />
  );
}

/** A pointer that glides between stops (beats) and clicks at each. */
export function pointerAt(b: number, stops: { at: number; x: number; y: number; kind?: "arrow" | "hand"; click?: boolean }[], travel = 0.35): PointerAt | null {
  if (b < stops[0].at - travel) return null;
  let i = 0;
  while (i + 1 < stops.length && b >= stops[i + 1].at - travel) i++;
  const cur = stops[i];
  const next = stops[i + 1];
  let x = cur.x;
  let y = cur.y;
  if (next && b >= next.at - travel) {
    const t = easeInOut(clamp((b - (next.at - travel)) / travel));
    x = mix(cur.x, next.x, t);
    y = mix(cur.y, next.y, t);
  } else if (i === 0 && b < cur.at) {
    const t = easeOut(clamp((b - (cur.at - travel)) / travel));
    x = mix(cur.x + 0.04, cur.x, t);
    y = mix(cur.y + 0.08, cur.y, t);
  }
  const clicked = [cur, next].filter(Boolean).find((s) => s!.click !== false && b >= s!.at && b < s!.at + 0.25);
  const press = clicked ? Math.sin(clamp((b - clicked.at) / 0.25) * Math.PI) : 0;
  return { x, y, kind: cur.kind ?? "arrow", press };
}

// ---------------------------------------------------------------------------------------------- type

const poster: CSSProperties = {
  fontFamily: font.poster, fontWeight: 860, fontStretch: "62%", textTransform: "uppercase", lineHeight: 0.86,
  letterSpacing: "-0.005em", whiteSpace: "pre-line", margin: 0,
};
const mono: CSSProperties = {
  fontFamily: font.mono, fontWeight: 460, fontStretch: "87.5%", letterSpacing: "0.06em", textTransform: "uppercase",
  lineHeight: 1.35, whiteSpace: "pre-line", margin: 0,
};
const serif: CSSProperties = { fontFamily: font.serif, fontWeight: 400, lineHeight: 1.18, whiteSpace: "pre-line", margin: 0 };

let canvas: CanvasRenderingContext2D | null = null;
const measured = new Map<string, number>();
/** The widest line of `text` at 100 px in the poster face (condensed 860, or the stamp's 850 at 75%). */
function lineWidth(text: string, stamp: boolean) {
  const key = `${stamp}:${text}`;
  const hit = measured.get(key);
  if (hit !== undefined) return hit;
  canvas ??= document.createElement("canvas").getContext("2d");
  if (!canvas) return text.length * 45;
  canvas.font = `${stamp ? 850 : 860} 100px "${font.poster}"`;
  (canvas as CanvasRenderingContext2D & { fontStretch: string }).fontStretch = stamp ? "condensed" : "extra-condensed";
  const spacing = stamp ? 7 : -0.5;
  const w = Math.max(...text.toUpperCase().split("\n").map((l) => canvas!.measureText(l).width + spacing * l.length));
  measured.set(key, w);
  return w;
}
/** The largest size up to `size` at which `text` fits the box (width and height). */
export function fitSize(text: string, size: number, width: number, height: number, stamp = false) {
  const lines = text.split("\n").length;
  const byWidth = (100 * width) / Math.max(1, lineWidth(text, stamp));
  const byHeight = height / (lines * (stamp ? 1.45 : 0.9));
  return Math.max(8, Math.min(size, byWidth * 0.97, byHeight));
}

function visible(b: number, layer: TypeLayer, shot: Shot) {
  return b >= layer.at && b < (layer.out ?? shot.beats + (shot.skip ?? 0));
}

/** One of the film's texts, bound to its Studio object (text, size, colour, plate and box are editable). */
export function Type({ layer }: { layer: TypeLayer }) {
  const shot = useShot();
  const b = useBeat();
  const object = useStudioObject(layer.id);
  if (!visible(b, layer, shot)) return null;
  const local = b - layer.at;
  const text = object.text("text");
  const ink = object.text("color");
  const fill = object.text("fill");
  const plate = !/^#[0-9a-f]{6}00$/i.test(fill);
  const boxW = object.number("width");
  const boxH = object.number("height");
  const stampStyle = layer.style === "stamp";
  const sized = layer.style === "slam" || layer.style === "words" || stampStyle;
  // A plate's padding (0.14 em × 0.2 em) and a stamp's two borders come out of the box.
  const room = (s: number) => (plate ? [boxW - s * 0.4, boxH - s * 0.28] : stampStyle ? [boxW - s * 0.9, boxH] : [boxW, boxH]);
  let size = object.number("size");
  if (sized) {
    const [w, h] = room(size);
    size = fitSize(text, size, w, h, stampStyle);
  }
  let scale = 1;
  let extraRot = 0;
  let opacity = 1;
  let shown = text;
  const align = layer.align ?? "left";
  let style: CSSProperties = poster;
  if (layer.style === "slam") {
    const s = springAt(b, layer.at, { stiffness: 620, damping: 26 });
    scale = 1.2 - 0.2 * s;
    extraRot = (1 - s) * (random(layer.id) - 0.5) * 6;
  } else if (layer.style === "stamp") {
    const t = clamp(local / (3 / BEAT));
    scale = t < 1 ? mix(2.4, 0.94, easeIn(t)) : 1 - 0.06 * Math.exp(-(local - 3 / BEAT) * 9);
    opacity = t < 0.15 ? 0 : 1;
  } else if (layer.style === "label") {
    style = mono;
    const chars = Math.ceil(clamp(local / 0.8) * text.length);
    shown = text.slice(0, chars);
  } else if (layer.style === "lede") {
    style = serif;
    const t = seg(b, layer.at, 0.8);
    opacity = t;
    extraRot = 0;
    scale = 1;
  } else if (layer.style === "words") {
    const step = layer.step ?? 1;
    const words = text.split(" ");
    const n = Math.min(words.length, Math.floor(local / step) + 1);
    shown = words.slice(0, n).join(" ");
    const s = springAt(b, layer.at + (n - 1) * step, { stiffness: 520, damping: 24 });
    scale = 1.18 - 0.18 * s;
  }
  const geometry = object.geometry(
    { x: "x", y: "y", width: "width", height: "height", rotation: "rotation" },
    { offset: { rotation: extraRot }, scale },
  );
  const stamp = layer.style === "stamp";
  return (
    <div
      {...object.bind}
      {...geometry.bind}
      style={{
        ...geometry.style, display: "flex", flexDirection: "column",
        justifyContent: plate || stamp || align === "center" ? "center" : "flex-start",
        alignItems: align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center",
        opacity,
      }}
    >
      {stamp ? (
        <div style={{ border: `${size * 0.07}px solid ${ink}`, borderRadius: size * 0.1, padding: size * 0.06, color: ink, mixBlendMode: "multiply" }}>
          <p
            {...object.bindText("text")}
            style={{
              ...poster, fontWeight: 850, fontStretch: "75%", letterSpacing: "0.07em", fontSize: size, lineHeight: 1,
              border: `${size * 0.025}px solid ${ink}`, borderRadius: size * 0.05, padding: `${size * 0.12}px ${size * 0.3}px ${size * 0.08}px`,
              whiteSpace: "nowrap",
            }}
          >
            {text}
          </p>
        </div>
      ) : (
        <div style={plate ? { backgroundColor: fill, padding: `${size * 0.14}px ${size * 0.2}px ${size * 0.1}px` } : undefined}>
          <p {...object.bindText("text")} style={{ ...style, fontSize: size, color: ink, textAlign: align }}>
            {shown}
          </p>
        </div>
      )}
    </div>
  );
}

export function Supers() {
  const shot = useShot();
  return (
    <>
      {shot.type.map((layer) => (
        <Type key={layer.id} layer={layer} />
      ))}
    </>
  );
}

/** A frame-wide shake, decaying from each hit (beats). */
export function useShake(hits: number[], amount = 14) {
  const b = useBeat();
  let x = 0;
  let y = 0;
  for (const h of hits) {
    const k = kick(b, h, 0.18);
    x += k * amount * (random(`x${h}`) - 0.5) * 2;
    y += k * amount * (random(`y${h}`) - 0.5) * 2;
  }
  return { transform: `translate(${x}px, ${y}px)` };
}

export const interp = (b: number, input: number[], output: number[]) =>
  interpolate(b, input, output, { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
