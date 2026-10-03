import type { ComponentType, ReactNode } from "react";
import { AbsoluteFill, Img, interpolateColors, random, staticFile } from "remotion";
import { useStudioObject } from "../studio-objects-v6";
import {
  type Cam, type CamKey, camAt, clamp, easeIn, easeInOut, Fingers, frameOf, kick, mix, Paper, pointerAt, REST, SCENES,
  seg, springAt, Supers, useAspect, useBeat, useShake, useShot, Window,
} from "./kit";
import { BEAT, CUTS, type ShotKind } from "./plan";
import { color, font, swatch } from "./theme";
import { type Clip, type Framing, Yahu3D } from "./Yahu3D";

/** A window shown whole: in portrait, centred under the type (inside the safe zone, y 220–1480). */
const wideCam = (port: boolean, bump = 0): Cam =>
  port ? { ...REST, zoom: 0.62 * (1 + bump), fx: 0.5, fy: 0.5, aim: 1, ax: 0.5, ay: 0.56 } : { ...REST, zoom: 0.86 * (1 + bump), fx: 0.5, dy: 60 };

// Big Yahu's poses, as times in his "Default Dance" clip (seconds): hands steepled at the chest (his opening and
// resting pose), arms swept out (the swat), both arms up (the flex).
const POSE = { steeple: 2.2, swept: 1.8, flex: 2.6 };

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
 * Which swipe frame shows at beat `b`. Each swipe drags for `drag` beats and commits on its beat: the first settle
 * frame (where the page changes) lands exactly on `commit`, so a label switched on that beat switches with the page.
 */
function swipeIndex(b: number, events: { label: string; commit: number; drag: number }[], before = "start") {
  let index = frameOf("swipe", before);
  for (const e of events) {
    const drag = framesOf("swipe", e.label);
    const settle = framesOf("swipe", `${e.label}:settle`);
    const rest = frameOf("swipe", `${e.label}:rest`);
    if (b < e.commit - e.drag) return index;
    if (b < e.commit) return drag[Math.min(drag.length - 1, Math.floor(((b - (e.commit - e.drag)) / e.drag) * drag.length))];
    if (b < e.commit + 0.45) return settle[Math.min(settle.length - 1, Math.floor(((b - e.commit) / 0.45) * settle.length))];
    index = rest;
  }
  return index;
}

const Shake = ({ hits, amount, children }: { hits: number[]; amount?: number; children: ReactNode }) => (
  <AbsoluteFill style={useShake(hits, amount)}>{children}</AbsoluteFill>
);

const SEC = BEAT / 30; // seconds in a beat

// ---------------------------------------------------------------------------------------------- Big Yahu

/**
 * Big Yahu in his Studio box, rendered from his rig at a time of one clip. `rise` (0–1) brings him up from below the
 * frame; `squash` (a decaying kick) squashes and stretches him on a landing.
 */
