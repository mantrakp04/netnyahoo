import type { ComponentType, CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Img, interpolateColors, random, staticFile } from "remotion";
import { useStudioObject } from "../studio-objects-v6";
import {
  type Cam, type CamKey, camAt, clamp, easeIn, easeInOut, easeOut, Fingers, frameOf, Grain, kick, mix, Paper, pointerAt, REST, SCENES,
  seg, springAt, Supers, useAspect, useBeat, useShake, useShot, Window,
} from "./kit";
import { BEAT, CUTS, LAND, type ShotKind } from "./plan";
import { color, font, swatch } from "./theme";
import { Mark, SunPeek } from "./Mark";

/** A window shown whole: in portrait, centred under the type (inside the safe zone, y 220–1480). */
const wideCam = (port: boolean, bump = 0): Cam =>
  port ? { ...REST, zoom: 0.62 * (1 + bump), fx: 0.5, fy: 0.5, aim: 1, ax: 0.5, ay: 0.56 } : { ...REST, zoom: 0.86 * (1 + bump), fx: 0.5, dy: 60 };

function useCam(keys: CamKey[]): { cam: Cam; prev: Cam } {
  const b = useBeat();
  return { cam: camAt(keys, b), prev: camAt(keys, b - 1 / BEAT) };
}

function windowId() {
  const shot = useShot();
  if (!shot.window) throw new Error(`${shot.id} has no window`);
  return shot.window.id;
}
function extraId(suffix: string) {
  const shot = useShot();
  const found = shot.extra?.find((e) => e.id.endsWith(suffix));
  if (!found) throw new Error(`${shot.id} has no ${suffix}`);
  return found.id;
}

const tab = (n: number) => frameOf("tabs", `tab:t${n}`);
/** All the frames with a label, in order. */
function framesOf(scene: keyof typeof SCENES, label: string) {
  const out: number[] = [];
  SCENES[scene].labels.forEach((l, i) => {
    if (l === label) out.push(i);
  });
  if (!out.length) throw new Error(`${scene}: no frames labelled ${label}`);
  return out;
}
/** Plays a run of frames over [start, end) beats, holding the last. */
function playRun(b: number, frames: number[], start: number, end: number) {
  const t = clamp((b - start) / (end - start));
  return frames[Math.min(frames.length - 1, Math.floor(t * frames.length))];
}

/**
 * Which swipe frame shows at beat `b`. Through each drag the frame is picked by the pager's own progress (recorded
 * per frame, footage.json) on an ease-in-out: a soft start (the first step is a few percent), the fastest travel
 * mid-drag and a soft approach, reaching the last captured position (~99%) on the last drag frame, once. The page is
 * composited on the same progress, so page and sidebar travel together. The settled live frame (new name, title and
 * URL) lands one frame before the commit beat, as the page arrives; the commit's thud stays on the beat. The drop's
 * own commit (`onBeat`) lands on its beat.
 */
const PROGRESS = (SCENES.swipe as { progress?: (number | null)[] }).progress ?? [];
type SwipeEvent = { label: string; commit: number; drag: number; onBeat?: boolean; dir?: number };
const landOf = (e: SwipeEvent) => e.commit - (e.onBeat ? 0 : LAND);
const easeInOutSine = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);
function swipeIndex(b: number, events: SwipeEvent[], before = "start") {
  let index = frameOf("swipe", before);
  for (const e of events) {
    const drag = framesOf("swipe", e.label);
    const rest = frameOf("swipe", `${e.label}:rest`);
    const land = landOf(e);
    const start = land - e.drag;
    // An epsilon: `start` and a frame's beat can tie in floating point, which used to drop the drag's first frame.
    if (b < start - 1e-6) return index;
    if (b < land - 1e-6) {
      // The film frames that fall inside the drag (start and land are not always on whole frames): the curve is
      // spread over exactly those, so its last value shows on the last one.
      const first = Math.ceil(start * BEAT - 1e-6);
      const last = Math.ceil(land * BEAT - 1e-6) - 1;
      const frames = Math.max(1, last - first + 1);
      const n = Math.min(frames - 1, Math.max(0, Math.round(b * BEAT) - first));
      const top = Math.min(0.99, PROGRESS[drag[drag.length - 1]] ?? 1);
      const target = easeInOutSine((n + 1) / frames) * top;
      let best = drag[0];
      for (const i of drag) if (Math.abs((PROGRESS[i] ?? 0) - target) < Math.abs((PROGRESS[best] ?? 0) - target)) best = i;
      // The first and last frames never overshoot their targets: the start stays soft, and the landing frame (with
      // its plate and thud) closes the last few percent instead of a still page frame before it.
      if (n === 0 || n === frames - 1) {
        best = drag[0];
        for (const i of drag) if ((PROGRESS[i] ?? 0) <= target && (PROGRESS[i] ?? 0) > (PROGRESS[best] ?? 0)) best = i;
      }
      return best;
    }
    index = rest;
  }
  return index;
}

/** After each commit, a short spring tail by translation only: the page carries ~1% past home and settles. */
function settleDx(b: number, events: SwipeEvent[], width: number) {
  let dx = 0;
  for (const e of events) {
    const f = (b - landOf(e)) * BEAT;
    if (f >= 0 && f < 8) dx += (e.dir ?? -1) * 0.012 * width * Math.sin((Math.PI * f) / 4) * Math.exp(-f / 2.5);
  }
  return dx;
}

