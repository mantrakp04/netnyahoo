import { Audio } from "@remotion/media";
import { AbsoluteFill, Img, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { C, mono, poster } from "./theme";
import { CUES, FPS, SHOTS, type ShotId } from "./timeline";
import { ATTACK_FILTER, clamp, Cursor, ease, FULL, Grain, Media, mix, mixRect, outCubic, Pop, Stamp, Supers, Vignette, type Rect } from "./ui";
import { Yahu3D } from "./Yahu3D";

// Captures (README, "Where the pictures come from"). Window captures are 2880×1800 (1440×900 pt at 2x);
// page captures are the page area alone, 2486×1774.
const WIN = { w: 2880, h: 1800 };
const PAGE = { w: 2486, h: 1774 };
const COOKIE = { w: 1460, h: 594 };

// The campaign half's card: the one element carried from shot to shot, under the supers.
const CARD: Rect = { x: 40, y: 486, w: 1000, h: 800 };

const inShot = (f: number, id: ShotId) => f >= SHOTS[id][0] && f < SHOTS[id][1];
const local = (f: number, id: ShotId) => f - SHOTS[id][0];
const len = (id: ShotId) => SHOTS[id][1] - SHOTS[id][0];

// Exhibit B frames the forecast page's top; at the turn the same page, clean, sits in the same place
// (its forecast card is 594 px higher without the ad above it).
const TALLY_START: Rect = { x: 560, y: 110, w: 1360, h: 1700 };
const TALLY_END: Rect = { x: 640, y: 170, w: 1240, h: 1550 };
const SINCE_END: Rect = { x: 700, y: 610, w: 940, h: 1175 };
const TURN_START: Rect = { ...SINCE_END, y: 16 };
const TURN_CARD: Rect = { x: 150, y: 250, w: 1650, h: 1320 };

const Shot: React.FC<{ id: ShotId; children: React.ReactNode }> = ({ id, children }) => (
  <Sequence from={SHOTS[id][0]} durationInFrames={len(id)} layout="none">
    {children}
  </Sequence>
);

export const Launch: React.FC = () => {
  const f = useCurrentFrame();
  const dark = f < SHOTS.turn[0] || f >= SHOTS.end[0];
  // Out of the portrait the colour drains back to the black and white of frame 0 (the loop).
  const drain = ease(f, SHOTS.end[0] - 8, SHOTS.end[0]);
  return (
    <AbsoluteFill style={{ backgroundColor: dark ? "#0b0a09" : C.paper, overflow: "hidden" }}>
      <Audio src={staticFile("sound/track.wav")} />
      <Shot id="cookie"><Cookie /></Shot>
      <Shot id="tally"><Tally /></Shot>
      <Shot id="since"><Since /></Shot>
      {f >= SHOTS.turn[0] && f < SHOTS.end[0] && (
        <AbsoluteFill style={{ backgroundColor: C.paper, filter: drain > 0 ? `grayscale(${drain}) brightness(${1 - 0.92 * drain})` : undefined }}>
          <Morning f={f} />
        </AbsoluteFill>
      )}
      <Shot id="end"><End /></Shot>
    </AbsoluteFill>
  );
};

// ---- The attack half: black and white, grain, slow push-ins, evidence.

const Exhibit: React.FC<{ label: string }> = ({ label }) => (
  <div style={{ position: "absolute", left: 44, top: 52, ...mono(28, 700), color: C.stamp, letterSpacing: "0.08em" }}>{label}</div>
);

const Cookie: React.FC = () => {
  const f = useCurrentFrame();
  // The banner's heading ("Your privacy is important to us.") fills the frame, pushing in.
  const s = mix(1.86, 2.02, ease(f, 0, 90, (x) => x));
  const head = { x: 347, y: 125 };
  const cam: Rect = { x: head.x - 540 / s, y: head.y - 610 / s, w: 1080 / s, h: 1350 / s };
  return (
    <>
      <Media src="web/cookie.webp" size={COOKIE} cam={cam} box={FULL} filter={ATTACK_FILTER} background="#0b0a09" />
      <Vignette strength={0.8} />
      <Grain opacity={0.5} dark />
      <Exhibit label="Exhibit A · a cookie banner" />
    </>
  );
};

const Tally: React.FC = () => {
  const f = useCurrentFrame();
  const abs = SHOTS.tally[0] + f;
  const { from, to, count } = CUES.tally;
  // Ticks run fast then settle on the number as the narrator says it.
  // the same curve the tally clicks use (scripts/make-sound.mjs): 1 - (1 - p)^3
  const p = interpolate(abs / FPS, [from, to], [0, 1], clamp);
  const n = Math.floor(count * (1 - Math.pow(1 - p, 3)) + 1e-6);
  // Pushing in on the page's ads (the top banner and the side unit); Since continues the move down.
  const cam = mixRect(TALLY_START, TALLY_END, ease(f, 0, len("tally"), (x) => x));
  return (
    <>
      <Media src="web/weather-ads.webp" size={PAGE} cam={cam} box={FULL} filter={ATTACK_FILTER} background="#fff" />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 700, background: "linear-gradient(rgba(11,10,9,0), rgba(11,10,9,0.92) 45%)" }} />
      <Vignette strength={0.6} />
      <Grain opacity={0.5} dark />
      <Exhibit label="Exhibit B · one weather forecast" />
      <Pop at={Math.round((from - 0.1) * FPS) - SHOTS.tally[0]} origin="0% 100%" style={{ position: "absolute", left: 40, bottom: 150 }}>
        <div style={{ ...poster(330), color: C.paper, fontVariantNumeric: "tabular-nums", lineHeight: 0.8 }}>{n}</div>
        <div style={{ ...poster(112), color: C.paper, marginTop: 14 }}>Ad companies.</div>
      </Pop>
    </>
  );
};

