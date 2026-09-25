import { Audio } from "@remotion/media";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { B, FPS, ROUNDS, TWIST } from "./timeline";
import { C, mono, poster } from "./theme";
import { CAM_GAME, CAM_HEADER, CAM_WINDOW, PANEL, PANEL_H, STAGE, Stage, frameSrc, mixCam, type Cam } from "./Stage";
import { Fit } from "./Fit";
import { Yahu3D } from "./Yahu3D";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const outCubic = Easing.bezier(0.22, 1, 0.36, 1);
const inOutCubic = Easing.bezier(0.65, 0, 0.35, 1);
const ease = (f: number, [a, b]: readonly [number, number], e = inOutCubic) => interpolate(f, [a, b], [0, 1], { ...clamp, easing: e });

// One voice: the game's host, talking to the viewer. Every line is true of what's on screen.
type Line = { at: number; kicker: string; title: string; size: number; sub?: string; sticker: boolean };
const LINES: Line[] = [
  { at: B.r1.from, kicker: "Round 1 of 3", title: "Find him.", size: 230, sub: "82 suspects. You have 3 seconds.", sticker: true },
  { at: B.r1.from + ROUNDS.r1.search, kicker: "Time’s up", title: "There he is.", size: 230, sub: "Remember the face.", sticker: true },
  { at: B.r2.from, kicker: "Round 2 of 3", title: "Harder.", size: 230, sub: "131 suspects. 2 seconds. Some wear his tie.", sticker: true },
  { at: B.r2.from + ROUNDS.r2.search, kicker: "Time’s up", title: "There he is.", size: 230, sub: "One round left.", sticker: true },
  { at: B.r3.from, kicker: "Round 3 of 3", title: "One second.", size: 230, sub: "503 suspects. Find him.", sticker: true },
  { at: B.r3.from + ROUNDS.r3.search, kicker: "Time’s up", title: "He’s in there.", size: 230, sub: "Pause it. We’ll wait.", sticker: true },
  { at: B.twist.from + 4, kicker: "No internet?", title: "Chrome gives you\na dinosaur.", size: 150, sticker: false },
  { at: B.twist.from + TWIST.line2, kicker: "No internet?", title: "Netnyahoo\ngives you him.", size: 150, sticker: false },
  { at: B.end.from, kicker: "Netnyahoo", title: "A real Chromium\nbrowser.", size: 150, sub: "Free for Mac · github.com/mantrakp04/netnyahoo", sticker: false },
];
// The bridge brings round 1's line back in; the video's frame 0 already has it settled.
const BRIDGE_LINE = B.bridge.from + 6;

