import type { ComponentType, ReactNode } from "react";
import { AbsoluteFill, Img, random, staticFile } from "remotion";
import { useStudioObject } from "../studio-objects-v6";
import {
  type Cam, type CamKey, camAt, clamp, easeIn, easeInOut, frameCount, frameOf, kick, mix, Paper, REST, SCENES, seg, springAt,
  Supers, pointerAt, useAspect, useBeat, useShake, useShot, Window,
} from "./kit";
import { BEAT, type ShotKind } from "./plan";
import { color, swatch } from "./theme";

function useCam(keys: CamKey[]): { cam: Cam; prev: Cam } {
  const b = useBeat();
  return { cam: camAt(keys, b), prev: camAt(keys, b - 1 / BEAT) };
}

function windowId() {
  const shot = useShot();
  if (!shot.window) throw new Error(`${shot.id} has no window`);
  return shot.window.id;
}

const tab = (n: number) => frameOf("tabs", `tab:t${n}`);

/** A swipe in the footage: its drag frames, then its settle frames, then its rest frame. */
function swipeFrames(label: string) {
  const labels = SCENES.swipe.labels;
  const start = frameOf("swipe", label);
  let drag = start;
  while (labels[drag + 1] === label) drag++;
  const settle = frameOf("swipe", `${label}:settle`, start);
  const rest = frameOf("swipe", `${label}:rest`, start);
  return { start, drag, settle, rest };
}

/** Which swipe frame shows at beat `b`, for swipes that start at the given beats and commit `dur` later. */
function swipeIndex(b: number, events: { label: string; start: number; dur: number }[]) {
  let index = frameOf("swipe", "start");
  for (const e of events) {
    const f = swipeFrames(e.label);
    if (b < e.start) return index;
    const t = (b - e.start) / e.dur;
    if (t < 0.78) {
      // the drag: the capture's own eased steps, played in 78% of the move
      index = Math.round(mix(f.start, f.drag, clamp(t / 0.78)));
      return index;
    }
    if (t < 1.25) {
      index = Math.round(mix(f.settle, f.rest, clamp((t - 0.78) / 0.47)));
      return index;
    }
    index = f.rest;
  }
  return index;
}

const Shake = ({ hits, amount, children }: { hits: number[]; amount?: number; children: ReactNode }) => (
  <AbsoluteFill style={useShake(hits, amount)}>{children}</AbsoluteFill>
);

// ---------------------------------------------------------------------------------------------- the hook

function Nags() {
  const b = useBeat();
  const shot = useShot();
  const stabs = shot.type.filter((t) => t.style === "slam").map((t) => t.at);
  const piles = shot.type.filter((t) => t.style === "stamp").map((t) => t.at);
  const flash = stabs.some((s) => b >= s && b < s + 0.12);
  // The pile-up: the camera creeps in and shakes harder with every sticker.
  const push = b < 4 ? 1 : 1 + 0.07 * easeIn(clamp((b - 4) / 4));
  return (
    <Paper tone={flash ? color.paperDeep : color.paper}>
      <Shake hits={[...stabs, ...piles]} amount={b < 4 ? 18 : 10}>
        <AbsoluteFill style={{ scale: String(push) }}>
          <Supers />
        </AbsoluteFill>
      </Shake>
    </Paper>
  );
}

function Title() {
  const b = useBeat();
  const port = useAspect() === "port";
  const rise = springAt(b, 0.5, { stiffness: 170, damping: 15 });
  const keys: CamKey[] = [
    { at: 0, dy: port ? 1500 : 1100, rot: 6 },
    { at: 0.5, dy: 0, rot: 0, ease: "cut" },
    { at: 3, zoom: 1.06, ease: "inout", dur: 1 },
  ];
  const { cam, prev } = useCam(keys);
  const live = { ...cam, dy: mix(port ? 1500 : 1100, 0, rise), rot: mix(6, 0, rise) };
  const prevRise = springAt(b - 1 / BEAT, 0.5, { stiffness: 170, damping: 15 });
  const before = { ...prev, dy: mix(port ? 1500 : 1100, 0, prevRise), rot: mix(6, 0, prevRise) };
  return (
    <Paper>
      <Shake hits={[0, 2]} amount={16}>
        <Window id={windowId()} scene="tabs" index={tab(1)} cam={live} prev={before} />
        <Supers />
      </Shake>
    </Paper>
  );
}

