import { Audio } from "@remotion/media";
import { Video } from "@remotion/media";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { B, FPS, PLEDGE_LEN, R1_CLOCK } from "./timeline";
import { C, mono, poster } from "./theme";
import { CAM_GAME, CAM_HEADER, CAM_WINDOW, STAGE, Stage, frameSrc, mixCam, type Cam } from "./Stage";
import { LiveWindow, OPENER_FRAMES, TOOLBAR_H, WindowShot, place, type Push } from "./Window";
import { Yahu3D } from "./Yahu3D";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const outCubic = Easing.bezier(0.22, 1, 0.36, 1);
const inOutCubic = Easing.bezier(0.65, 0, 0.35, 1);
const ease = (f: number, a: number, b: number, e = inOutCubic) => interpolate(f, [a, b], [0, 1], { ...clamp, easing: e });
const lerpPush = (a: Push, b: Push, t: number): Push => ({ fx: a.fx + (b.fx - a.fx) * t, fy: a.fy + (b.fy - a.fy) * t, z: a.z + (b.z - a.z) * t });

// A campaign ad for a browser. One narrator; every line is about what the window is showing.
// Type sizes are fixed per line (no measuring), so no frame can lay out differently from the next.
type Line = { kicker: string; title: string; size: number; sub?: string };
const OPENER: Line = { kicker: "Netnyahoo for default browser", title: "Full immunity.", size: 164, sub: "Immune to ads, trackers and prosecution." };
const TOOLBAR: Line = {
  kicker: "Pledge 1 · kept",
  title: "Dissolves\nthe toolbar.",
  size: 140,
  sub: "The address bar moves into the sidebar.\nThe page gets the whole window.",
};

// `clip`: a real recording the user can drop into clips/<clip>.mp4 (see README, "Shot list"); when it
// exists it plays in the window's place instead of the still.
type Pledge = Line & { shot: string; from: Push; to: Push; panel?: { w: number; h: number }; clip: string };
const PLEDGES: Pledge[] = [
  {
    clip: "split",
    kicker: "Pledge 2 · kept",
    title: "Two pages.\nNo coalition talks.",
    size: 116,
    sub: "Split view, in one window.",
    shot: "shots/split.webp",
    from: { fx: 0.5, fy: 0.5, z: 1 },
    to: { fx: 0.58, fy: 0.3, z: 1.3 },
  },
  {
    clip: "extensions",
    kicker: "Pledge 3 · kept",
    title: "Forms a coalition\nwith any extension.",
    size: 114,
    sub: "The Chrome Web Store says “Add to Netnyahoo”.",
    shot: "shots/extensions.webp",
    from: { fx: 0.5, fy: 0.4, z: 1 },
    to: { fx: 0.9, fy: 0.365, z: 1.8 },
  },
  {
    clip: "ublock",
    kicker: "Pledge 4 · kept",
    title: "Tracks nothing.",
    size: 140,
    sub: "Unusual, for a man in his position.",
    shot: "shots/privacy.webp",
    panel: { w: 1640, h: 1280 },
    from: { fx: 0.5, fy: 0.3, z: 1 },
    to: { fx: 0.62, fy: 0.3, z: 1.25 },
  },
  {
    clip: "command-bar",
    kicker: "Pledge 5 · kept",
    title: "AI features: zero.",
    size: 124,
    sub: "On purpose. Search just searches.",
    shot: "shots/command-bar.webp",
    from: { fx: 0.5, fy: 0.3, z: 1 },
    to: { fx: 0.55, fy: 0.1, z: 1.55 },
  },
];
const OFFLINE: Line = { kicker: "And when the Wi-Fi dies", title: "Chrome gives you\na dinosaur.", size: 128 };
const FIND: Line = { kicker: "Netnyahoo gives you him", title: "Find him.", size: 196, sub: "82 suspects. 3 seconds." };
const CTA: Line = { kicker: "Netnyahoo 2026", title: "Impeach Chrome.", size: 148, sub: "Make Netnyahoo your default." };

const FIND_FRAMES = 54;
const OPENER_PUSH = (l: number): Push => ({ fx: 0.5, fy: 0.5, z: 1 + 0.035 * Math.min(1, l / B.opener.dur) });
// The toolbar pledge frames the window's top-left, where the address bar moves, then pulls back.
const TOP_PUSH: Push = { fx: 0, fy: 0, z: 1.9 };
const FULL_PUSH: Push = { fx: 0.5, fy: 0.5, z: 1 }; // round 1's clock runs 3.0 → 1.2 while you look; then he comes up anyway