const Shake = ({ hits, amount, children }: { hits: number[]; amount?: number; children: ReactNode }) => (
  <AbsoluteFill style={useShake(hits, amount)}>{children}</AbsoluteFill>
);

const SEC = BEAT / 30; // seconds in a beat

// ---------------------------------------------------------------------------------------------- the hook

// Each stab cuts to a stand-in site interrupting you in a Arcadia window (scenes/asks.js, sites/*.example): the
// interruption plays in on the stab, a frame of the page per film frame, and a pointer heads for its button.
const ASK_NAMES = ["signin", "ai", "cookies", "upgrade"];
// The first ask's framing differs by aspect: in 16:9 the window sits low enough for the sun to peek up over its top
// edge; in 9:16 the window's top edge stays at y ~617, under the stab plate, where it peeks up beside it.
const ASK_CAM_0: Record<"land" | "port", Cam> = {
  land: { ...REST, zoom: 1.12, fx: 0.55, fy: 0.62, aim: 1, ax: 0.5, ay: 0.8 },
  port: { ...REST, zoom: 1.12, fx: 0.55, fy: 0.62, aim: 1, ax: 0.46, ay: 0.62 },
};
const ASK_CAMS: Cam[] = [
  ASK_CAM_0.land,
  { ...REST, zoom: 1.12, fx: 0.62, fy: 0.45, aim: 1, ax: 0.5, ay: 0.6, rot: -1 },
  { ...REST, zoom: 1.12, fx: 0.5, fy: 0.72, aim: 1, ax: 0.5, ay: 0.62, rot: 1 },
  { ...REST, zoom: 1.12, fx: 0.55, fy: 0.55, aim: 1, ax: 0.5, ay: 0.66 },
];

function askFrame(b: number) {
  const k = Math.min(3, Math.floor(b));
  const frames = framesOf("asks", `ask:${ASK_NAMES[k]}`);
  // Frame 0 already has the login wall half up over a dimmed page: it has to stop a scroll.
  if (k === 0) return playRun(b, frames.slice(6), 0, 0.35);
  return playRun(b, frames, k + 0.05, k + 0.6);
}
function askPointer(b: number) {
  const k = Math.min(3, Math.floor(b));
  const mark = (SCENES.asks as { marks?: Record<string, { x: number; y: number }> }).marks?.[`ask:${ASK_NAMES[k]}`];
  if (!mark || b < k + 0.35 || b >= 4) return null;
  const t = easeInOut(clamp((b - (k + 0.35)) / 0.5));
  // It starts inside the window: below-right of the button, or above-right when the button sits low.
  const sx = Math.min(0.95, mark.x + 0.14);
  const sy = mark.y > 0.75 ? mark.y - 0.16 : mark.y + 0.16;
  return { x: mix(sx, mark.x, t), y: mix(sy, mark.y, t), kind: "hand" as const };
}

/** A real browser, asked for everything: four stabs over four interruptions, then the asks stamped on the snare roll. */
function Nags() {
  const b = useBeat();
  const shot = useShot();
  const port = useAspect() === "port";
  const stabs = shot.type.filter((t) => t.style === "slam").map((t) => t.at);
  const piles = shot.type.filter((t) => t.style === "stamp").map((t) => t.at);
  const knock = piles.reduce((s, h) => s + kick(b, h, 0.2) * 0.6, 0);
  const k = Math.min(3, Math.floor(b));
  // The last six frames of the upgrade stab push into its fine print, the joke worth reading.
  // Low enough that the UPGRADE. plate (top of frame) clears the modal's padlock.
  const joke: Cam = { ...REST, zoom: port ? 2.4 : 2.6, fx: 0.5635, fy: 0.52, aim: 1, ax: 0.5, ay: port ? 0.62 : 0.7 };
  // Held for a full beat, into the first stamp of the pile.
  const askCam = k === 0 ? ASK_CAM_0[port ? "port" : "land"] : ASK_CAMS[k];
  const cam: Cam = b >= 3.45 && b < 4.45 ? joke : b < 4 ? askCam : { ...REST, zoom: 1 + 0.015 * knock };
  const index = b < 4 ? askFrame(b) : framesOf("asks", "ask:upgrade").slice(-1)[0];
  // The hills rise beside the pile on the pop (the sun still set behind them); on the whoosh they lean back, winding
  // up, and the shove lands on the drop (Title).
  const rise = springAt(b, 7.1, { stiffness: 200, damping: 16 });
  const windup = seg(b, 7.72, 0.28, easeIn);
  return (
    <Paper>
      <Shake hits={[...stabs, ...piles]} amount={10}>
        {/* The sun peeks up from behind the window for the first stab (drawn behind it, so the window hides its lower
            half), glints as the first NO. lands on its beat, and sinks back before the cut. */}
        {b < 1 ? (
          <SunPeek
            id={extraId("sun")}
            up={springAt(b, 0.02, { stiffness: 300, damping: 20 }) * (1 - seg(b, 0.55, 0.28, easeIn))}
            squash={kick(b, 0.5, 0.2)}
            glow={0.7 * seg(b, 0.45, 0.08) * (1 - seg(b, 0.6, 0.3))}
          />
        ) : null}
        <Window id={windowId()} scene="asks" index={index} cam={cam} pointer={askPointer(b)} />
        <Mark id={extraId("mark")} pose={{ rise, sun: 0, dx: 36 * windup, lean: 5 * windup, squash: 0.3 * windup }} />
        <Supers />
      </Shake>
    </Paper>
  );
}