const Since: React.FC = () => {
  const f = useCurrentFrame();
  // The same move carries on down to the forecast itself; stamped.
  const cam = mixRect(TALLY_END, SINCE_END, ease(f, 0, len("since"), outCubic));
  return (
    <>
      <Media src="web/weather-ads.webp" size={PAGE} cam={cam} box={FULL} filter={ATTACK_FILTER} background="#fff" />
      <Vignette strength={0.6} />
      <Grain opacity={0.5} dark />
      <Stamp at={5} lines={["Same browser.", "Since 2008."]} size={124} style={{ left: 120, top: 520 }} paper="rgba(11,10,9,0.55)" />
    </>
  );
};

// ---- The campaign half: colour, the paper, one card carried from claim to claim.

type Beat = {
  id: ShotId;
  kicker: string;
  title: string;
  size: number;
  sub?: string;
  card: Rect;
  media: (l: number) => React.ReactNode;
};

const windowShot = (src: string, cams: [Rect, Rect], dur: number, box: Rect) => (l: number) => (
  <Media src={src} video size={WIN} cam={mixRect(cams[0], cams[1], ease(l, 0, dur))} box={box} mask="footage/window-mask.png" background={C.paperDeep} />
);

const BEATS: Beat[] = [
  {
    id: "addr",
    kicker: "The record",
    title: "Dissolved\nthe toolbar.",
    size: 124,
    sub: "The address bar lives in the sidebar.",
    card: CARD,
    media: (l) => windowShot("footage/addr.mp4", [{ x: 0, y: 0, w: 800, h: 640 }, { x: 10, y: 14, w: 720, h: 576 }], len("addr"), CARD)(l),
  },
  {
    id: "swipe",
    kicker: "The record",
    title: "Work and personal.\nNo conflict of interest.",
    size: 104,
    sub: "Separate tabs, cookies and history.",
    card: CARD,
    media: (l) => windowShot("footage/swipe.mp4", [{ x: 0, y: 0, w: 1300, h: 1040 }, { x: 0, y: 0, w: 1240, h: 992 }], len("swipe"), CARD)(l),
  },
  {
    id: "store",
    kicker: "The record",
    title: "Forms a coalition\nwith any extension.",
    size: 110,
    sub: "Straight from the Chrome Web Store.",
    card: CARD,
    media: (l) => <StoreShot l={l} />,
  },
  ...(["aquarium", "earth", "yahu"] as const).map(
    (id): Beat => ({
      id,
      kicker: "Real Chromium",
      title: "Chrome's engine.\nNone of its habits.",
      size: 118,
      card: CARD,
      media: (l) =>
        id === "aquarium" ? (
          // the page alone (its own fps readout sits outside the crop)
          <Media src={`footage/montage-${id}.mp4`} video size={WIN} cam={{ x: 740 + l * 2, y: 40, w: 2100 - l * 3, h: 1680 - l * 2.4 }} box={CARD} background="#000" />
        ) : (
          <Media src={`footage/montage-${id}.mp4`} video size={WIN} cam={{ x: 0 + l * 2, y: 0, w: 2250 - l * 3, h: 1800 - l * 2.4 }} box={CARD} mask="footage/window-mask.png" background={C.paperDeep} />
        ),
    }),
  ),
];