function Yahu({ id, clip, time, rise = 1, squash = 0, yaw = 0, framing = "full" }: { id: string; clip: Clip; time: number; rise?: number; squash?: number; yaw?: number; framing?: Framing }) {
  const object = useStudioObject(id);
  const h = object.number("height");
  const geometry = object.geometry(
    { x: "x", y: "y", width: "width", height: "height", rotation: "rotation" },
    { offset: { y: (1 - rise) * h * 1.1 } },
  );
  if (rise <= 0.001) return null;
  return (
    <div {...object.bind} {...geometry.bind} style={geometry.style}>
      <div style={{ width: "100%", height: "100%", transformOrigin: "50% 100%", transform: `scale(${1 + squash * 0.12}, ${1 - squash * 0.12})` }}>
        <Yahu3D width={Math.round(object.number("width"))} height={Math.round(h)} clip={clip} time={Math.max(0, time)} yaw={yaw} framing={framing} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- the hook

// Each stab cuts to a site really asking it, in a Netnyahoo window (scenes/asks.js), framed on the ask.
const ASKS: { label: string; cam: Cam }[] = [
  { label: "ask:signin", cam: { ...REST, zoom: 1.25, fx: 0.62, fy: 0.42, aim: 1, ax: 0.5, ay: 0.62 } },
  { label: "ask:ai", cam: { ...REST, zoom: 1.3, fx: 0.42, fy: 0.3, aim: 1, ax: 0.5, ay: 0.6, rot: -1 } },
  { label: "ask:cookies", cam: { ...REST, zoom: 1.35, fx: 0.62, fy: 0.84, aim: 1, ax: 0.5, ay: 0.66, rot: 1 } },
  { label: "ask:upgrade", cam: { ...REST, zoom: 1.3, fx: 0.62, fy: 0.42, aim: 1, ax: 0.5, ay: 0.62 } },
];

/** A real browser, asked for everything: four stabs over four sites asking, then the asks stamped on the snare roll. */
function Nags() {
  const b = useBeat();
  const shot = useShot();
  const stabs = shot.type.filter((t) => t.style === "slam").map((t) => t.at);
  const piles = shot.type.filter((t) => t.style === "stamp").map((t) => t.at);
  const knock = piles.reduce((s, h) => s + kick(b, h, 0.2) * 0.6, 0);
  const k = Math.min(3, Math.floor(b));
  const ask = ASKS[k];
  // Each ask pops in on its stab: the window lands from slightly small, as a sheet would.
  const pop = b < 4 ? 0.94 + 0.06 * springAt(b, k, { stiffness: 420, damping: 20 }) : 1;
  const cam: Cam = b < 4 ? { ...ask.cam, zoom: ask.cam.zoom * pop } : { ...REST, zoom: 1 + 0.015 * knock };
  // Big Yahu rises behind the pile, hands steepled; on the last eighth he sweeps his arms out (the swat lands on the drop).
  const rise = springAt(b, 7.1, { stiffness: 200, damping: 16 });
  const swing = seg(b, 7.72, 0.28, easeIn);
  return (
    <Paper>
      <Shake hits={[...stabs, ...piles]} amount={10}>
        <Window id={windowId()} scene="asks" index={frameOf("asks", ask.label)} cam={cam} />
        <Yahu id={extraId("yahu")} clip="Default Dance" time={mix(POSE.steeple, 1.85, swing)} rise={rise} yaw={-0.25} />
        <Supers />
      </Shake>
    </Paper>
  );
}

const NAG_PILE = ["nag-pile-1", "nag-pile-2", "nag-pile-3", "nag-pile-4"];

/** One of the hook's stamps, swatted off the window on the drop: thrown outward, spinning, falling. */
function Swatted({ id, k }: { id: string; k: number }) {
  const b = useBeat();
  const t = Math.max(0, b * SEC); // seconds since the drop
  const object = useStudioObject(id);
  // Swept off to the left, away from him: he stands on the right of the frame.
  const vx = -(1100 + random(`vx${id}`) * 1100) * (0.7 + 0.15 * k);
  const vy = -500 - random(`vy${id}`) * 700;
  const geometry = object.geometry(
    { x: "x", y: "y", width: "width", height: "height", rotation: "rotation" },
    { offset: { x: vx * t, y: vy * t + 2600 * t * t, rotation: (k % 2 ? 1 : -1) * 540 * t } },
  );
  if (t > 1.2) return null;
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

/** The swat finishing (arms out), back to steepled, then both arms up as he stamps on beat 2. */
function titlePose(b: number) {
  if (b < 0.3) return mix(1.85, POSE.swept, seg(b, 0, 0.3));
  if (b < 1.6) return mix(POSE.swept, POSE.steeple, seg(b, 0.3, 1.1, easeInOut));
  return mix(POSE.steeple, POSE.flex, seg(b, 1.6, 0.4, easeIn));
}

function Title() {
  const b = useBeat();
  const shot = useShot();
  // The window carries on from the hook, dropping to its title place as the name slams in.
  const settle = springAt(b, 0, { stiffness: 260, damping: 18 });
  const cam: Cam = { ...REST, dy: mix(-120, 0, settle), zoom: 1 + 0.02 * kick(b, 0, 0.3) + 0.03 * seg(b, 3, 1, easeInOut) };
  // Big Yahu: on from the hook, slams the stamp on 2, ducks out at the end of the shot.
  const out = seg(b, shot.beats - 0.7, 0.7, easeIn);
  return (
    <Paper>
      <Shake hits={[0, 2]} amount={14}>
        <Window id={windowId()} scene="tabs" index={tab(1)} cam={cam} />
        {NAG_PILE.map((id, k) => (
          <Swatted key={id} id={id} k={k} />
        ))}
        <Yahu id={extraId("yahu")} clip="Default Dance" time={titlePose(b)} rise={1 - out} squash={kick(b, 2, 0.2)} yaw={-0.25} />
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
  const glyph = b < first.commit + 0.6 ? seg(b, 0, 0.12) * (1 - seg(b, first.commit + 0.2, 0.4)) : 0;
  return (
    <Paper>
      <Window id={windowId()} scene="swipe" index={index} cam={{ ...cam, zoom: cam.zoom * (1 + bump) }} />
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
  const yahuOn = springAt(b, 5, { stiffness: 230, damping: 14 }) * (1 - seg(b, 7.4, 0.6, easeIn));
  return (
    <Paper>
      <Window id={windowId()} scene="split" index={index} cam={cam} pointer={pointer} />
      <Yahu id={extraId("yahu")} clip="Default Dance" time={mix(POSE.steeple, POSE.flex, seg(b, 5.2, 0.5))} rise={yahuOn} squash={kick(b, 5.3, 0.2)} yaw={-0.35} framing="bust" />
      <Shake hits={[0, 5]} amount={8}>
        <Supers />
      </Shake>
    </Paper>
  );
}

function Block() {
  const b = useBeat();
  const port = useAspect() === "port";
  const off = framesOf("block", "off");
  const on = framesOf("block", "on");
  const index = b < 1 ? frameOf("block", "page") : b < 2 ? frameOf("block", "controls") : b < 2.5 ? playRun(b, off, 2, 2.5) : b < 5.5 ? playRun(b, on, 2.5, 5.5) : frameOf("block", "onRest");
  const { cam, prev } = useCam([
    { at: 0, ...(port ? wideCam(true) : { ...REST, zoom: 1 }) },
    { at: 1, zoom: port ? 1.7 : 2.4, fx: 0.86, fy: 0.22, aim: 1, ax: port ? 0.5 : 0.62, ay: port ? 0.5 : 0.5, ease: "cut" },
    { at: 2.5, zoom: port ? 2.4 : 3.4, fx: 0.86, fy: 0.27, aim: 1, ax: port ? 0.5 : 0.62, ay: 0.5, ease: "cut" },
    { at: 4.5, ...(port ? wideCam(true) : { ...REST, zoom: 1 }), ease: "cut" },
  ]);
  const toggle = { x: 0.898, y: 0.262 };
  const clicks = [
    { at: 2, x: toggle.x, y: toggle.y, kind: "hand" as const },
    { at: 2.5, x: toggle.x, y: toggle.y, kind: "hand" as const },
    { at: 4.5, x: toggle.x - 0.06, y: toggle.y + 0.05, kind: "hand" as const, click: false },
  ];
  return (
    <Paper>
      <Window id={windowId()} scene="block" index={index} cam={cam} prev={prev} pointer={pointerAt(b, clicks, 0.4)} />
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
  { label: "toWeekend", commit: 0, drag: 0.7, dir: -1 },
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
  const whole: Cam = port ? { ...REST, zoom: 0.62, fx: 0.5, fy: 0.5, aim: 1, ax: 0.5, ay: 0.56 } : { ...REST, zoom: 0.8, dy: 40 };
  const macro: Cam = { ...REST, zoom: port ? 1.15 : 1.9, fx: 0.12, fy: 0.2, aim: 1, ax: port ? 0.42 : 0.32, ay: port ? 0.46 : 0.42 };
  const out = seg(d, 7.4, 1.2, easeInOut);
  let cam: Cam = d < 2.6 ? whole : d < 7.4 ? macro : { ...whole, zoom: mix(macro.zoom, whole.zoom, out), fx: mix(0.12, 0.5, out), fy: mix(0.2, 0.5, out), aim: mix(1, whole.aim, out) };
  if (d < 0) {
    // The poise: a slow push onto the sidebar's header, the stock colour all round.
    const push = seg(d, -4, 3.2, easeInOut);
    cam = port
      ? { ...whole, zoom: mix(0.62, 0.8, push), fx: mix(0.5, 0.25, push), fy: mix(0.5, 0.3, push) }
      : { ...whole, zoom: mix(0.8, 0.95, push), fx: mix(0.5, 0.2, push), fy: mix(0.5, 0.25, push) };
  }
  // The shove: the drag pulls the window a little, the commit throws it on, then it settles.
  const W = port ? 1080 : 1920;
  let dx = 0;
  for (const e of RUN_2) {
    const p = clamp((d - (e.commit - e.drag)) / e.drag);
    if (d >= e.commit - e.drag && d < e.commit) dx += e.dir * 0.03 * W * easeIn(p);
    if (d >= e.commit) dx += e.dir * 0.03 * W * Math.exp(-(d - e.commit) / 0.12) * Math.cos((d - e.commit) * 10);
  }
  return { ...cam, dx: cam.dx + dx };
}

function dropTone(d: number) {
  const landed = RUN_2.filter((e) => d >= e.commit).length;
  if (landed === 0) return RUN_2_TONES[0];
  const last = RUN_2[landed - 1].commit;
  return interpolateColors(clamp((d - last) / (4 / BEAT)), [0, 1], [RUN_2_TONES[landed - 1], RUN_2_TONES[landed]]);
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
    <Paper tone={dropTone(d)}>
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
  const glyph = lead > 0 ? seg(b, 0, 0.15) * (1 - seg(d, 0.2, 0.4)) : 1 - seg(d, 0, 0.3);
  const slide = 1 - 2 * clamp((d - (first.commit - first.drag)) / first.drag);
  return (
    <Paper tone={dropTone(d)}>
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

const TYPED = ["n", "ne", "net", "netn", "netny", "netnya", "netnyah", "netnyaho", "netnyahoo", "netnyahoo.", "netnyahoo.c", "netnyahoo.co", "netnyahoo.com"];

/** netnyahoo.com typed into the address bar a key at a time, completed from history; Return; the site; a dive into its headline. */
function Typing() {
  const b = useBeat();
  const port = useAspect() === "port";
  const typed = [frameOf("typing", "focus"), ...TYPED.map((t) => frameOf("typing", `type:${t}`))];
  const index = b < 0.4 ? frameOf("typing", "before") : b < 4.2 ? playRun(b, typed, 0.4, 4.2) : b < 4.6 ? frameOf("typing", "enter") : frameOf("typing", "site");
  const dive = seg(b, 6.4, 1.6, easeIn);
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
      <Window id={windowId()} scene="typing" index={index} cam={live} prev={prev} blur={dive > 0} />
    </Paper>
  );
}

// ---------------------------------------------------------------------------------------------- the end

function AppIcon({ id, at }: { id: string; at: number }) {
  const b = useBeat();
  const object = useStudioObject(id);
  const s = springAt(b, at, { stiffness: 300, damping: 15 });
  const geometry = object.geometry({ x: "x", y: "y", width: "width", height: "height", rotation: "rotation" }, { scale: Math.max(0.001, s) });
  if (b < at) return null;
  return (
    <div {...object.bind} {...geometry.bind} style={geometry.style}>
      <Img src={staticFile("brand/app-icon.png")} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
    </div>
  );
}

function End() {
  const b = useBeat();
  const shot = useShot();
  const lockup = shot.marks?.lockup ?? 4;
  const button = shot.marks?.button ?? 11;
  // The griddy until the beat before the button; then his flex lands on the button and holds.
  const flexFrom = button - 1;
  const clip: Clip = b < flexFrom ? "Griddy" : "Default Dance";
  const time = b < flexFrom ? (b * SEC) % 6.1 : Math.min(2.67, 2.2 + (b - flexFrom) * SEC);
  const rise = springAt(b, 0, { stiffness: 200, damping: 15 });
  return (
    <Paper>
      <Shake hits={[0, lockup, button]} amount={14}>
        <Yahu id={extraId("yahu")} clip={clip} time={time} rise={rise} squash={kick(b, button, 0.22) + kick(b, 0.4, 0.2)} yaw={0.3} />
        <AppIcon id={extraId("icon")} at={lockup} />
        <Supers />
      </Shake>
    </Paper>
  );
}

export const SHOTS: Record<ShotKind, ComponentType> = {
  nags: Nags, title: Title, tabs: Tabs, swipe: Swipe, split: Split, block: Block, chromium: Chromium, poise: Poise,
  swipeBig: SwipeBig, store: Store, icons: Icons, nos: Nos, typing: Typing, end: End,
};
