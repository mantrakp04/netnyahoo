import { Audio } from "@remotion/media";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { B, CLOCK, FPS, R1_CLICK, R2_CLICK, TOTAL } from "./timeline";
import { C, mono, poster } from "./theme";
import { PANEL, PANEL_H, Stage, frameSrc } from "./Stage";
import { Receipts } from "./Receipts";
import { EndCard } from "./EndCard";
import { Fit } from "./Fit";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const outCubic = Easing.bezier(0.22, 1, 0.36, 1);
const inOutCubic = Easing.bezier(0.65, 0, 0.35, 1);

type Head = { at: number; kicker: string; title: string; size: number; sub: string };

// Every headline, keyed to the frame it slams in on. Frame 0's has no entrance (the loop's bridge
// brings it in), so the video's first frame is already the whole hook.
const HEADS: Head[] = [
  { at: -99, kicker: "Round 1 of 3", title: "Find him.", size: 230, sub: "82 suspects. 3 seconds." },
  { at: B.r1.from + R1_CLICK, kicker: "Round 1 of 3", title: "Too easy.", size: 230, sub: "Found in 2.0 seconds. Fine." },
  { at: B.r2.from, kicker: "Round 2 of 3", title: "Now find\nhim.", size: 150, sub: "131 suspects. Some wear his tie." },
  { at: B.r2.from + R2_CLICK, kicker: "Round 2 of 3", title: "Lucky.", size: 230, sub: "Last round. Nobody gets this one." },
  { at: B.r3.from, kicker: "Round 3 of 3", title: "Only 1%\nfind him.", size: 150, sub: "503 suspects. 3 seconds. Go." },
  { at: B.timeUp.from, kicker: "Round 3 of 3", title: "Told you.", size: 230, sub: "He’s in there. Pause it. We’ll wait." },
  { at: B.twist.from + 4, kicker: "Wait.", title: "That was our\nbrowser’s\noffline page.", size: 112, sub: "Chrome gives you a dinosaur. We give you him." },
];

/** `at` pins a frame (the cover still). */
export const Launch: React.FC<{ at?: number }> = ({ at }) => {
  const current = useCurrentFrame();
  const f = at ?? current;
  const inB = (b: { from: number; to: number }) => f >= b.from && f < b.to;

  // ---- media
  let media: React.ReactNode = null;
  if (inB(B.r1)) media = <Stage page={frameSrc("r1", f - B.r1.from)} p={0} />;
  else if (inB(B.r2)) media = <Stage page={frameSrc("r2", f - B.r2.from)} p={0} />;
  else if (inB(B.r3)) media = <Stage page={frameSrc("r3", f - B.r3.from)} p={0} />;
  else if (inB(B.timeUp)) media = (
    <>
      <Stage page={frameSrc("r3", 89)} p={0} />
      <TimeUpStamp local={f - B.timeUp.from} />
    </>
  );
  else if (inB(B.twist)) {
    const l = f - B.twist.from;
    const p = interpolate(l, [4, 34], [0, 1], { ...clamp, easing: inOutCubic });
    media = <Stage page={frameSrc("r3", 89)} p={p} ring={interpolate(l, [40, 56], [0, 1], clamp)} />;
  } else if (inB(B.receipts)) media = <Receipts local={f - B.receipts.from} />;
  else if (inB(B.end)) media = <EndCard local={f - B.end.from} />;
  else if (inB(B.bridge)) {
    const l = f - B.bridge.from;
    media = (
      <>
        {l < 10 && <EndCard local={B.end.dur + l} leaving={interpolate(l, [0, 9], [0, 1], { ...clamp, easing: inOutCubic })} />}
        <Stage
          page={frameSrc("r1", 0)}
          p={interpolate(l, [4, 26], [1, 0], { ...clamp, easing: inOutCubic })}
          scale={interpolate(l, [2, 12], [0.7, 1], { ...clamp, easing: outCubic })}
          opacity={interpolate(l, [2, 8], [0, 1], clamp)}
        />
      </>
    );
  }

  // ---- headline
  const showHead = f < B.receipts.from || f >= B.bridge.from + 12;
  const head = [...HEADS].reverse().find((h) => f >= h.at) ?? HEADS[0];
  const headAt = f >= B.bridge.from ? B.bridge.from + 12 : head.at;
  const shown = f >= B.bridge.from ? HEADS[0] : head;

  // ---- the big countdown: the game's own clock, read off the captured frames' timing
  const timer = timerText(f);

  const stickerIn = f < B.twist.from + 4 ? 1 : 0;
  const stickerBridge = f >= B.bridge.from ? interpolate(f - B.bridge.from, [14, 24], [0, 1], { ...clamp, easing: outCubic }) : 1;
  const stickerOut = inB(B.twist) ? interpolate(f - B.twist.from, [0, 8], [1, 0], { ...clamp, easing: inOutCubic }) : 1;
  const stickerShow = f < B.twist.to ? Math.min(stickerOut, 1) : f >= B.bridge.from ? stickerBridge : 0;

  return (
    <AbsoluteFill style={{ backgroundColor: C.paper, overflow: "hidden" }}>
      <Audio src={staticFile("sound/track.wav")} />
      <Grain />
      {media}
      {showHead && <Headline head={shown} local={f - headAt} withSticker={stickerIn === 1 || f >= B.bridge.from} />}
      {stickerShow > 0 && <Sticker show={stickerShow} timer={timer} />}
      {f < B.twist.from ? <Progress f={f} /> : f >= B.bridge.from ? <Progress f={f} opacity={interpolate(f - B.bridge.from, [20, 26], [0, 1], clamp)} /> : null}
    </AbsoluteFill>
  );
};