const NAG_PILE = ["nag-pile-1", "nag-pile-2", "nag-pile-3", "nag-pile-4"];

/** One of the hook's stamps, shoved off the window on the drop: thrown outward, spinning, falling. */
function Shoved({ id, k }: { id: string; k: number }) {
  const b = useBeat();
  const t = Math.max(0, b * SEC); // seconds since the drop
  const object = useStudioObject(id);
  // Shoved off to the left, away from the hills: they stand on the right of the frame.
  // Fast, to the left and down: clear of the wordmark (top) within a quarter second.
  const vx = -(2600 + random(`vx${id}`) * 1200);
  const vy = 200 + random(`vy${id}`) * 500;
  const geometry = object.geometry(
    { x: "x", y: "y", width: "width", height: "height", rotation: "rotation" },
    { offset: { x: vx * t, y: vy * t + 2600 * t * t, rotation: (k % 2 ? 1 : -1) * 540 * t } },
  );
  if (t > 0.7) return null;
  const size = object.number("size");
  const ink = object.text("color");
  return (
    <div {...object.bind} {...geometry.bind} style={{ ...geometry.style, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ border: `${size * 0.07}px solid ${ink}`, borderRadius: size * 0.1, padding: size * 0.06, color: ink }}>
        <p
          {...object.bindText("text")}
          style={{
            margin: 0, fontFamily: font.poster, fontWeight: 850, fontStretch: "75%", letterSpacing: "0.07em", textTransform: "uppercase",
            fontSize: size, lineHeight: 1, border: `${size * 0.025}px solid ${ink}`, borderRadius: size * 0.05,
            padding: `${size * 0.12}px ${size * 0.3}px ${size * 0.08}px`, whiteSpace: "nowrap",
          }}
        >
          {object.text("text")}
        </p>
      </div>
    </div>
  );
}

/**
 * The shove, from the hook's wind-up (36 px back, leaning 5°): on the drop the hills lunge left into the pile, leaning
 * in and stretched, then spring back to their place. Returns the pose's dx, lean and squash.
 */
function shove(b: number, reach: number) {
  const lunge = seg(b, 0, 0.14, easeOut);
  const back = springAt(b, 0.14, { stiffness: 170, damping: 13 });
  return {
    dx: mix(mix(36, -reach, lunge), 0, back),
    lean: mix(mix(5, -8, lunge), 0, back),
    squash: mix(mix(0.3, -0.35, lunge), 0, back),
  };
}

function Title() {
  const b = useBeat();
  const shot = useShot();
  const port = useAspect() === "port";
  // The window carries on from the hook, dropping to its title place as the name slams in.
  const settle = springAt(b, 0, { stiffness: 260, damping: 18 });
  const cam: Cam = { ...REST, dy: mix(-120, 0, settle), zoom: 1 + 0.02 * kick(b, 0, 0.3) + 0.03 * seg(b, 3, 1, easeInOut) };
  // The hills: on from the hook, they shove the pile off on the drop; the sun rises over them as the name lands, glints
  // with the stamp on 2, and both sink out at the end of the shot.
  const out = seg(b, shot.beats - 0.7, 0.7, easeIn);
  const mark = useStudioObject(extraId("mark"));
  const push = shove(b, mark.number("width") * (port ? 0.35 : 0.45));
  const sun = springAt(b, 0.2, { stiffness: 90, damping: 12 });
  return (
    <Paper>
      <Shake hits={[0, 2]} amount={14}>
        <Window id={windowId()} scene="tabs" index={tab(1)} cam={cam} />
        {NAG_PILE.map((id, k) => (
          <Shoved key={id} id={id} k={k} />
        ))}
        <Mark
          id={extraId("mark")}
          pose={{
            rise: 1 - out, sun, dx: push.dx, lean: push.lean, squash: push.squash + kick(b, 2, 0.2) * 0.25,
            sunSquash: kick(b, 2, 0.2), glow: 0.5 * seg(b, 0.6, 1) + 0.6 * Math.max(0, kick(b, 2, 0.45)),
          }}
        />
        <Supers />
      </Shake>
    </Paper>
  );
}

// ---------------------------------------------------------------------------------------------- drop A

// The sidebar's tab rows in the toolbar layout: from y 65 pt on a 34 pt pitch.
const row = (i: number) => (65 + 34 * i) / 900;

function Tabs() {
  const b = useBeat();
  const port = useAspect() === "port";
  const scroll = framesOf("tabs", "scroll");
  const index = b < 0.5 ? tab(1) : b < 1.5 ? tab(2) : b < 2.5 ? tab(3) : b < 3 ? tab(4) : b < 3.5 ? tab(1) : playRun(b, scroll, 3.5, 6);
  const clicks = [
    { at: 0.5, x: 0.06, y: row(1) }, { at: 1.5, x: 0.06, y: row(2) }, { at: 2.5, x: 0.06, y: row(3) }, { at: 3.5, x: 0.06, y: row(0) },
    { at: 4.6, x: 0.45, y: 0.55, click: false },
  ];
  const { cam, prev } = useCam([
    { at: 0, zoom: port ? 1.3 : 1.55, fx: 0.16, fy: 0.25, aim: port ? 1 : 0, ax: 0.42, ay: 0.55 },
    { at: 2, ...wideCam(port), ease: "cut" },
    { at: 3.5, ...REST, zoom: port ? 1.4 : 1.5, fx: 0.55, fy: 0.45, aim: 1, ax: 0.5, ay: 0.55, ease: "cut" },
    { at: 5, ...wideCam(port), ease: "cut" },
  ]);
  return (
    <Paper>
      <Window id={windowId()} scene="tabs" index={index} cam={cam} prev={prev} pointer={pointerAt(b, clicks)} />
      <Supers />
    </Paper>
  );
}

