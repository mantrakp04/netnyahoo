import { Audio } from "@remotion/media";
import { AbsoluteFill, Easing, Img, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Flacon } from "./Flacon";
import { Smoke } from "./Smoke";
import { caps, line, P } from "./theme";
import { at, BEAT, CAMERA, CARD, FLACON, FOCUS, FOCUS_POINT, focusClipStart, LINES, PLATES, SUPERS, WIN, WINDOW_OUT, type Key } from "./timeline";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const out = Easing.bezier(0.22, 1, 0.36, 1);
const inOut = Easing.bezier(0.45, 0, 0.2, 1);
const ease = (f: number, a: number, b: number, e = inOut) => interpolate(f, [a, b], [0, 1], { ...clamp, easing: e });

export const Pour: React.FC = () => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const windowOn = 1 - ease(f, WINDOW_OUT.from, WINDOW_OUT.to);
  return (
    <AbsoluteFill style={{ backgroundColor: P.black, overflow: "hidden" }}>
      <Audio src={staticFile("sound/pour.wav")} />
      <Smoke width={width} height={height} t={f / 30} light={f < FLACON.from ? [0.18, 0.85] : [0.5, 0.72]} glow={f < FLACON.from ? 1 : 0.8} />
      {windowOn > 0 && (
        <AbsoluteFill style={{ opacity: windowOn }}>
          <Stage f={f} />
        </AbsoluteFill>
      )}
      {f >= FLACON.from - 4 && <FlaconShot f={f} />}
      <Vignette />
      {LINES.map((l) => (f >= l.at && f < l.until ? <Subtitle key={l.id} f={f - l.at} len={l.until - l.at} text={l.text} /> : null))}
      <Supers f={f} />
      {f >= CARD && <Card f={f - CARD} />}
      <Grain f={f} />
    </AbsoluteFill>
  );
};


type Pose = Omit<Key, "f">;
const CH = ["x", "y", "s", "rx", "ry"] as const;
function spline<K extends { f: number }>(keys: K[], f: number, ch: readonly (keyof K & string)[], log: (keyof K)[] = []): Record<string, number> {
  const val = (k: K, c: keyof K) => (log.includes(c) ? Math.log(k[c] as number) : (k[c] as number));
  const outv = (c: keyof K, v: number) => (log.includes(c) ? Math.exp(v) : v);
  const r: Record<string, number> = {};
  if (f <= keys[0].f) { for (const c of ch) r[c] = keys[0][c] as number; return r; }
  if (f >= keys.at(-1)!.f) { for (const c of ch) r[c] = keys.at(-1)![c] as number; return r; }
  const i = keys.findIndex((k, j) => f >= k.f && f < keys[j + 1].f);
  const [k0, k1] = [keys[i], keys[i + 1]];
  const dt = k1.f - k0.f, t = (f - k0.f) / dt;
  const tan = (j: number, c: keyof K) => {
    const a = keys[j - 1], k = keys[j], b = keys[j + 1];
    if (!a || !b) return 0;
    const d0 = (val(k, c) - val(a, c)) / (k.f - a.f), d1 = (val(b, c) - val(k, c)) / (b.f - k.f);
    if (d0 === 0 || d1 === 0 || Math.sign(d0) !== Math.sign(d1)) return 0;
    const w0 = 2 * (b.f - k.f) + (k.f - a.f), w1 = b.f - k.f + 2 * (k.f - a.f);
    return (w0 + w1) / (w0 / d0 + w1 / d1);
  };
  const h00 = 2 * t ** 3 - 3 * t ** 2 + 1, h10 = t ** 3 - 2 * t ** 2 + t, h01 = -2 * t ** 3 + 3 * t ** 2, h11 = t ** 3 - t ** 2;
  for (const c of ch) r[c] = outv(c, h00 * val(k0, c) + h10 * dt * tan(i, c) + h01 * val(k1, c) + h11 * dt * tan(i + 1, c));
  return r;
}
const camera = (f: number) => spline(CAMERA, f, CH, ["s"]) as Pose;
const focus = (f: number) => spline(FOCUS_POINT, f, ["x", "y", "r", "dim"] as const) as { x: number; y: number; r: number; dim: number };


