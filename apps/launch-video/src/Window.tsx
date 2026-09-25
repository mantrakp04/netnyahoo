import { Img, staticFile } from "remotion";

// Real window captures of Netnyahoo (the site's shots, apps/site/src/assets/shots: ScreenCaptureKit,
// 1440×900 at 2×, transparent outside the window). One window sits in the frame; the camera pushes
// in on the part each line is about.
export const SHOT = { w: 2880, h: 1800 };
export const HOME = { x: 20, y: 468, w: 1040, h: 650 };
const VIEW_C = { x: 540, y: 468 + 441 };

export type Push = { fx: number; fy: number; z: number };

/** Where the shot's (fx, fy) lands at zoom z: at home at z = 1, drawn toward the view's centre as it zooms. */
export function place(p: Push) {
  const w = HOME.w * p.z;
  const h = HOME.h * p.z;
  const k = Math.min(1, Math.max(0, (p.z - 1) / 0.6));
  const px = HOME.x + p.fx * HOME.w + (VIEW_C.x - (HOME.x + p.fx * HOME.w)) * k;
  const py = HOME.y + p.fy * HOME.h + (VIEW_C.y - (HOME.y + p.fy * HOME.h)) * k;
  // Never let a zoomed window pull away from the frame's edges (no empty paper inside the view).
  const within = (v: number, a: number, b: number) => Math.min(Math.max(a, b), Math.max(Math.min(a, b), v));
  const x = p.z > 1 ? within(px - p.fx * w, HOME.x, 1080 - HOME.x - w) : px - p.fx * w;
  const y = p.z > 1 ? within(py - p.fy * h, HOME.y, 1350 - h) : py - p.fy * h;
  return { x, y, w, h };
}

export const WindowShot: React.FC<{ src: string; push: Push; opacity?: number; w?: number; h?: number }> = ({ src, push, opacity = 1, w = SHOT.w, h = SHOT.h }) => {
  const r = place(push);
  const height = (r.w * h) / w;
  return (
    <Img
      src={staticFile(src)}
      style={{
        position: "absolute",
        left: r.x,
        top: r.y,
        width: r.w,
        height,
        opacity,
        filter: `drop-shadow(0 ${24 * push.z}px ${44 * push.z}px rgba(22,19,15,0.38))`,
      }}
    />
  );
};

// A live window: a ScreenCaptureKit capture of a Netnyahoo window, its page area playing that page's own
// CDP screencast (retimed to 30 fps), frame `f` (0-based). `mode` is the address bar's place.
export type LiveMode = "sidebar" | "toolbar";
const LIVE = {
  // Address bar in the sidebar: the page runs the window's full height.
  sidebar: { window: "window/window-sidebar.webp", frames: "opener", count: 118, page: { x: 380, y: 12, w: 2486, h: 1774 } },
  // Address bar in the toolbar (a still of the same page; its page area is part of the capture).
  toolbar: { window: "window/window-toolbar.webp", frames: null, count: 0, page: { x: 380, y: 93, w: 2486, h: 1693 } },
} as const;
export const OPENER_FRAMES = LIVE.sidebar.count;
export const TOOLBAR_H = 93; // window px (2×): the toolbar row the sidebar address bar removes

export const LiveWindow: React.FC<{ mode?: LiveMode; push: Push; f?: number; opacity?: number; children?: React.ReactNode }> = ({
  mode = "sidebar",
  push,
  f = 0,
  opacity = 1,
  children,
}) => {
  const L = LIVE[mode];
  const r = place(push);
  const k = r.w / SHOT.w;
  return (
    <div style={{ position: "absolute", left: r.x, top: r.y, width: r.w, height: (r.w * SHOT.h) / SHOT.w, opacity, filter: `drop-shadow(0 ${24 * push.z}px ${44 * push.z}px rgba(22,19,15,0.38))` }}>
      <Img src={staticFile(L.window)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      {L.frames && (
        <Img
          src={staticFile(`${L.frames}/${String(Math.min(L.count - 1, Math.max(0, Math.round(f))) + 1).padStart(4, "0")}.jpg`)}
          style={{ position: "absolute", left: L.page.x * k, top: L.page.y * k, width: L.page.w * k, height: L.page.h * k, borderRadius: 16 * k }}
        />
      )}
      <div style={{ position: "absolute", inset: 0, transformOrigin: "0 0", transform: `scale(${k})`, width: SHOT.w, height: SHOT.h }}>{children}</div>
    </div>
  );
};