// ---------------------------------------------------------------------------------------------- drop A

function Tabs() {
  const b = useBeat();
  const port = useAspect() === "port";
  const index = tab(1 + Math.min(5, Math.floor(b * 2)));
  const { cam, prev } = useCam([
    { at: 0, ...REST },
    { at: 0.2, zoom: port ? 1.9 : 1.45, fx: port ? 0.1 : 0.16, fy: 0.3, ease: "inout", dur: 3.6 },
  ]);
  return (
    <Paper>
      <Window id={windowId()} scene="tabs" index={index} cam={cam} prev={prev} pointer={pointerAt(b, TAB_CLICKS)} />
      <Supers />
    </Paper>
  );
}

// The sidebar's tab rows: 34 pt tall on a 37 pt pitch from y 105 (apps/browser/src/lib/theme.ts layout).
const TAB_CLICKS = [0, 1, 2, 3, 4, 5].map((i) => ({ at: i * 0.5, x: 0.07, y: (105 + 37 * i) / 900 }));

const SWIPES = [
  { label: "toWork", start: 0.3, dur: 0.7 },
  { label: "toCampaign", start: 2.3, dur: 0.7 },
  { label: "backToWork", start: 4.0, dur: 0.5 },
  { label: "backToPersonal", start: 4.5, dur: 0.5 },
];

function Swipe() {
  const b = useBeat();
  const port = useAspect() === "port";
  const index = swipeIndex(b, SWIPES);
  const { cam, prev } = useCam([
    { at: 0, zoom: port ? 3.1 : 2.15, fx: port ? 0.07 : 0.06, fy: port ? 0.28 : 0.3 },
    { at: 6, zoom: port ? 1 : 0.84, fx: 0.5, fy: 0.5, dy: port ? 0 : 70 },
  ]);
  // Each commit bumps the window, as the pager lands.
  const bump = [1, 3, 4.5, 5].reduce((s, h) => s + kick(b, h, 0.2) * 0.02, 0);
  return (
    <Paper>
      <Window id={windowId()} scene="swipe" index={index} cam={{ ...cam, zoom: cam.zoom * (1 + bump) }} prev={prev} />
      <Shake hits={[1, 3, 5]} amount={8}>
        <Supers />
      </Shake>
    </Paper>
  );
}

function Split() {
  const b = useBeat();
  const port = useAspect() === "port";
  const index = frameOf("split", b < 1 ? "one" : b < 2 ? "two" : "three");
  const base = port ? 1 : 0.84;
  const bump = kick(b, 1, 0.25) * 0.025 + kick(b, 2, 0.25) * 0.025;
  const cam: Cam = { ...REST, zoom: base * (1 + bump), dy: port ? 0 : 70 };
  return (
    <Paper>
      <Window id={windowId()} scene="split" index={index} cam={cam} />
      <Shake hits={[1, 2, 3]} amount={8}>
        <Supers />
      </Shake>
    </Paper>
  );
}

function Layout() {
  const b = useBeat();
  const port = useAspect() === "port";
  const index = frameOf("layout", b < 1 ? "toolbar" : b < 2.5 ? "sidebar" : "hidden");
  const { cam, prev } = useCam([
    { at: 0, zoom: port ? 2.6 : 1.8, fx: 0.1, fy: 0.08 },
    { at: 2.5, ...REST },
  ]);
  return (
    <Paper>
      <Window id={windowId()} scene="layout" index={index} cam={cam} prev={prev} />
      <Supers />
    </Paper>
  );
}

function Block() {
  const b = useBeat();
  const port = useAspect() === "port";
  const index = frameOf("block", b < 1 ? "page" : "controls");
  const { cam, prev } = useCam([
    { at: 0, zoom: port ? 1 : 0.84, dy: port ? 0 : 70 },
    { at: 1.4, zoom: port ? 3.2 : 2.3, fx: 0.215, fy: 0.16, dy: port ? 0 : 60 },
  ]);
  return (
    <Paper>
      <Window id={windowId()} scene="block" index={index} cam={cam} prev={prev} />
      <Supers />
    </Paper>
  );
}