function timerText(f: number): { text: string; live: boolean } {
  const t = (i: number) => Math.max(0, CLOCK - (i + 1) / FPS).toFixed(1);
  if (f >= B.bridge.from) return { text: t(0), live: true };
  if (f < B.r1.to) {
    const i = f - B.r1.from;
    return i < R1_CLICK ? { text: t(i), live: true } : { text: t(R1_CLICK - 1), live: false };
  }
  if (f < B.r2.to) {
    const i = f - B.r2.from;
    return i < R2_CLICK ? { text: t(i), live: true } : { text: t(R2_CLICK - 1), live: false };
  }
  if (f < B.r3.to) return { text: t(f - B.r3.from), live: true };
  return { text: "0.0", live: false };
}

const Headline: React.FC<{ head: Head; local: number; withSticker: boolean }> = ({ head, local, withSticker }) => {
  const s = interpolate(local, [0, 6], [1.18, 1], { ...clamp, easing: outCubic });
  const o = interpolate(local, [0, 2], [0, 1], clamp);
  const subO = interpolate(local, [3, 8], [0, 1], clamp);
  const width = withSticker ? 730 : 1000;
  return (
    <div style={{ position: "absolute", left: 40, top: 40, width }}>
      <div style={{ ...mono(30, 600), color: C.stamp, opacity: o }}>{head.kicker}</div>
      <div style={{ marginTop: 18, transformOrigin: "0% 60%", transform: `scale(${s})`, opacity: o }}>
        <Fit text={head.title} width={width} style={poster(head.size)} />
      </div>
      <div style={{ fontFamily: "Archivo Poster", fontWeight: 640, fontStretch: "87.5%", fontSize: 38, lineHeight: 1.15, color: C.inkSoft, marginTop: 22, opacity: subO }}>
        {head.sub}
      </div>
    </div>
  );
};

// Who to look for: the game's own portrait of him, and the clock.
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

const TimeUpStamp: React.FC<{ local: number }> = ({ local }) => {
  const s = interpolate(local, [0, 5], [2.2, 1], { ...clamp, easing: outCubic });
  const o = interpolate(local, [0, 3], [0, 1], clamp);
  return (
    <div
      style={{
        position: "absolute",
        left: PANEL.x + PANEL.w / 2,
        top: PANEL.y + PANEL_H * 0.3,
        transform: `translate(-50%, -50%) rotate(-9deg) scale(${s})`,
        opacity: o,
        ...poster(150),
        color: C.stamp,
        border: `10px solid ${C.stamp}`,
        borderRadius: 26,
        padding: "22px 34px 10px",
        background: "rgba(241,236,226,0.9)",
        whiteSpace: "nowrap",
      }}
    >
      Time’s up
    </div>
  );
};

const Progress: React.FC<{ f: number; opacity?: number }> = ({ f, opacity = 1 }) => {
  const round = f >= B.bridge.from || f < B.r2.from ? 1 : f < B.r3.from ? 2 : 3;
  return (
    <div style={{ position: "absolute", left: 40, right: 40, top: PANEL.y + PANEL_H + 34, display: "flex", alignItems: "center", gap: 14, opacity }}>
      {[1, 2, 3].map((r) => (
        <div
          key={r}
          style={{
            height: 14,
            flex: 1,
            borderRadius: 7,
            background: r < round ? C.ink : r === round ? C.stamp : "rgba(22,19,15,0.14)",
          }}
        />
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

export { TOTAL };
