import { Img, interpolate, staticFile, Easing } from "remotion";
import { C, mono, poster } from "./theme";
import { PANEL, PANEL_H } from "./Stage";
import { Fit } from "./Fit";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const outCubic = Easing.bezier(0.22, 1, 0.36, 1);
export const RECEIPT_LEN = 37;

// Real captures of Netnyahoo (the site's shots, apps/site/src/assets/shots): each line of copy
// sits on the window that proves it, pushed in on the part that matters.
type Shot = { src: string; w: number; h: number; from: [number, number, number]; to: [number, number, number] };
const ITEMS: { title: string; sub: string; shot: Shot }[] = [
  {
    title: "Real\nChromium 154.",
    sub: "Not WebKit. Not Electron. Tabs down the side.",
    // focus x, focus y (fractions of the image), zoom (1 = the shot fits the panel's width)
    shot: { src: "shots/browse.webp", w: 2880, h: 1800, from: [0.5, 0.5, 1.02], to: [0.34, 0.3, 1.45] },
  },
  {
    title: "Every Chrome\nextension.",
    sub: "From the Chrome Web Store. It says “Add to Netnyahoo”.",
    shot: { src: "shots/extensions.webp", w: 2880, h: 1800, from: [0.5, 0.4, 1.1], to: [0.62, 0.34, 1.45] },
  },
  {
    title: "uBlock Origin\nLite, built in.",
    sub: "Ads, trackers and cookie banners: blocked.",
    shot: { src: "shots/privacy.webp", w: 1640, h: 1280, from: [0.55, 0.4, 1.2], to: [0.55, 0.3, 1.5] },
  },
  {
    title: "AI features:\nzero.",
    sub: "On purpose. Search just searches.",
    shot: { src: "shots/command-bar.webp", w: 2880, h: 1800, from: [0.55, 0.2, 1.3], to: [0.52, 0.12, 1.75] },
  },
];

export const Receipts: React.FC<{ local: number }> = ({ local }) => {
  const i = Math.min(ITEMS.length - 1, Math.floor(local / RECEIPT_LEN));
  const l = local - i * RECEIPT_LEN;
  const item = ITEMS[i];
  const s = interpolate(l, [0, 6], [1.18, 1], { ...clamp, easing: outCubic });
  const o = interpolate(l, [0, 2], [0, 1], clamp);
  return (
    <>
      <ShotView shot={item.shot} l={l} />
      <div style={{ position: "absolute", left: 40, top: 40, width: 1000 }}>
        <div style={{ ...mono(30, 600), color: C.stamp }}>Also, it’s a real browser</div>
        <div style={{ marginTop: 18, transformOrigin: "0% 60%", transform: `scale(${s})`, opacity: o }}>
          <Fit text={item.title} width={1000} style={poster(150)} />
        </div>
        <div
          style={{
            fontFamily: "Archivo Poster",
            fontWeight: 640,
            fontStretch: "87.5%",
            fontSize: 38,
            lineHeight: 1.15,
            color: C.inkSoft,
            marginTop: 22,
            opacity: interpolate(l, [3, 8], [0, 1], clamp),
          }}
        >
          {item.sub}
        </div>
      </div>
      <Checks done={i + (l > 4 ? 1 : 0)} />
    </>
  );
};

const ShotView: React.FC<{ shot: Shot; l: number }> = ({ shot, l }) => {
  const t = interpolate(l, [0, RECEIPT_LEN], [0, 1], { ...clamp, easing: Easing.bezier(0.3, 0.1, 0.3, 1) });
  const fx = shot.from[0] + (shot.to[0] - shot.from[0]) * t;
  const fy = shot.from[1] + (shot.to[1] - shot.from[1]) * t;
  const z = shot.from[2] + (shot.to[2] - shot.from[2]) * t;
  const k = (PANEL.w / shot.w) * z;
  const w = shot.w * k;
  const h = shot.h * k;
  // Keep the focus point in the panel's centre, but never show past the image's edges.
  const x = Math.min(0, Math.max(PANEL.w - w, PANEL.w / 2 - fx * w));
  const y = Math.min(0, Math.max(PANEL_H - h, PANEL_H / 2 - fy * h));
  const enter = interpolate(l, [0, 5], [0.94, 1], { ...clamp, easing: outCubic });
  return (
    <div
      style={{
        position: "absolute",
        left: PANEL.x,
        top: PANEL.y,
        width: PANEL.w,
        height: PANEL_H,
        borderRadius: 24,
        overflow: "hidden",
        background: "#1a1614",
        boxShadow: "0 30px 50px rgba(22,19,15,0.35)",
        transform: `scale(${enter})`,
      }}
    >
      <Img src={staticFile(shot.src)} style={{ position: "absolute", left: x, top: y, width: w, height: h }} />
    </div>
  );
};

const Checks: React.FC<{ done: number }> = ({ done }) => (
  <div style={{ position: "absolute", left: 40, right: 40, top: PANEL.y + PANEL_H + 34, display: "flex", gap: 14 }}>
    {[0, 1, 2, 3].map((j) => (
      <div key={j} style={{ height: 14, flex: 1, borderRadius: 7, background: j < done ? C.ink : "rgba(22,19,15,0.14)" }} />
    ))}
  </div>
);
