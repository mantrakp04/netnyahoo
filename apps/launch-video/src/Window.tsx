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

// The opening poster: Netnyahoo on netnyahoo.com, recorded live (scripts/record-poster.mjs). The window is
// a ScreenCaptureKit capture; its page area plays the page's own recording, frame `f` (0-based).
const SITE_PAGE = { x: 380, y: 94, w: 2486, h: 1692 };
export const POSTER_FRAMES = 80;
export const LiveWindow: React.FC<{ push: Push; f: number; opacity?: number }> = ({ push, f, opacity = 1 }) => {
  const r = place(push);
  const k = r.w / SHOT.w;
  const src = staticFile(`poster/${String(Math.min(POSTER_FRAMES - 1, Math.max(0, f)) + 1).padStart(4, "0")}.jpg`);
  return (
    <div style={{ position: "absolute", left: r.x, top: r.y, width: r.w, height: (r.w * SHOT.h) / SHOT.w, opacity, filter: `drop-shadow(0 ${24 * push.z}px ${44 * push.z}px rgba(22,19,15,0.38))` }}>
      <Img src={staticFile("window/window-site.webp")} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      <Img
        src={src}
        style={{ position: "absolute", left: SITE_PAGE.x * k, top: SITE_PAGE.y * k, width: SITE_PAGE.w * k, height: SITE_PAGE.h * k, borderBottomLeftRadius: 16 * k, borderBottomRightRadius: 16 * k }}
      />
    </div>
  );
};
