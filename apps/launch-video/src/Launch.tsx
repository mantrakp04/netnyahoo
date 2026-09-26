import { Audio } from "@remotion/media";
import { AbsoluteFill, Easing, Img, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";
import { C, type } from "./theme";
import { at, CAMERA, CAMERA_BREAKS, CLIPS, EV, H, SUPERS, W, type Key } from "./timeline";
import { Yahu3D } from "./Yahu3D";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const out = Easing.bezier(0.22, 1, 0.36, 1);
const inOut = Easing.bezier(0.45, 0, 0.2, 1);
const ease = (f: number, a: number, b: number, e = inOut) => interpolate(f, [a, b], [0, 1], { ...clamp, easing: e });

// The window, as captured: 1440×900 pt at 2x.
const WIN = { w: 2880, h: 1800 };

export const Launch: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: C.black, overflow: "hidden" }}>
      <Audio src={staticFile("sound/track.wav")} />
      {f < at(8, 1, 30) && <Stage f={f} />}
      {f >= at(8) && f < at(9) && <Title f={f - at(8)} />}
      {f >= at(9) && <EndCard f={f - at(9)} />}
      {SUPERS.map((s) => (f >= s.from && f < s.to ? <Super key={s.text} f={f - s.from} len={s.to - s.from} text={s.text} /> : null))}
    </AbsoluteFill>
  );
};

// ---- The camera

type Pose = Omit<Key, "f">;
const CH = ["x", "y", "s", "rx", "ry"] as const;

/** Cubic Hermite through the keys (scale in log space), monotone tangents; zero at the path's ends. */
function camera(f: number): Pose {
  const starts = [0, ...CAMERA_BREAKS];
  const seg = starts.filter((b) => b <= f).at(-1)!;
  const end = starts.find((b) => b > f) ?? Infinity;
  const keys = CAMERA.filter((k) => k.f >= seg && k.f < end);
  const val = (k: Key, c: (typeof CH)[number]) => (c === "s" ? Math.log(k.s) : k[c]);
  if (f <= keys[0].f) return pose(keys[0], val);
  if (f >= keys.at(-1)!.f) return pose(keys.at(-1)!, val);
  const i = keys.findIndex((k, j) => f >= k.f && f < keys[j + 1].f);
  const [k0, k1] = [keys[i], keys[i + 1]];
  const dt = k1.f - k0.f;
  const t = (f - k0.f) / dt;
  // Monotone tangents (Fritsch-Carlson): a move never overshoots a key, so a framing that keeps something out
  // of shot stays that way.
  const tan = (j: number, c: (typeof CH)[number]) => {
    const a = keys[j - 1], k = keys[j], b = keys[j + 1];
    if (!a || !b) return 0;
    const d0 = (val(k, c) - val(a, c)) / (k.f - a.f), d1 = (val(b, c) - val(k, c)) / (b.f - k.f);
    if (d0 === 0 || d1 === 0 || Math.sign(d0) !== Math.sign(d1)) return 0;
    const w0 = 2 * (b.f - k.f) + (k.f - a.f), w1 = (b.f - k.f) + 2 * (k.f - a.f);
    return (w0 + w1) / (w0 / d0 + w1 / d1);
  };
  const h00 = 2 * t ** 3 - 3 * t ** 2 + 1, h10 = t ** 3 - 2 * t ** 2 + t, h01 = -2 * t ** 3 + 3 * t ** 2, h11 = t ** 3 - t ** 2;
  const r = {} as Pose;
  for (const c of CH) {
    const v = h00 * val(k0, c) + h10 * dt * tan(i, c) + h01 * val(k1, c) + h11 * dt * tan(i + 1, c);
    r[c] = c === "s" ? Math.exp(v) : v;
  }
  return r;
}
const pose = (k: Key, val: (k: Key, c: (typeof CH)[number]) => number): Pose => ({ x: k.x, y: k.y, s: Math.exp(val(k, "s")), rx: k.rx, ry: k.ry });

// ---- The window in space

const Stage: React.FC<{ f: number }> = ({ f }) => {
  const cam = camera(f);
  // Into black at the end of the push through the repository's page.
  const fade = 1 - ease(f, at(8, 1, 14), at(8, 1, 28));
  return (
    <AbsoluteFill style={{ perspective: 2600, perspectiveOrigin: "50% 50%", opacity: fade }}>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 42%, #1b1a1f 0%, #0b0b0d 55%, #060607 100%)" }} />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: WIN.w,
          height: WIN.h,
          transformOrigin: `${cam.x}px ${cam.y}px`,
          transform: `translate3d(${W / 2 - cam.x}px, ${H / 2 - cam.y}px, 0) rotateX(${cam.rx}deg) rotateY(${cam.ry}deg) scale(${cam.s})`,
          transformStyle: "preserve-3d",
        }}
      >
        {/* its shadow on the void */}
        <div style={{ position: "absolute", inset: 0, borderRadius: 22, boxShadow: "0 60px 140px rgba(0,0,0,0.65), 0 18px 40px rgba(0,0,0,0.5)" }} />
        {CLIPS.map((c) => (
          <Sequence key={c.src} from={c.from} durationInFrames={c.to - c.from} layout="none">
            <OffthreadVideo
              src={staticFile(c.src)}
              muted
              style={{
                position: "absolute",
                inset: 0,
                width: WIN.w,
                height: WIN.h,
                // the window's corners (20 px at 2x); a clip-path, not an image mask, so no frame waits on a load
                clipPath: "inset(0 round 20px)",
              }}
            />
          </Sequence>
        ))}
        <StoreCursor f={f} />
      </div>
    </AbsoluteFill>
  );
};