const Morning: React.FC<{ f: number }> = ({ f }) => {
  return (
    <>
      <Grain opacity={0.35} />
      <Shot id="turn"><Turn /></Shot>
      {BEATS.map((b) =>
        inShot(f, b.id) ? (
          <Sequence key={b.id} from={SHOTS[b.id][0]} durationInFrames={len(b.id)} layout="none">
            <div style={{ position: "absolute", left: b.card.x, top: b.card.y, width: b.card.w, height: b.card.h, borderRadius: 26, boxShadow: "0 30px 60px rgba(22,19,15,0.28), 0 6px 16px rgba(22,19,15,0.18)" }} />
            <div style={{ position: "absolute", inset: 0, clipPath: `inset(${b.card.y}px ${1080 - b.card.x - b.card.w}px ${1350 - b.card.y - b.card.h}px ${b.card.x}px round 26px)` }}>
              {b.media(local(f, b.id))}
            </div>
          </Sequence>
        ) : null,
      )}
      {BEATS.map((b, i) => {
        // The montage's three beats share one super.
        const prev = BEATS[i - 1];
        if (prev && prev.title === b.title) return null;
        const last = BEATS.filter((x) => x.title === b.title).at(-1)!;
        const from = SHOTS[b.id][0];
        const to = SHOTS[last.id][1];
        return f >= from - 1 && f < to ? <Supers key={b.id} from={from} to={to} kicker={b.kicker} title={b.title} size={b.size} sub={b.sub} /> : null;
      })}
      <Shot id="cleared"><Cleared /></Shot>
      <Shot id="portrait"><Portrait /></Shot>
    </>
  );
};

const Turn: React.FC = () => {
  const f = useCurrentFrame();
  // Full-bleed on the cut (the frame Exhibit B left), then the page pulls back into the card.
  const k = ease(f, 8, 34);
  const box = mixRect(FULL, CARD, k);
  const cam = mixRect(TURN_START, TURN_CARD, k);
  const drift = { ...cam, x: cam.x + ease(f, 34, len("turn"), (x) => x) * 30, w: cam.w - ease(f, 34, len("turn"), (x) => x) * 60, h: cam.h - ease(f, 34, len("turn"), (x) => x) * 48 };
  const vo = Math.round(CUES.vo.immunity * FPS) - SHOTS.turn[0];
  return (
    <>
      <Media src="web/weather-clean.webp" size={PAGE} cam={drift} box={box} radius={26 * k} background="#fff" shadow={k > 0} />
      <Supers from={30} titleAt={vo + 38} to={len("turn")} kicker="Netnyahoo for default browser" title={"Full immunity."} size={150} sub={"Immune to ads, trackers\nand prosecution."} />
    </>
  );
};

const STORE_BUTTON = { x: 2154, y: 564 };
const StoreShot: React.FC<{ l: number }> = ({ l }) => {
  const cam: Rect = { x: 1540 + l * 0.6, y: 6 + l * 0.5, w: 946 - l * 1.1, h: 757 - l * 0.88 };
  const s = CARD.w / cam.w;
  const toFrame = (p: { x: number; y: number }) => ({ x: CARD.x + (p.x - cam.x) * s, y: CARD.y + (p.y - cam.y) * s });
  // The cursor comes in from lower left, settles on the button, clicks on the recorded press, leaves.
  const press = CUES.storePress;
  const move = ease(l, 4, press - 6, outCubic);
  const target = toFrame(STORE_BUTTON);
  const start = toFrame({ x: 1600, y: 980 });
  const x = mix(start.x, target.x, move);
  const y = mix(start.y, target.y, move);
  const click = interpolate(l, [press - 1, press + 1, press + 5], [1, 0.86, 1], clamp);
  const o = ease(l, 2, 6) * (1 - ease(l, press + 16, press + 22));
  return (
    <>
      <Media src="web/store.mp4" video size={PAGE} cam={cam} box={CARD} background="#fff" />
      <Cursor x={x} y={y} scale={2.6 * click} opacity={o} />
    </>
  );
};