const RUN_1 = [
  { label: "toWork", commit: 0.75, drag: 0.6 },
  { label: "toCampaign", commit: 2.25, drag: 0.6 },
  { label: "toSide", commit: 3.75, drag: 0.6 },
];

function Swipe() {
  const b = useBeat();
  const port = useAspect() === "port";
  const index = swipeIndex(b, RUN_1);
  const { cam } = useCam([
    { at: 0, zoom: port ? 1.15 : 2.0, fx: 0.08, fy: 0.16 },
    { at: 5, ...wideCam(port), dy: port ? 0 : -40 },
  ]);
  const bump = RUN_1.reduce((s, e) => s + kick(b, e.commit, 0.2) * 0.015, 0);
  // The gesture, the first time only: two fingers sliding with the first drag.
  const first = RUN_1[0];
  // Fingers slide left (to the next profile) through the drag, then lift.
  const slide = 1 - 2 * clamp((b - (first.commit - first.drag)) / first.drag);
  const glyph = b < first.commit ? 1 : 0;
  return (
    <Paper>
      <Window id={windowId()} scene="swipe" index={index} cam={{ ...cam, zoom: cam.zoom * (1 + bump), dx: cam.dx + settleDx(b, RUN_1, port ? 1080 : 1920) }} />
      {glyph > 0 ? <Fingers x={port ? 540 : 1660} y={port ? 1300 : 840} size={port ? 300 : 260} slide={slide} from={1} opacity={glyph} /> : null}
      <Supers />
    </Paper>
  );
}

// The divider as the capture set it (scenes/split.js): the left pane's share at each step.
const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * x);
const DIVIDER_SIZES = [
  ...Array.from({ length: 16 }, (_, i) => 0.5 - 0.17 * ease((i + 1) / 16)),
  ...Array.from({ length: 22 }, (_, i) => 0.33 + 0.3 * ease((i + 1) / 22)),
  ...Array.from({ length: 12 }, (_, i) => 0.63 - 0.13 * ease((i + 1) / 12)),
];
const DIVIDER = { start: 2, end: 5.5 };

function Split() {
  const b = useBeat();
  const port = useAspect() === "port";
  const run = framesOf("split", "divider");
  // Split view is open on the cut (no single-page beat first).
  const index = b < DIVIDER.start ? frameOf("split", "two") : playRun(b, run, DIVIDER.start, DIVIDER.end);
  const bump = kick(b, 0, 0.25) * 0.02;
  const wide = wideCam(port, bump);
  const close: Cam = { ...REST, zoom: port ? 1.3 : 1.45, fx: 0.5, fy: 0.45, aim: 1, ax: 0.5, ay: port ? 0.55 : 0.52 };
  const cam = b >= DIVIDER.start && b < 5 ? close : wide;
  // The pointer holds the divider: its x follows the panes' share (the page area starts after the 190 pt sidebar).
  const share = b < DIVIDER.start ? 0.5 : DIVIDER_SIZES[Math.min(DIVIDER_SIZES.length - 1, Math.max(0, run.indexOf(index)))];
  const paneLeft = 190 / 1440;
  const pointer = b > DIVIDER.start - 0.4 && b < DIVIDER.end + 0.3
    ? { x: paneLeft + (1 - paneLeft) * share, y: 0.5, kind: "arrow" as const, press: b > DIVIDER.start && b < DIVIDER.end ? 1 : 0 }
    : null;
  // The hills peek up over the bottom edge on the pop, and the sun springs up over them for "NO COALITION TALKS.".
  const markOn = springAt(b, 5, { stiffness: 230, damping: 14 }) * (1 - seg(b, 7.4, 0.6, easeIn));
  return (
    <Paper>
      <Window id={windowId()} scene="split" index={index} cam={cam} pointer={pointer} />
      <Mark
        id={extraId("mark")}
        pose={{
          rise: markOn, sun: springAt(b, 5.05, { stiffness: 240, damping: 15 }), sunSquash: kick(b, 5.3, 0.2),
          glow: 0.55 * seg(b, 5.2, 0.4), squash: kick(b, 5.3, 0.2) * 0.2, fade: port,
        }}
      />
      <Shake hits={[0, 5]} amount={8}>
        <Supers />
      </Shake>
    </Paper>
  );
}

/**
 * The blocker: the page with its ads (blocking switched off, Site Controls open), the pointer switches Block Ads &
 * Trackers on, the page reloads clean and the count climbs to "13 blocked on this page".
 */