export const Launch: React.FC<{ at?: number; clips?: string[] }> = ({ at, clips = [] }) => {
  const current = useCurrentFrame();
  const f = at ?? current;
  const inB = (b: { from: number; to: number }) => f >= b.from && f < b.to;

  let media: React.ReactNode = null;
  let line: Line = OPENER;
  let lineAt = -99; // the frame the line slams in (frame 0's line is already settled)
  let stamp = 1; // INCUMBENT, on the window's corner
  let smallPrint = 1;
  let sticker = 0;

  if (inB(B.opener)) {
    const l = f - B.opener.from;
    media = <LiveWindow f={l} push={OPENER_PUSH(l)} />;
    stamp = 1 - ease(l, B.opener.dur - 6, B.opener.dur);
    smallPrint = 1 - ease(l, B.opener.dur - 6, B.opener.dur);
  } else if (inB(B.toolbar)) {
    const l = f - B.toolbar.from;
    const into = ease(l, 0, 10); // opener framing → the window's top
    const fold = ease(l, 32, 40); // the toolbar folds away
    const live = B.opener.dur + l; // the page keeps moving in the "after" window
    const out = ease(l, 58, 80); // back to the whole window: the page runs top to bottom
    const push = lerpPush(lerpPush(OPENER_PUSH(B.opener.dur), TOP_PUSH, into), FULL_PUSH, out);
    media = (
      <>
        <LiveWindow mode="toolbar" push={push} opacity={1}>
          {/* The toolbar, outlined, then folding up to nothing */}
          <div
            style={{
              position: "absolute",
              left: 380,
              top: 0,
              width: 2500,
              height: TOOLBAR_H * (1 - fold),
              border: `10px solid ${C.stamp}`,
              borderRadius: 18,
              opacity: ease(l, 10, 16) * (1 - ease(l, 36, 40)),
              background: `rgba(195,55,31,${0.18 * fold})`,
            }}
          />
        </LiveWindow>
        {fold > 0 && <LiveWindow f={Math.min(live, OPENER_FRAMES - 1)} push={push} opacity={fold} />}
      </>
    );
    line = TOOLBAR;
    lineAt = B.toolbar.from;
    stamp = 0;
    smallPrint = 0;
  } else if (inB(B.pledges)) {
    const l = f - B.pledges.from;
    const i = Math.floor(l / PLEDGE_LEN);
    const k = l - i * PLEDGE_LEN;
    const p = PLEDGES[i];
    const prev = i > 0 ? PLEDGES[i - 1] : null;
    const push = lerpPush(p.from, p.to, ease(k, 2, PLEDGE_LEN, Easing.bezier(0.33, 0, 0.2, 1)));
    const fadeIn = ease(k, 0, 5);
    media = (
      <>
        {prev && fadeIn < 1 && <WindowShot src={prev.shot} push={prev.to} w={prev.panel?.w} h={prev.panel?.h} />}
        {i === 0 && fadeIn < 1 && <LiveWindow f={Math.min(B.opener.dur + B.toolbar.dur, OPENER_FRAMES - 1)} push={FULL_PUSH} />}
        {clips.includes(p.clip) ? <ClipView id={p.clip} opacity={fadeIn} /> : <WindowShot src={p.shot} push={push} w={p.panel?.w} h={p.panel?.h} opacity={fadeIn} />}
      </>
    );
    line = p;
    lineAt = B.pledges.from + i * PLEDGE_LEN;
    stamp = 0;
    smallPrint = 0;
  } else if (inB(B.offline)) {
    const l = f - B.offline.from;
    const last = PLEDGES[PLEDGES.length - 1];
    const cam = mixCam(CAM_WINDOW, CAM_HEADER, ease(l, 12, 34));
    media = (
      <>
        {l < 8 && <WindowShot src={last.shot} push={last.to} opacity={1 - ease(l, 0, 8)} />}
        <div style={{ opacity: ease(l, 0, 8) }}>
          <Stage cam={cam} page={frameSrc("r1", 0)} />
        </div>
      </>
    );
    line = OFFLINE;
    lineAt = B.offline.from + 2;
    stamp = 0;
    smallPrint = 0;
  } else if (inB(B.find)) {
    const l = f - B.find.from;
    media = <Stage cam={mixCam(CAM_HEADER, CAM_GAME, ease(l, 0, 14))} page={frameSrc("r1", Math.min(l, FIND_FRAMES - 1))} />;
    line = FIND;
    lineAt = B.find.from;
    stamp = 0;
    smallPrint = 0;
    sticker = ease(l, 4, 14, outCubic);
  } else if (inB(B.cta)) {
    const l = f - B.cta.from;
    const up = interpolate(l, [0, 12], [0, 1], { ...clamp, easing: Easing.bezier(0.34, 1.56, 0.64, 1) });
    media = (
      <Stage cam={CAM_GAME} page={frameSrc("r1", FIND_FRAMES - 1)}>
        <YahuInCrowd up={up} t={l / FPS} />
      </Stage>
    );
    line = CTA;
    lineAt = B.cta.from + 8;
    stamp = ease(l, 26, 27);
    smallPrint = ease(l, 34, 42);
    sticker = 1 - ease(l, 0, 8);
  } else if (inB(B.bridge)) {
    const l = f - B.bridge.from;
    const up = 1 - ease(l, 0, 7, Easing.bezier(0.5, 0, 0.75, 0));
    const cam: Cam = mixCam(CAM_GAME, CAM_WINDOW, ease(l, 2, 18));
    const swap = ease(l, 12, 22);
    media = (
      <>
        <div style={{ opacity: 1 - swap }}>
          <Stage cam={cam} page={frameSrc("r1", FIND_FRAMES - 1)}>
            {up > 0 && <YahuInCrowd up={up} t={(B.cta.dur + l) / FPS} />}
          </Stage>
        </div>
        {swap > 0 && <LiveWindow f={0} push={OPENER_PUSH(0)} opacity={swap} />}
      </>
    );
    line = l < 8 ? CTA : OPENER;
    lineAt = l < 8 ? B.cta.from + 8 : B.bridge.from + 8;
  }

  const local = f - lineAt;
  const lineOut = inB(B.bridge) && f < B.bridge.from + 8 ? 1 - ease(f - B.bridge.from, 2, 7) : 1;
  const stampSlam = inB(B.cta) ? f - B.cta.from - 26 : 99;

  return (
    <AbsoluteFill style={{ backgroundColor: C.paper, overflow: "hidden" }}>
      <Audio src={staticFile("sound/track.wav")} />
      <Grain />
      {media}
      <Headline line={line} local={local} opacity={lineOut} />
      {sticker > 0 && <Sticker show={sticker} timer={findTimer(f)} />}
      {stamp > 0 && <Stamp opacity={stamp} slam={stampSlam} />}
      {smallPrint > 0 && <SmallPrint opacity={smallPrint} />}
    </AbsoluteFill>
  );
};