const PALETTE = ["plum", "blue", "purple", "pink", "red", "orange", "yellow", "green", "neutral"] as const;

function Colors() {
  const b = useBeat();
  const k = Math.min(PALETTE.length - 1, Math.floor(b * 2));
  const out = seg(b, 3.55, 0.45, easeIn);
  const cam: Cam = { ...REST, zoom: 1 + kick(b, Math.floor(b * 2) / 2, 0.15) * 0.03, dx: out * 2400, rot: out * 28 };
  const prev: Cam = { ...cam, dx: seg(b - 1 / BEAT, 3.55, 0.45, easeIn) * 2400 };
  return (
    <Paper tone={swatch[PALETTE[k]]}>
      <Window id={windowId()} scene="colors" index={k} cam={cam} prev={prev} />
      <Supers />
    </Paper>
  );
}

// ---------------------------------------------------------------------------------------------- the break

function Chromium() {
  const b = useBeat();
  const port = useAspect() === "port";
  const whip = seg(b, 7.3, 0.7, easeIn);
  const cam: Cam = { ...REST, zoom: 1 + 0.1 * seg(b, 0, 7.3, easeInOut) + whip * 2.5, fx: 0.35, fy: 0.3, rot: mix(-2, 0, seg(b, 0, 4)) };
  const prev: Cam = { ...cam, zoom: 1 + 0.1 * seg(b - 1 / BEAT, 0, 7.3, easeInOut) + seg(b - 1 / BEAT, 7.3, 0.7, easeIn) * 2.5 };
  return (
    <Paper tone={color.night}>
      <Window id={windowId()} scene="tabs" index={tab(10)} cam={cam} prev={prev} shadow={port ? 0.6 : 1} />
      <Supers />
    </Paper>
  );
}

// ---------------------------------------------------------------------------------------------- drop B

function Store() {
  const port = useAspect() === "port";
  const { cam, prev } = useCam([
    { at: 0, zoom: port ? 1 : 0.84, dy: port ? 0 : 70 },
    { at: 1, zoom: port ? 3.2 : 2.2, fx: 0.82, fy: 0.3, dy: 0 },
    { at: 2, zoom: port ? 3.2 : 2.2, fx: 0.82, fy: 0.16 },
  ]);
  return (
    <Paper>
      <Window id={windowId()} scene="store" index={0} cam={cam} prev={prev} pointer={pointerAt(useBeat(), [{ at: 1.5, x: 0.875, y: 0.32, kind: "hand" }, { at: 2.4, x: 0.87, y: 0.2, kind: "hand", click: false }], 0.5)} />
      <Shake hits={[2.75]} amount={14}>
        <Supers />
      </Shake>
    </Paper>
  );
}

function SettingsPane({ index, keys }: { index: number; keys: CamKey[] }) {
  const { cam, prev } = useCam(keys);
  return (
    <Paper>
      <Window id={windowId()} scene="windows" index={index} cam={cam} prev={prev} />
      <Supers />
    </Paper>
  );
}

const Privacy = () => {
  const port = useAspect() === "port";
  return <SettingsPane index={frameOf("windows", "privacy")} keys={[{ at: 0, ...REST }, { at: 0.5, zoom: port ? 1.8 : 1.75, fx: 0.72, fy: 0.15 }]} />;
};
const Icons = () => {
  const port = useAspect() === "port";
  return <SettingsPane index={frameOf("windows", "appearance")} keys={[{ at: 0, ...REST, dy: port ? 0 : 40 }, { at: 0.5, zoom: port ? 1.9 : 1.8, fx: 0.66, fy: 0.9, dy: port ? 0 : -60 }]} />;
};