// macOS's pointing hand (HIServices' own artwork; hot spot 13, 8 of 32 pt), drawn in window px so it lives on
// the window: it comes in from below, presses the store's "Add to Netnyahoo" on the recorded frame, and leaves.
const BUTTON = { x: 2534, y: 332 };
const StoreCursor: React.FC<{ f: number }> = ({ f }) => {
  const p = EV.storePress;
  if (f < p - 26 || f > p + 16) return null;
  const k = ease(f, p - 26, p - 3, out);
  const x = interpolate(k, [0, 1], [BUTTON.x - 260, BUTTON.x]);
  const y = interpolate(k, [0, 1], [BUTTON.y + 360, BUTTON.y]);
  const press = interpolate(f, [p - 1, p + 1, p + 5], [1, 0.84, 1], clamp);
  const o = ease(f, p - 26, p - 20) * (1 - ease(f, p + 8, p + 16));
  const size = 64 * 1.5 * press;
  return (
    <Img
      src={staticFile("web/hand.png")}
      style={{ position: "absolute", left: x - (13 / 32) * size, top: y - (8 / 32) * size, width: size, height: size, opacity: o, filter: "drop-shadow(0 3px 4px rgba(0,0,0,0.45))" }}
    />
  );
};

// ---- Type

const Super: React.FC<{ f: number; len: number; text: string }> = ({ f, len, text }) => {
  const o = ease(f, 0, 8, out) * (1 - ease(f, len - 8, len));
  const y = interpolate(ease(f, 0, 14, out), [0, 1], [14, 0]);
  return (
    <>
      <AbsoluteFill style={{ background: "linear-gradient(rgba(6,6,7,0) 52%, rgba(6,6,7,0.86) 70%, rgba(6,6,7,0.94) 100%)", opacity: o }} />
      <div style={{ position: "absolute", left: 60, right: 60, top: 1000, textAlign: "center", opacity: o, transform: `translateY(${y}px)` }}>
        <div style={{ ...type(84) }}>{text}</div>
      </div>
    </>
  );
};

const Title: React.FC<{ f: number }> = ({ f }) => {
  const line = (a: number) => ({ opacity: ease(f, a, a + 10, out), transform: `translateY(${interpolate(ease(f, a, a + 16, out), [0, 1], [16, 0])}px)` });
  // The punch-in: "acquisitions" steps forward on the bar's last beat.
  const punch = ease(f, 75, 83, out);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center" }}>
      <div style={{ ...type(168, 720), ...line(25) }}>Netnyahoo.</div>
      <div style={{ ...type(84), marginTop: 26, ...line(50) }}>Full immunity.</div>
      <div style={{ ...type(46, 520), color: C.grey, letterSpacing: "-0.01em", marginTop: 26, ...line(62) }}>
        From ads, trackers and
        <span style={{ display: "inline-block", marginLeft: "0.28em", transformOrigin: "0% 60%", transform: `scale(${1 + 0.16 * punch})`, color: punch > 0 ? C.red : C.grey, fontWeight: 520 + 180 * punch }}>
          acquisitions.
        </span>
      </div>
    </AbsoluteFill>
  );
};

const EndCard: React.FC<{ f: number }> = ({ f }) => {
  const up = ease(f, 0, 40, out);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 58%, #25201c 0%, #0c0b0b 58%, #060607 100%)" }} />
      <div style={{ position: "absolute", left: 175, top: 250 + (1 - up) * 60, opacity: ease(f, 0, 10) }}>
        <Yahu3D width={730} height={836} clip="Default Dance" time={0.6 + f / 30 / 3} yaw={interpolate(f, [0, 100], [0.42, 0.14])} />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 120, textAlign: "center", opacity: ease(f, 8, 18, out) }}>
        <div style={{ ...type(118, 720), color: C.red }}>Impeach Chrome.</div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 1060, textAlign: "center", opacity: ease(f, 25, 35, out) }}>
        <div style={{ ...type(44, 600) }}>netnyahoo.com</div>
        <div style={{ ...type(28, 480), color: C.grey, marginTop: 12, letterSpacing: "0.01em" }}>Open source. Real Chromium. Free for Mac.</div>
      </div>
    </AbsoluteFill>
  );
};