function Block() {
  const b = useBeat();
  const port = useAspect() === "port";
  const off = framesOf("block", "off");
  const on = framesOf("block", "on");
  const index = b < 2 ? off[off.length - 1] : b < 5 ? playRun(b, on, 2, 5) : frameOf("block", "onRest");
  const { cam, prev } = useCam([
    { at: 0, ...(port ? wideCam(true) : { ...REST, zoom: 1 }) },
    { at: 1, zoom: port ? 1.7 : 2.4, fx: 0.86, fy: 0.22, aim: 1, ax: port ? 0.5 : 0.62, ay: 0.5, ease: "cut" },
    { at: 3, ...(port ? wideCam(true) : { ...REST, zoom: 1 }), ease: "cut" },
    { at: 4.5, zoom: port ? 2.2 : 3.2, fx: 0.86, fy: 0.27, aim: 1, ax: port ? 0.5 : 0.62, ay: 0.5, ease: "cut" },
  ]);
  const toggle = { x: 0.898, y: 0.262 };
  const clicks = [
    { at: 2, x: toggle.x, y: toggle.y, kind: "hand" as const },
    { at: 2.8, x: toggle.x - 0.08, y: toggle.y + 0.08, kind: "hand" as const, click: false },
  ];
  return (
    <Paper>
      <Window id={windowId()} scene="block" index={index} cam={cam} prev={prev} pointer={pointerAt(b, clicks, 0.5)} />
      <Supers />
    </Paper>
  );
}

// ---------------------------------------------------------------------------------------------- the break

function Chromium() {
  const b = useBeat();
  const cam: Cam = b < 2 ? { ...REST, zoom: 1 + 0.04 * seg(b, 0, 2, easeInOut), fx: 0.35, fy: 0.3 } : { ...REST, zoom: 1.7 + 0.06 * seg(b, 2, 2, easeInOut), fx: 0, fy: 0.3 };
  return (
    <Paper tone={color.night}>
      <Window id={windowId()} scene="typing" index={frameOf("typing", "before")} cam={cam} shadow={0.5} />
      <Supers />
    </Paper>
  );
}

/** The drop-B window (the swipe-big object), shared by the poise and the run so the drop is a match cut. */
const BIG_ID = CUTS.launch.shots.find((s) => s.kind === "swipeBig")?.window?.id ?? "swipe-big-window";

// Drop B: five swipes. The first drags inside the silence and commits on the drop itself (beat 0 of swipeBig).
// Beats here are relative to the drop.
const RUN_2 = [
  { label: "toWeekend", commit: 0, drag: 0.7, dir: -1, onBeat: true },
  { label: "backToSide", commit: 1.5, drag: 0.55, dir: 1 },
  { label: "backToCampaign", commit: 3, drag: 0.5, dir: 1 },
  { label: "backToWork", commit: 4.5, drag: 0.5, dir: 1 },
  { label: "backToPersonal", commit: 6, drag: 0.5, dir: 1 },
];
const RUN_2_TONES = [swatch.green, swatch.yellow, swatch.green, swatch.orange, swatch.blue, swatch.plum];

/**
 * The drop-B window at beat `d` (relative to the drop), shared by the poise and the run so the drop is one continuous
 * shot. The first two swipes are framed whole (sidebar, tint and the coloured stock all change), the next three on a
 * macro of the sidebar and the page's edge. On each commit the window is shoved the way the fingers went.
 */
function dropCam(d: number, port: boolean): Cam {
  // Portrait: the sidebar and the left of the page, big enough to read on a phone, inside the safe zone.
  const whole: Cam = port ? { ...REST, zoom: 0.78, fx: 0.32, fy: 0.5, aim: 1, ax: 0.5, ay: 0.54 } : { ...REST, zoom: 0.8, dy: 40 };
  const macro: Cam = { ...REST, zoom: port ? 1.15 : 1.9, fx: 0.12, fy: 0.2, aim: 1, ax: port ? 0.42 : 0.32, ay: port ? 0.46 : 0.42 };
  const lerp = (a: Cam, b: Cam, t: number): Cam => ({
    zoom: mix(a.zoom, b.zoom, t), fx: mix(a.fx, b.fx, t), fy: mix(a.fy, b.fy, t), dx: mix(a.dx, b.dx, t),
    dy: mix(a.dy, b.dy, t), rot: mix(a.rot, b.rot, t), aim: mix(a.aim, b.aim, t), ax: mix(a.ax, b.ax, t), ay: mix(a.ay, b.ay, t),
  });
  let cam: Cam = d < 2.6 ? whole : d < 7.4 ? macro : lerp(macro, whole, seg(d, 7.4, 2.6, easeInOut));
  if (d < 0) {
    // The poise: a slow push from wider into the framing the drop keeps (no jump on the drop frame).
    const push = seg(d, -4, 3.6, easeInOut);
    cam = { ...whole, zoom: whole.zoom * mix(0.88, 1, push) };
  }
  // The drag pulls the window a little the way the fingers go; the commit carries it on and it springs home.
  const W = port ? 1080 : 1920;
  let dx = 0;
  for (const e of RUN_2) {
    const land = landOf(e);
    const p = clamp((d - (land - e.drag)) / e.drag);
    if (d >= land - e.drag && d < land) dx += e.dir * 0.02 * W * easeInOutSine(p);
    if (d >= land) dx += e.dir * 0.02 * W * Math.exp(-((d - land) * BEAT) / 3);
  }
  return { ...cam, dx: cam.dx + dx + settleDx(d, RUN_2, W) };
}

/**
 * The backdrop behind the drop-B window: the last profile's colour, with the next one wiped in from the side the page
 * comes from, tracking the fingers through each drag (complete on the commit).
 */