function Fast() {
  const b = useBeat();
  const index = Math.floor(b * 4) % frameCount("tabs");
  const { cam, prev } = useCam([{ at: 0, ...REST }, { at: 0, zoom: 1.12, fx: 0.4, fy: 0.4, ease: "inout", dur: 4 }]);
  return (
    <Paper>
      <Window id={windowId()} scene="tabs" index={index} cam={cam} prev={prev} />
      <Supers />
    </Paper>
  );
}

const SWIPES_FAST = [
  { label: "toWork", start: 0.1, dur: 0.4 },
  { label: "toCampaign", start: 1.1, dur: 0.4 },
  { label: "backToWork", start: 2.1, dur: 0.4 },
  { label: "backToPersonal", start: 3.1, dur: 0.4 },
];
const SWIPE_TONES = [swatch.plum, swatch.blue, swatch.orange, swatch.blue, swatch.plum];

function Swipe2() {
  const b = useBeat();
  const index = swipeIndex(b, SWIPES_FAST);
  const landed = SWIPES_FAST.filter((s) => b >= s.start + s.dur).length;
  const bump = SWIPES_FAST.reduce((s, e) => s + kick(b, e.start + e.dur, 0.2) * 0.03, 0);
  return (
    <Paper tone={SWIPE_TONES[landed]}>
      <Window id={windowId()} scene="swipe" index={index} cam={{ ...REST, zoom: 1 + bump }} />
      <Shake hits={SWIPES_FAST.map((s) => s.start + s.dur)} amount={10}>
        <Supers />
      </Shake>
    </Paper>
  );
}

const NO_TONES = [color.ink, color.paper, color.tie, color.stamp];

function Nos() {
  const b = useBeat();
  const k = Math.min(3, Math.floor(b));
  return (
    <Paper tone={NO_TONES[k]}>
      <Shake hits={[0, 1, 2, 3]} amount={16}>
        <Supers />
      </Shake>
    </Paper>
  );
}

// The record so far, an eighth each: every shot again, close.
const BURST: { scene: "tabs" | "split" | "store" | "block" | "colors" | "layout" | "windows" | "swipe"; index: () => number; fx: number; fy: number; zoom: number }[] = [
  { scene: "tabs", index: () => tab(3), fx: 0.6, fy: 0.3, zoom: 1.5 },
  { scene: "split", index: () => frameOf("split", "three"), fx: 0.5, fy: 0.4, zoom: 1.2 },
  { scene: "store", index: () => 0, fx: 0.4, fy: 0.3, zoom: 1.7 },
  { scene: "block", index: () => frameOf("block", "controls"), fx: 0.25, fy: 0.2, zoom: 2 },
  { scene: "colors", index: () => 5, fx: 0.1, fy: 0.3, zoom: 2.2 },
  { scene: "tabs", index: () => tab(8), fx: 0.65, fy: 0.35, zoom: 1.6 },
  { scene: "windows", index: () => frameOf("windows", "profiles"), fx: 0.6, fy: 0.5, zoom: 1.5 },
  { scene: "tabs", index: () => tab(4), fx: 0.5, fy: 0.25, zoom: 1.5 },
  { scene: "swipe", index: () => frameOf("swipe", "toCampaign:rest"), fx: 0.06, fy: 0.3, zoom: 2.4 },
  { scene: "tabs", index: () => tab(14), fx: 0.62, fy: 0.45, zoom: 1.7 },
  { scene: "layout", index: () => frameOf("layout", "hidden"), fx: 0.5, fy: 0.3, zoom: 1.3 },
  { scene: "tabs", index: () => tab(9), fx: 0.5, fy: 0.3, zoom: 1.6 },
];