// A user-recorded window clip (16:10), in the window's home place.
const ClipView: React.FC<{ id: string; opacity: number }> = ({ id, opacity }) => {
  const r = place({ fx: 0.5, fy: 0.5, z: 1 });
  return (
    <div style={{ position: "absolute", left: r.x, top: r.y, width: r.w, height: r.h, borderRadius: 16, overflow: "hidden", opacity, boxShadow: "0 24px 44px rgba(22,19,15,0.38)" }}>
      <Video src={staticFile(`clips/${id}.mp4`)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </div>
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

function findTimer(f: number): { text: string; live: boolean } {
  const i = Math.min(Math.max(0, f - B.find.from), FIND_FRAMES - 1);
  return { text: Math.max(0, R1_CLOCK - (i + 1) / FPS).toFixed(1), live: f < B.find.to };
}

const Headline: React.FC<{ line: Line; local: number; opacity: number }> = ({ line, local, opacity }) => {
  const s = interpolate(local, [0, 6], [1.15, 1], { ...clamp, easing: outCubic });
  const o = interpolate(local, [0, 2], [0, 1], clamp) * opacity;
  const subO = interpolate(local, [3, 8], [0, 1], clamp) * opacity;
  return (
    <div style={{ position: "absolute", left: 40, top: 40 }}>
      <div style={{ ...mono(30, 600), color: C.stamp, opacity: o }}>{line.kicker}</div>
      <div style={{ ...poster(line.size), marginTop: 16, transformOrigin: "0% 60%", transform: `scale(${s})`, opacity: o, whiteSpace: "pre" }}>{line.title}</div>
      {line.sub && (
        <div
          style={{
            fontFamily: "Archivo Poster",
            fontWeight: 640,
            fontStretch: "87.5%",
            fontSize: 38,
            lineHeight: 1.15,
            color: C.inkSoft,
            marginTop: 20,
            opacity: subO,
            whiteSpace: "pre",
          }}
        >
          {line.sub}
        </div>
      )}
    </div>
  );
};

// The INCUMBENT stamp, over the window's top-right corner.
const Stamp: React.FC<{ opacity: number; slam: number }> = ({ opacity, slam }) => {
  const s = interpolate(slam, [0, 5], [2.1, 1], { ...clamp, easing: outCubic });
  return (
    <div
      style={{
        position: "absolute",
        right: 36,
        top: 428,
        transform: `rotate(-7deg) scale(${s})`,
        opacity,
        ...poster(92),
        color: C.stamp,
        border: `8px solid ${C.stamp}`,
        borderRadius: 16,
        padding: "14px 20px 4px",
        background: "rgba(241,236,226,0.92)",
        boxShadow: "0 10px 24px rgba(22,19,15,0.25)",
      }}
    >
      Incumbent
    </div>
  );
};

// Where to get it, and the campaign disclaimer.
const SmallPrint: React.FC<{ opacity: number }> = ({ opacity }) => (
  <div style={{ position: "absolute", left: 40, right: 40, bottom: 34, opacity, textAlign: "center" }}>
    <div style={{ ...mono(26, 700), textTransform: "none" }}>Free for Mac · netnyahoo.com</div>
    <div style={{ ...mono(17, 500), color: C.inkSoft, marginTop: 12 }}>Paid for by nobody. Not authorized by any candidate.</div>
  </div>
);

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