function DropStock({ d }: { d: number }) {
  const landed = RUN_2.filter((e) => d >= e.commit).length;
  const base = RUN_2_TONES[landed];
  const next = RUN_2[landed];
  const p = next ? clamp((d - (next.commit - next.drag)) / next.drag) : 0;
  const reveal = (1 - easeInOut(p)) * 100;
  const clip = next && next.dir < 0 ? `inset(0 0 0 ${reveal}%)` : `inset(0 ${reveal}% 0 0)`;
  return (
    <>
      <AbsoluteFill style={{ backgroundColor: base }} />
      {next && p > 0 ? <AbsoluteFill style={{ backgroundColor: RUN_2_TONES[landed + 1], clipPath: clip }} /> : null}
      <Grain />
    </>
  );
}

/** The bar before drop B: the window waits on the stock's colour, the fingers settle, and the first drag starts in the silence. */
function Poise() {
  const b = useBeat();
  const port = useAspect() === "port";
  const d = b - 4;
  const index = swipeIndex(d, RUN_2, "toSide:rest");
  const land = springAt(b, 1, { stiffness: 220, damping: 16 });
  const first = RUN_2[0];
  const slide = 1 - 2 * clamp((d - (first.commit - first.drag)) / first.drag);
  return (
    <Paper>
      <DropStock d={d} />
      <Window id={BIG_ID} scene="swipe" index={index} cam={dropCam(d, port)} />
      <Fingers x={port ? 540 : 1640} y={(port ? 1300 : 860) + (1 - land) * 500} size={port ? 300 : 260} opacity={land} slide={slide} from={1} press={seg(b, 2.6, 0.4)} />
    </Paper>
  );
}

/** The biggest swipe, on drop B: five profiles, each named on the frame its page lands, the stock in its colour. */
function SwipeBig() {
  const b = useBeat();
  const shot = useShot();
  const port = useAspect() === "port";
  // The teaser has no poise: its run starts `lead` beats into the shot.
  const d = b - (shot.marks?.lead ?? 0);
  const index = swipeIndex(d, RUN_2, "toSide:rest");
  const bump = kick(d, 0, 0.3) * 0.03;
  const cam = dropCam(d, port);
  const first = RUN_2[0];
  const lead = shot.marks?.lead ?? 0;
  // The fingers lift on the commit frame (a fade read as a ghost box over the new page).
  const glyph = d < 0 ? (lead > 0 ? seg(b, 0, 0.15) : 1) : 0;
  const slide = 1 - 2 * clamp((d - (first.commit - first.drag)) / first.drag);
  return (
    <Paper>
      <DropStock d={d} />
      <Shake hits={RUN_2.map((e) => e.commit + lead)} amount={6}>
        <Window id={BIG_ID} scene="swipe" index={index} cam={{ ...cam, zoom: cam.zoom * (1 + bump) }} />
      </Shake>
      {glyph > 0.001 ? <Fingers x={port ? 540 : 1640} y={port ? 1300 : 860} size={port ? 300 : 260} opacity={glyph} slide={slide} from={1} /> : null}
      <Supers />
    </Paper>
  );
}

function Store() {
  const b = useBeat();
  const port = useAspect() === "port";
  const { cam, prev } = useCam([
    { at: 0, ...wideCam(port) },
    { at: 1, zoom: port ? 1.5 : 2.2, fx: 0.82, fy: 0.3, dy: 0, aim: 1, ax: 0.5, ay: 0.55, ease: "cut" },
    { at: 3, zoom: port ? 1.8 : 2.6, fx: 0.82, fy: 0.17, aim: 1, ax: 0.5, ay: 0.55, ease: "cut" },
  ]);
  const pointer = pointerAt(b, [{ at: 2, x: 0.875, y: 0.32, kind: "hand" }, { at: 3.2, x: 0.86, y: 0.2, kind: "hand", click: false }], 0.5);
  return (
    <Paper>
      <Window id={windowId()} scene="store" index={0} cam={cam} prev={prev} pointer={pointer} />
      <Shake hits={[3.5]} amount={14}>
        <Supers />
      </Shake>
    </Paper>
  );
}

function Icons() {
  const port = useAspect() === "port";
  const { cam, prev } = useCam([{ at: 0, ...REST, dy: port ? 0 : 40 }, { at: 1, zoom: port ? 1.2 : 1.7, fx: 0.62, fy: 0.885, aim: 1, ax: 0.5, ay: port ? 0.5 : 0.5, ease: "cut" }, { at: 2.5, zoom: port ? 1.45 : 2.1, fx: 0.62, fy: 0.885, aim: 1, ax: 0.5, ay: port ? 0.5 : 0.52, ease: "cut" }]);
  return (
    <Paper>
      <Window id={windowId()} scene="windows" index={frameOf("windows", "appearance")} cam={cam} prev={prev} />
      <Supers />
    </Paper>
  );
}

// Similar luminance card to card (ink, red, blue, ink): no dark/light alternation, so no flashing (fix 13).
const NO_TONES = [color.ink, color.stamp, color.tie, color.ink];

function Nos() {
  const b = useBeat();
  const k = Math.min(3, Math.floor(b));
  return (
    <Paper tone={NO_TONES[k]}>
      <Shake hits={[0, 1, 2, 3]} amount={12}>
        <Supers />
      </Shake>
    </Paper>
  );
}