const Cleared: React.FC = () => {
  const f = useCurrentFrame();
  // Card becomes the court record: the shipping app's Gatekeeper verdict, then CLEARED.
  const stamp = Math.round(CUES.stamps[1] * FPS) - SHOTS.cleared[0];
  const line = (i: number) => ease(f, 4 + i * 7, 10 + i * 7, outCubic);
  const rows: [string, React.CSSProperties?][] = [
    ["$ spctl --assess -vv Netnyahoo.app", { color: C.inkSoft }],
    ["Netnyahoo.app: accepted"],
    ["source=Notarized Developer ID"],
  ];
  return (
    <>
      <div style={{ position: "absolute", left: CARD.x, top: CARD.y, width: CARD.w, height: CARD.h, borderRadius: 26, background: "#fbf8f1", boxShadow: "0 30px 60px rgba(22,19,15,0.28), 0 6px 16px rgba(22,19,15,0.18)" }}>
        <div style={{ position: "absolute", left: 64, top: 60, right: 64 }}>
          <div style={{ ...mono(24, 700), color: C.stamp, letterSpacing: "0.08em" }}>In the matter of Netnyahoo 0.2.2</div>
          <div style={{ height: 3, background: C.ink, marginTop: 22, marginBottom: 40 }} />
          {rows.map(([text, style], i) => (
            <div key={text} style={{ ...mono(i === 0 ? 27 : 36, i === 0 ? 500 : 700), textTransform: "none", letterSpacing: 0, marginBottom: 30, opacity: line(i), transform: `translateY(${(1 - line(i)) * 10}px)`, ...style }}>
              {text}
            </div>
          ))}
        </div>
        <Stamp at={stamp} lines={["Cleared"]} size={190} rotate={-8} style={{ left: 250, top: 430 }} paper="rgba(251,248,241,0.85)" />
      </div>
      <Supers from={0} to={len("cleared")} kicker="The record" title={"Investigated\nby Apple."} size={132} />
    </>
  );
};

const Portrait: React.FC = () => {
  const f = useCurrentFrame();
  // The candidate's portrait on the last chord: already rising into frame on the cut, in slow motion.
  const up = ease(f, 0, 22, outCubic);
  const vo = Math.round(CUES.vo.impeach * FPS) - SHOTS.portrait[0];
  return (
    <>
      <div style={{ position: "absolute", left: 90, top: 380 + (1 - up) * 330 }}>
        <Yahu3D width={900} height={1030} clip="Default Dance" time={1.2 + f / FPS / 2.5} yaw={0.16} />
      </div>
      <Pop at={vo - 3} origin="50% 50%" style={{ position: "absolute", left: 0, right: 0, top: 96, textAlign: "center" }}>
        <div style={{ ...mono(28, 700), color: C.stamp }}>Netnyahoo 2026</div>
        <div style={{ ...poster(178), marginTop: 18 }}>Impeach Chrome.</div>
      </Pop>
    </>
  );
};

// ---- The end card: back to black and white, like frame 0.

const End: React.FC = () => {
  const f = useCurrentFrame();
  const o = ease(f, 0, 6);
  return (
    <div style={{ position: "absolute", inset: 0, opacity: o }}>
      <Vignette strength={0.7} />
      <Grain opacity={0.5} dark />
      <div style={{ position: "absolute", left: 0, right: 0, top: 330, textAlign: "center" }}>
        <Img src={staticFile("web/app-icon.png")} style={{ width: 230, height: 230, filter: "grayscale(1) contrast(1.1)" }} />
        <div style={{ ...poster(150), color: C.paper, marginTop: 34 }}>Netnyahoo</div>
        <div style={{ ...mono(34, 600), color: C.paper, textTransform: "none", marginTop: 26 }}>Free for Mac · netnyahoo.com</div>
      </div>
      <div style={{ position: "absolute", left: 90, right: 90, top: 1010, border: `3px solid ${C.paper}`, padding: "22px 26px 18px", textAlign: "center" }}>
        <div style={{ ...mono(29, 700), color: C.paper, lineHeight: 1.45 }}>Paid for by nobody.</div>
        <div style={{ ...mono(29, 700), color: C.paper, lineHeight: 1.45 }}>Not authorized by any candidate.</div>
      </div>
    </div>
  );
};