function Burst() {
  const b = useBeat();
  const port = useAspect() === "port";
  if (b < 6) {
    const k = Math.min(BURST.length - 1, Math.floor(b * 2));
    const shot = BURST[k];
    const t = b * 2 - k;
    const drift = mix(1, 1.08, t);
    const cam: Cam = { ...REST, zoom: shot.zoom * drift * (port ? 1.5 : 1), fx: shot.fx, fy: shot.fy, rot: (random(`r${k}`) - 0.5) * 4 };
    return (
      <Paper tone={k % 2 ? color.paperDeep : color.paper}>
        <Window id={windowId()} scene={shot.scene} index={shot.index()} cam={cam} />
        <Supers />
      </Paper>
    );
  }
  // The window lands on netnyahoo.com, and the camera dives into its headline.
  const land = springAt(b, 6, { stiffness: 300, damping: 18 });
  const dive = seg(b, 7, 1, easeIn);
  const cam: Cam = { ...REST, zoom: mix(1.35, 1, land) + dive * (port ? 9 : 6.5), fx: 0.335, fy: 0.335, rot: mix(-4, 0, land) };
  const prevDive = seg(b - 1 / BEAT, 7, 1, easeIn);
  const prev: Cam = { ...cam, zoom: mix(1.35, 1, springAt(b - 1 / BEAT, 6, { stiffness: 300, damping: 18 })) + prevDive * (port ? 9 : 6.5) };
  return (
    <Paper>
      <Window id={windowId()} scene="site" index={0} cam={cam} prev={prev} />
    </Paper>
  );
}

// ---------------------------------------------------------------------------------------------- the end

const FAN: { label: string; rot: number; at: number }[] = [
  { label: "start", rot: -6, at: 0 },
  { label: "toWork:rest", rot: 4, at: 0.5 },
  { label: "toCampaign:rest", rot: -2, at: 1 },
];

/** One of the end card's profile windows, thrown onto the poster from off frame. */
function Thrown({ id, label, rot, at }: { id: string; label: string; rot: number; at: number }) {
  const b = useBeat();
  const port = useAspect() === "port";
  const t = springAt(b, at, { stiffness: 240, damping: 16 });
  const tp = springAt(b - 1 / BEAT, at, { stiffness: 240, damping: 16 });
  const from = port ? { dx: 0, dy: 900 } : { dx: 900, dy: 0 };
  const cam = (k: number): Cam => ({ ...REST, dx: from.dx * (1 - k), dy: from.dy * (1 - k), rot: rot + (1 - k) * 25 });
  if (b < at) return null;
  return <Window id={id} scene="swipe" index={frameOf("swipe", label)} cam={cam(t)} prev={cam(tp)} shadow={0.8} />;
}

function Immunity() {
  const shot = useShot();
  return (
    <Paper>
      <Shake hits={[0, 3]} amount={18}>
        {(shot.extra ?? []).map((w, i) => (
          <Thrown key={w.id} id={w.id} {...FAN[i]} />
        ))}
        <Supers />
      </Shake>
    </Paper>
  );
}

function Yahu({ id, at }: { id: string; at: number }) {
  const b = useBeat();
  const object = useStudioObject(id);
  const up = springAt(b, at, { stiffness: 210, damping: 13 });
  // A victory dance: a wobble on every beat after he lands.
  const dance = b > at + 0.5 ? Math.sin((b - at) * Math.PI) * 5 : 0;
  const geometry = object.geometry(
    { x: "x", y: "y", width: "width", height: "height", rotation: "rotation" },
    { offset: { y: (1 - up) * 1100, rotation: dance }, scale: 1 + 0.04 * Math.abs(Math.sin((b - at) * Math.PI)) * (b > at ? 1 : 0) },
  );
  if (b < at) return null;
  return (
    <div {...object.bind} {...geometry.bind} style={{ ...geometry.style, transformOrigin: "50% 100%" }}>
      <Img src={staticFile("brand/yahu.png")} style={{ width: "100%", height: "100%", objectFit: "contain", objectPosition: "bottom" }} />
    </div>
  );
}

function Cta() {
  const shot = useShot();
  const yahu = shot.window?.id;
  return (
    <Paper>
      <Shake hits={[0, 3]} amount={14}>
        {yahu ? <Yahu id={yahu} at={3} /> : null}
        <Supers />
      </Shake>
    </Paper>
  );
}

export const SHOTS: Record<ShotKind, ComponentType> = {
  nags: Nags, title: Title, tabs: Tabs, swipe: Swipe, split: Split, layout: Layout, block: Block, colors: Colors,
  chromium: Chromium, store: Store, privacy: Privacy, icons: Icons, fast: Fast, swipe2: Swipe2, nos: Nos, burst: Burst,
  immunity: Immunity, cta: Cta,
};