// The netnyahoo.com frames were captured before the site traded its mascot for the painted logo (apps/site Hero.astro).
// They are brought up to date in place, on the page's own paper: the hero figure becomes the painting with its
// "LANDSLIDE" stamp and caption, laid out as the site lays them out at this width, and the header icon and the tab's
// favicon become the painted app icon. Everything is placed in window points (1440 × 900) and scaled to the window.
const SITE_PAPER = "rgb(240,235,229)";
function SiteLogo({ width }: { width: number }) {
  const s = width / 1440;
  const at = (x: number, y: number, w: number, h: number): CSSProperties => ({ position: "absolute", left: x * s, top: y * s, width: w * s, height: h * s });
  const label: CSSProperties = {
    fontFamily: font.mono, fontWeight: 460, fontStretch: "87.5%", letterSpacing: "0.06em", textTransform: "uppercase",
    fontSize: 11.04 * s, lineHeight: 1.5, margin: 0, whiteSpace: "nowrap",
  };
  // The site's app icon is Apple's template (an 824 px tile in 1024): sized so its tile fills the old icon's square.
  const icon = (x: number, y: number, tile: number) => {
    const box = tile / (824 / 1024);
    return <Img src={staticFile("brand/app-icon.png")} style={at(x - (box - tile) / 2, y - (box - tile) / 2, box, box)} />;
  };
  return (
    <>
      {/* The old figure and its caption, cleared (the rule between them stays: the site still draws it). */}
      <div style={{ ...at(924, 216, 476, 474), backgroundColor: SITE_PAPER }} />
      <div style={{ ...at(924, 702, 476, 40), backgroundColor: SITE_PAPER }} />
      {/* The painting: the figure's width less 2% a side, standing 14 px above the caption's rule. */}
      <Img src={staticFile("brand/mark.png")} style={{ ...at(941, 346, 443, 334), filter: `drop-shadow(0 ${18 * s}px ${22 * s}px rgba(32,63,50,0.16))` }} />
      {/* The stamp, pinned by its top-right corner to the figure's, turned -9° about it. */}
      <div
        style={{
          position: "absolute", right: (1440 - 1393) * s, top: 287 * s, transform: "rotate(-9deg)", transformOrigin: "100% 0",
          color: color.stamp, border: `${2.5 * s}px solid currentColor`, padding: 3 * s, borderRadius: 4 * s,
          mixBlendMode: "multiply", opacity: 0.9, whiteSpace: "nowrap",
        }}
      >
        <span
          style={{
            display: "block", border: `${1 * s}px solid currentColor`, padding: `${5 * s}px ${12 * s}px ${4 * s}px`, borderRadius: 2 * s,
            fontFamily: font.poster, fontWeight: 850, fontStretch: "75%", textTransform: "uppercase", letterSpacing: "0.07em",
            fontSize: 17.4 * s, lineHeight: 1.2,
          }}
        >
          Landslide
        </span>
      </div>
      <p style={{ ...label, ...at(932, 703, 300, 20), height: "auto", color: color.ink2 }}>Fig. 1 — the logo, oil on canvas</p>
      <p style={{ ...label, ...at(1093, 703, 300, 20), height: "auto", color: "#6E685F", textAlign: "right" }}>Two hills, one sun</p>
      {/* The header's icon, on the page's paper; the tab's favicon, on the selected row. */}
      <div style={{ ...at(229, 61, 32, 32), backgroundColor: SITE_PAPER }} />
      {icon(231.5, 63, 27)}
      <div style={{ ...at(14, 284, 18, 18), backgroundColor: "rgb(255,249,251)" }} />
      {icon(15.5, 285.5, 15)}
    </>
  );
}

const TYPED = ["n", "ne", "net", "netn", "netny", "netnya", "netnyah", "netnyaho", "arcadia", "arcadia.", "arcadia.c", "arcadia.co", "netnyahoo.com"];

/** netnyahoo.com typed into the address bar a key at a time, completed from history; Return; the site; a dive into its headline. */
function Typing() {
  const b = useBeat();
  const port = useAspect() === "port";
  const typed = [frameOf("typing", "focus"), ...TYPED.map((t) => frameOf("typing", `type:${t}`))];
  const index = b < 0.4 ? frameOf("typing", "before") : b < 4.2 ? playRun(b, typed, 0.4, 4.2) : b < 4.6 ? frameOf("typing", "enter") : frameOf("typing", "site");
  const dive = seg(b, 6.4, 1.6, easeIn);
  const onSite = index === frameOf("typing", "site");
  const winWidth = useStudioObject(windowId()).number("width");
  const { cam } = useCam([
    { at: 0, zoom: port ? 1.5 : 2.1, fx: 0.3, fy: 0.06, aim: 1, ax: port ? 0.45 : 0.5, ay: 0.45 },
    { at: 2.5, zoom: port ? 1.9 : 2.7, fx: 0.3, fy: 0.06, aim: 1, ax: port ? 0.45 : 0.5, ay: 0.45, ease: "cut" },
    { at: 4.6, ...(port ? wideCam(true) : { ...REST, zoom: 1 }), ease: "cut" },
  ]);
  const live: Cam = { ...cam, zoom: cam.zoom + dive * (port ? 9 : 6.5), fx: mix(cam.fx, 0.335, dive), fy: mix(cam.fy, 0.38, dive) };
  const prevDive = seg(b - 1 / BEAT, 6.4, 1.6, easeIn);
  const prev: Cam = { ...live, zoom: cam.zoom + prevDive * (port ? 9 : 6.5) };
  return (
    <Paper>
      <Window id={windowId()} scene="typing" index={index} cam={live} prev={prev} blur={dive > 0} overlay={onSite ? <SiteLogo width={winWidth} /> : null} />
    </Paper>
  );
}

// ---------------------------------------------------------------------------------------------- the end