const Stage: React.FC<{ f: number }> = ({ f }) => {
  const { width, height } = useVideoConfig();
  const cam = camera(f);
  const fp = focus(f);
  const fx = fp.x + (width - 1080) / 2, fy = fp.y + (height - 1350) / 2;
  const deep = interpolate(fp.r, [400, 900], [1, 0.18], clamp);
  const mask = (r0: number, r1: number) =>
    `radial-gradient(ellipse ${fp.r * 1.25 * r1}px ${fp.r * r1}px at ${fx}px ${fy}px, #000 ${Math.round((r0 / r1) * 100)}%, transparent 100%)`;
  const win = <Window f={f} cam={cam} />;
  return (
    <AbsoluteFill style={{ perspective: 2600, filter: "sepia(0.16) saturate(0.86) contrast(1.05)" }}>
      <AbsoluteFill style={{ filter: `blur(${(15 * deep).toFixed(2)}px) brightness(${(1 - fp.dim * deep).toFixed(3)})` }}>{win}</AbsoluteFill>
      <AbsoluteFill style={{ filter: `blur(${(5 * deep).toFixed(2)}px) brightness(${(1 - 0.42 * fp.dim * deep).toFixed(3)})`, WebkitMaskImage: mask(0.7, 1.5), maskImage: mask(0.7, 1.5) }}>{win}</AbsoluteFill>
      <AbsoluteFill style={{ WebkitMaskImage: mask(0.55, 1), maskImage: mask(0.55, 1) }}>{win}</AbsoluteFill>
    </AbsoluteFill>
  );
};

const SWEEPS = [
  { from: -20, len: 110 },
  { from: at(3, 1, 10), len: 90 },
  { from: at(4, 2), len: 80 },
  { from: at(6, 1, 6), len: 70 },
  { from: at(7, 1), len: 90 },
];

const Window: React.FC<{ f: number; cam: Pose }> = ({ f, cam }) => {
  const { width, height } = useVideoConfig();
  const shown = PLATES.map((p, i) => {
    const next = PLATES[i + 1];
    const start = p.video ? focusClipStart() : p.from - p.fade;
    const end = next ? next.from : Infinity;
    const o = p.fade ? ease(f, p.from - p.fade, p.from, Easing.inOut(Easing.sin)) : 1;
    return { p, i, start, end, o };
  }).filter(({ start, end }) => f >= start && f < end);
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: WIN.w,
        height: WIN.h,
        transformOrigin: `${cam.x}px ${cam.y}px`,
        transform: `translate3d(${width / 2 - cam.x}px, ${height / 2 - cam.y}px, 0) rotateX(${cam.rx}deg) rotateY(${cam.ry}deg) scale(${cam.s})`,
        transformStyle: "preserve-3d",
      }}
    >
      <div style={{ position: "absolute", inset: 0, borderRadius: 22, boxShadow: "0 80px 180px rgba(0,0,0,0.7), 0 20px 50px rgba(0,0,0,0.55)" }} />
      <div style={{ position: "absolute", inset: 0, clipPath: "inset(0 round 20px)", overflow: "hidden" }}>
        {shown.map(({ p, o }) =>
          p.video ? (
            <div key={p.id} style={{ position: "absolute", inset: 0, opacity: o }}>
              <Sequence from={focusClipStart()} durationInFrames={FOCUS.rest + FOCUS.slide + 6} layout="none">
                <OffthreadVideo src={staticFile(p.src)} muted style={{ position: "absolute", inset: 0, width: WIN.w, height: WIN.h }} />
              </Sequence>
              {f >= focusClipStart() + FOCUS.rest + FOCUS.slide + 6 && <Img src={staticFile("pour/full.jpg")} style={{ position: "absolute", inset: 0, width: WIN.w, height: WIN.h }} />}
            </div>
          ) : (
            <Img key={p.id} src={staticFile(p.src)} style={{ position: "absolute", inset: 0, width: WIN.w, height: WIN.h, opacity: o }} />
          ),
        )}
        {shown.map(({ p }) => (p.dip && f >= p.from - p.fade && f < p.from + 2 ? <div key={`dip-${p.id}`} style={{ position: "absolute", inset: 0, background: P.black, opacity: Math.sin(Math.PI * ease(f, p.from - p.fade, p.from, Easing.linear)) }} /> : null))}
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 70% 60% at 18% 8%, rgba(255,226,184,0.10), transparent 70%)", mixBlendMode: "screen" }} />
        {SWEEPS.map((s) => (f >= s.from && f < s.from + s.len ? <Sweep key={s.from} k={ease(f, s.from, s.from + s.len, Easing.inOut(Easing.quad))} /> : null))}
      </div>
      <div style={{ position: "absolute", inset: 0, borderRadius: 20, boxShadow: "inset 0 0 0 2px rgba(220,196,154,0.16)" }} />
    </div>
  );
};

const Sweep: React.FC<{ k: number }> = ({ k }) => {
  const x = interpolate(k, [0, 1], [-60, 160]);
  const a = Math.sin(Math.PI * k);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        mixBlendMode: "screen",
        opacity: a,
        background: `linear-gradient(112deg, transparent ${x - 22}%, rgba(255,228,190,0.07) ${x - 9}%, rgba(255,240,220,0.22) ${x - 1.2}%, rgba(255,250,240,0.34) ${x}%, rgba(255,240,220,0.22) ${x + 1.2}%, rgba(255,228,190,0.07) ${x + 9}%, transparent ${x + 22}%)`,
      }}
    />
  );
};