export const Launch: React.FC<{ at?: number }> = ({ at }) => {
  const current = useCurrentFrame();
  const f = at ?? current;
  const inB = (b: { from: number; to: number }) => f >= b.from && f < b.to;

  // ---- camera, tab content and Big Yahu
  let cam: Cam = CAM_GAME;
  let page = frameSrc("r1", 0);
  let nextPage: string | undefined;
  let mix = 0;
  let yahu = 0; // 0 hidden in the crowd, 1 up
  if (inB(B.r1)) page = frameSrc("r1", f - B.r1.from);
  else if (inB(B.r2)) page = frameSrc("r2", f - B.r2.from);
  else if (inB(B.r3)) page = frameSrc("r3", Math.min(f - B.r3.from, ROUNDS.r3.search - 1));
  else if (inB(B.twist)) {
    const l = f - B.twist.from;
    page = frameSrc("r3", ROUNDS.r3.search - 1);
    cam = l < TWIST.hold ? mixCam(CAM_GAME, CAM_WINDOW, ease(l, TWIST.out)) : mixCam(CAM_WINDOW, CAM_HEADER, ease(l, TWIST.in));
    yahu = interpolate(l, [TWIST.line2 + 2, TWIST.line2 + 14], [0, 1], { ...clamp, easing: Easing.bezier(0.34, 1.56, 0.64, 1) });
  } else if (inB(B.end)) {
    const l = f - B.end.from;
    page = frameSrc("r3", ROUNDS.r3.search - 1);
    cam = mixCam(CAM_HEADER, { ...CAM_HEADER, s: CAM_HEADER.s * 1.03, x: CAM_HEADER.x - 8, y: CAM_HEADER.y - 10 }, l / B.end.dur);
    yahu = 1;
  } else if (inB(B.bridge)) {
    const l = f - B.bridge.from;
    const drift = { ...CAM_HEADER, s: CAM_HEADER.s * 1.03, x: CAM_HEADER.x - 8, y: CAM_HEADER.y - 10 };
    cam = mixCam(drift, CAM_GAME, ease(l, [3, 24]));
    page = frameSrc("r3", ROUNDS.r3.search - 1);
    nextPage = frameSrc("r1", 0);
    mix = ease(l, [4, 12]);
    yahu = 1 - ease(l, [0, 7], Easing.bezier(0.5, 0, 0.75, 0));
  }
  const danceT = Math.max(0, f - (B.twist.from + TWIST.line2)) / FPS;

  // ---- the host's line
  const line = f >= B.bridge.from ? (f >= BRIDGE_LINE ? LINES[0] : LINES[LINES.length - 1]) : [...LINES].reverse().find((h) => f >= h.at)!;
  const lineAt = f >= BRIDGE_LINE ? BRIDGE_LINE : line.at;
  // Round 1's first line is already settled on frame 0 (the loop lands on it).
  const lineLocal = line === LINES[0] && f < B.r2.from ? 99 : f - lineAt;
  const lineOut = inB(B.bridge) && f < BRIDGE_LINE ? 1 - ease(f - B.bridge.from, [0, 5]) : 1;

  // ---- the portrait card and clock: on for the rounds, off for the window
  let sticker = 1;
  if (inB(B.twist)) sticker = 1 - ease(f - B.twist.from, [0, 8]);
  else if (inB(B.end)) sticker = 0;
  else if (inB(B.bridge)) sticker = ease(f - B.bridge.from, [12, 22], outCubic);

  const progress = f < B.twist.from ? 1 : inB(B.twist) ? 1 - ease(f - B.twist.from, [0, 6]) : inB(B.bridge) ? ease(f - B.bridge.from, [18, 24]) : 0;

  return (
    <AbsoluteFill style={{ backgroundColor: C.paper, overflow: "hidden" }}>
      <Audio src={staticFile("sound/track.wav")} />
      <Grain />
      <Stage cam={cam} page={page} nextPage={nextPage} mix={mix}>
        {yahu > 0 && <YahuInCrowd up={yahu} t={danceT} />}
      </Stage>
      <Headline line={line} local={lineLocal} opacity={lineOut} width={line.sticker ? 730 : 1000} />
      {sticker > 0 && <Sticker show={sticker} timer={timerText(f)} />}
      {progress > 0 && <Progress f={f} opacity={progress} />}
    </AbsoluteFill>
  );
};

// Big Yahu comes up out of the crowd, inside the tab (clipped to the game's stage), doing the Griddy.
const YAHU = { x: 338, y: 470, w: 1000, h: 1150 };
const YahuInCrowd: React.FC<{ up: number; t: number }> = ({ up, t }) => (
  <div style={{ position: "absolute", left: STAGE.x, top: STAGE.y, width: STAGE.w, height: STAGE.h, overflow: "hidden" }}>
    <div style={{ position: "absolute", left: YAHU.x - STAGE.x, top: YAHU.y - STAGE.y + (1 - up) * 1100 }}>
      <Yahu3D width={YAHU.w} height={YAHU.h} clip="Griddy" time={t} yaw={0.18} />
    </div>
  </div>
);

function timerText(f: number): { text: string; live: boolean } {
  const read = (clock: number, i: number) => Math.max(0, clock - (i + 1) / FPS).toFixed(1);
  for (const id of ["r1", "r2", "r3"] as const) {
    const b = B[id];
    const r = ROUNDS[id];
    if (f >= b.from && f < b.to) {
      const i = f - b.from;
      return i < r.search ? { text: read(r.clock, i), live: true } : { text: "0.0", live: false };
    }
  }
  if (f >= B.bridge.from) return { text: read(ROUNDS.r1.clock, 0), live: true };
  return { text: "0.0", live: false };
}