/**
 * The app icon on the lockup. Through the breath before the button it cycles once through the seven app icons (cut
 * from the real Settings › Appearance capture: scripts/capture/icons.py), landing back on the default on the button.
 */
function AppIcon({ id, at, cycle }: { id: string; at: number; cycle?: [number, number] }) {
  const b = useBeat();
  const object = useStudioObject(id);
  const s = springAt(b, at, { stiffness: 300, damping: 15 });
  const pop = cycle ? kick(b, cycle[1], 0.2) * 0.12 : 0;
  const geometry = object.geometry({ x: "x", y: "y", width: "width", height: "height", rotation: "rotation" }, { scale: Math.max(0.001, s) * (1 + pop) });
  if (b < at) return null;
  let src = staticFile("brand/app-icon.png");
  if (cycle && b >= cycle[0] && b < cycle[1]) {
    const k = Math.floor(((b - cycle[0]) / (cycle[1] - cycle[0])) * 7);
    if (k > 0) src = staticFile(`footage/icons/${k}.png`);
  }
  // The captured icons are bare tiles; the default is Apple's template (an 824 px tile in 1024), so they are inset to
  // the same tile.
  const tile = src.includes("footage/") ? 824 / 1024 : 1;
  const inset = `${((1 - tile) / 2) * 100}%`;
  return (
    <div {...object.bind} {...geometry.bind} style={geometry.style}>
      <Img src={src} style={{ position: "absolute", left: inset, top: inset, width: `${tile * 100}%`, height: `${tile * 100}%`, objectFit: "contain" }} />
    </div>
  );
}

/** The URL underlines itself on the button, in its own colour, under the URL's box. */
function Underline({ id, at }: { id: string; at: number }) {
  const b = useBeat();
  const url = useStudioObject(id);
  const w = seg(b, at, 0.35);
  if (w <= 0) return null;
  return (
    <div
      style={{
        position: "absolute", left: url.number("x") + 4, top: url.number("y") + url.number("height") * 0.96,
        width: (url.number("width") - 8) * w, height: Math.max(8, url.number("size") * 0.06), backgroundColor: url.text("color"),
      }}
    />
  );
}

/** A hop that lands at `land` after `dur` beats in the air, `height` px at its top. */
function hopAt(b: number, land: number, dur: number, height: number) {
  const t = (b - (land - dur)) / dur;
  return t > 0 && t < 1 ? Math.sin(Math.PI * t) * height : 0;
}
/** Squash (+) and stretch (−) for the leap on the button: a crouch into it, stretched in the air, a squash on landing. */
function leapSquash(b: number, at: number, dur: number) {
  if (b < at - 0.2) return 0;
  if (b < at) return 0.9 * Math.sin((Math.PI / 2) * ((b - (at - 0.2)) / 0.2));
  if (b < at + dur) return -0.7 * Math.sin(Math.PI * ((b - at) / dur));
  return kick(b, at + dur, 0.25) * 1.1;
}

function End() {
  const b = useBeat();
  const port = useAspect() === "port";
  const shot = useShot();
  const lockup = shot.marks?.lockup ?? 4;
  const button = shot.marks?.button ?? 11;
  // The score's march taps: the three beats before the button, when the end runs three bars or more
  // (scripts/music/score.py end_marks); the teaser's two-bar end has the button alone.
  const taps = shot.beats >= 12 ? [button - 3, button - 2, button - 1] : [];
  // The hills come up on the hit and the sun rises over them through the ringing chord, floating a little.
  const rise = springAt(b, 0, { stiffness: 200, damping: 15 });
  const sun = seg(b, 0.3, 1.6, easeOut);
  const float = 0.012 * Math.sin((Math.PI * Math.max(0, b - 1.9)) / 2);
  // The sun hops on each tap, landing on its beat, then leaps on the button and settles, glowing.
  const leap = 0.6;
  const tapHop = taps.reduce((s, t) => s + hopAt(b, t, 0.45, port ? 18 : 46), 0);
  const tapLand = taps.reduce((s, t) => s + kick(b, t, 0.18), 0);
  const mark = useStudioObject(extraId("mark"));
  const sunLift = float * mark.number("height") + tapHop + hopAt(b, button + leap, leap, port ? 34 : 140);
  const burst = b >= button ? Math.exp(-(b - button) / 0.9) : 0;
  const hold = Math.max(0, b - button - leap);
  return (
    <Paper>
      <Shake hits={[0, lockup, button]} amount={14}>
        <Mark
          id={extraId("mark")}
          pose={{
            rise, sun, sunLift,
            sunSquash: 0.8 * tapLand + leapSquash(b, button, leap) + (hold > 0.6 ? 0.06 * Math.sin(hold * Math.PI) : 0),
            squash: kick(b, 0.4, 0.2) + 0.15 * tapLand + 0.35 * kick(b, button, 0.25),
            glow: 0.55 * sun + 0.9 * burst + (hold > 0 ? 0.08 * Math.sin(hold * Math.PI * 0.5) : 0),
          }}
        />
        <AppIcon id={extraId("icon")} at={lockup} cycle={[button - 3, button]} />
        <Underline id="end-url" at={button} />
        <Supers />
      </Shake>
    </Paper>
  );
}

export const SHOTS: Record<ShotKind, ComponentType> = {
  nags: Nags, title: Title, tabs: Tabs, swipe: Swipe, split: Split, block: Block, chromium: Chromium, poise: Poise,
  swipeBig: SwipeBig, store: Store, icons: Icons, nos: Nos, typing: Typing, end: End,
};