const FlaconShot: React.FC<{ f: number }> = ({ f }) => {
  const { width, height } = useVideoConfig();
  const k = f - FLACON.from;
  const back = ease(f, CARD - 6, CARD + 30);
  const size = 1000;
  const top = (height - 1350) / 2 + interpolate(back, [0, 1], [-10, -120]);
  const mask = "radial-gradient(ellipse 48% 46% at 50% 52%, #000 62%, transparent 100%)";
  return (
    <div
      style={{
        position: "absolute", left: (width - size) / 2, top, width: size, height: size,
        transform: `scale(${interpolate(back, [0, 1], [1, 0.8])})`, transformOrigin: "50% 62%", WebkitMaskImage: mask, maskImage: mask,
      }}
    >
      <Flacon width={size} height={size} yaw={interpolate(k, [-4, 216], [-0.57, -0.18])} exposure={1} />
      <div style={{ position: "absolute", inset: 0, background: P.black, opacity: 1 - ease(k, -4, 22, Easing.inOut(Easing.quad)) }} />
    </div>
  );
};


const Subtitle: React.FC<{ f: number; len: number; text: string }> = ({ f, len, text }) => {
  const { height } = useVideoConfig();
  const o = ease(f, 0, 10, out) * (1 - ease(f, len - 10, len));
  return (
    <>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 420, opacity: o, background: "linear-gradient(rgba(10,8,7,0), rgba(10,8,7,0.9) 50%, rgba(10,8,7,0.94))" }} />
      <div style={{ position: "absolute", left: 80, right: 80, top: height - 205, textAlign: "center", opacity: o }}>
        <div style={{ ...line(40), textShadow: "0 1px 18px rgba(0,0,0,0.85)" }}>{text}</div>
      </div>
    </>
  );
};

const Supers: React.FC<{ f: number }> = ({ f }) => {
  const { height } = useVideoConfig();
  const mid = (height - 1350) / 2;
  return (
    <>
      {SUPERS.map((s) => {
        if (f < s.from || f >= s.to) return null;
        const o = ease(f, s.from, s.from + 14, out) * (1 - ease(f, s.to - 10, s.to));
        if ("kind" in s && s.kind === "name")
          return (
            <div key={s.text} style={{ position: "absolute", left: 0, right: 0, top: mid + 905, textAlign: "center", opacity: o }}>
              <span style={{ ...caps(54, 380, 0.5) }}>{s.text}</span>
            </div>
          );
        if ("kind" in s && s.kind === "sub")
          return (
            <div key={s.text} style={{ position: "absolute", left: 0, right: 0, top: mid + 985, textAlign: "center", opacity: o * 0.85 }}>
              <span style={{ ...caps(19, 400, 0.62) }}>{s.text}</span>
            </div>
          );
        return (
          <div key={s.text} style={{ position: "absolute", left: 0, right: 0, top: height - 132, textAlign: "center", opacity: o * 0.8 }}>
            <span style={{ ...caps(22, 420, 0.4) }}>{s.text}</span>
          </div>
        );
      })}
    </>
  );
};

const Card: React.FC<{ f: number }> = ({ f }) => {
  const { height } = useVideoConfig();
  const mid = (height - 1350) / 2;
  const up = (a: number) => ({ opacity: ease(f, a, a + 14, out), transform: `translateY(${interpolate(ease(f, a, a + 20, out), [0, 1], [10, 0])}px)` });
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 0, right: 0, top: mid + 790, textAlign: "center", ...up(4) }}>
        <span style={{ ...caps(42, 560, 0.24), color: P.red }}>Impeach Chrome.</span>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: mid + 872, textAlign: "center", ...up(BEAT) }}>
        <span style={{ ...line(40, 400) }}>netnyahoo.com</span>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: mid + 932, textAlign: "center", ...up(BEAT + 8) }}>
        <span style={{ ...line(25, 300), opacity: 0.78 }}>Open source. Real Chromium. For Mac.</span>
      </div>
    </AbsoluteFill>
  );
};


const Vignette: React.FC = () => (
  <AbsoluteFill style={{ background: "radial-gradient(ellipse 85% 75% at 50% 48%, transparent 55%, rgba(4,3,2,0.55) 100%)", pointerEvents: "none" }} />
);

const Grain: React.FC<{ f: number }> = ({ f }) => {
  const { width, height } = useVideoConfig();
  return (
    <svg width={width} height={height} style={{ position: "absolute", inset: 0, mixBlendMode: "overlay", opacity: 0.22, pointerEvents: "none" }}>
      <filter id={`g${f}`}>
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={f % 997} stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter={`url(#g${f})`} />
    </svg>
  );
};