const Headline: React.FC<{ line: Line; local: number; opacity: number; width: number }> = ({ line, local, opacity, width }) => {
  const s = interpolate(local, [0, 6], [1.18, 1], { ...clamp, easing: outCubic });
  const o = interpolate(local, [0, 2], [0, 1], clamp) * opacity;
  const subO = interpolate(local, [3, 8], [0, 1], clamp) * opacity;
  return (
    <div style={{ position: "absolute", left: 40, top: 40, width }}>
      <div style={{ ...mono(30, 600), color: C.stamp, opacity: o }}>{line.kicker}</div>
      <div style={{ marginTop: 18, transformOrigin: "0% 60%", transform: `scale(${s})`, opacity: o }}>
        <Fit text={line.title} width={width} style={poster(line.size)} />
      </div>
      {line.sub && (
        <div style={{ fontFamily: "Archivo Poster", fontWeight: 640, fontStretch: "87.5%", fontSize: 38, lineHeight: 1.15, color: C.inkSoft, marginTop: 22, opacity: subO }}>
          {line.sub}
        </div>
      )}
    </div>
  );
};

// Who to look for (the game's own portrait of him) and the round's clock.
const Sticker: React.FC<{ show: number; timer: { text: string; live: boolean } }> = ({ show, timer }) => (
  <div
    style={{
      position: "absolute",
      right: 34,
      top: 38,
      width: 236,
      transform: `translateX(${(1 - show) * 320}px) rotate(${4 - (1 - show) * 10}deg)`,
      opacity: show,
    }}
  >
    <div style={{ background: "#fffdf8", border: `3px solid ${C.ink}`, borderRadius: 18, padding: "14px 14px 12px", boxShadow: "0 10px 24px rgba(22,19,15,0.18)" }}>
      <div style={{ background: C.paperDeep, borderRadius: 10, overflow: "hidden", height: 196, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
        <Img src={staticFile("game/wanted.webp")} style={{ width: 196, height: 198 }} />
      </div>
      <div style={{ ...mono(22, 700), marginTop: 10, textAlign: "center" }}>Big Yahu</div>
    </div>
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom: -66,
        background: timer.live ? C.stamp : C.ink,
        color: "#fff",
        ...mono(46, 700),
        fontVariantNumeric: "tabular-nums",
        padding: "8px 16px 6px",
        borderRadius: 12,
        transform: "translateX(-50%) rotate(-5deg)",
        whiteSpace: "nowrap",
        boxShadow: "0 8px 18px rgba(22,19,15,0.25)",
      }}
    >
      <span style={{ color: "#fff" }}>{timer.text}</span>
      <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 28 }}>s</span>
    </div>
  </div>
);

const Progress: React.FC<{ f: number; opacity: number }> = ({ f, opacity }) => {
  const round = f >= B.bridge.from || f < B.r2.from ? 1 : f < B.r3.from ? 2 : 3;
  return (
    <div style={{ position: "absolute", left: 40, right: 40, top: PANEL.y + PANEL_H + 34, display: "flex", alignItems: "center", gap: 14, opacity }}>
      {[1, 2, 3].map((r) => (
        <div key={r} style={{ height: 14, flex: 1, borderRadius: 7, background: r < round ? C.ink : r === round ? C.stamp : "rgba(22,19,15,0.14)" }} />
      ))}
    </div>
  );
};

// A little paper tooth so the flat background doesn't band in the encode.
const Grain: React.FC = () => (
  <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, opacity: 0.35, mixBlendMode: "multiply" }}>
    <filter id="grain">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
      <feColorMatrix values="0 0 0 0 0.45  0 0 0 0 0.4  0 0 0 0 0.33  0 0 0 0.18 0" />
    </filter>
    <rect width="100%" height="100%" filter="url(#grain)" />
  </svg>
);
