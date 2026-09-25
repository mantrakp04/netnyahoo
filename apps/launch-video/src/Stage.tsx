import { Img, staticFile } from "remotion";

// The real Netnyahoo window (a window capture of the offline page, 1120×860 at 2×) with the tab's
// content replaced by a captured game frame of exactly the tab's size. At p = 0 only the game
// panel shows, as a card; at p = 1 the whole window does.
export const WIN = { w: 2240, h: 1720 };
const PAGE = { x: 380, y: 93, w: 1846, h: 1612 };
// #game in the page (CSS px × 2), from public/capture/rounds.json.
const GAME = { x: PAGE.x + 32, y: PAGE.y + 268.16, w: 1782, h: 1303.84 };

export const PANEL = { x: 20, y: 452, w: 1040 };
const K0 = PANEL.w / GAME.w;
export const PANEL_H = GAME.h * K0;
const K1 = 1040 / WIN.w;
// The full window sits a little lower than the panel: the headline above it runs to three lines.
const FULL = { x: 20, y: PANEL.y + 34 };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const frameSrc = (round: string, f: number) => staticFile(`capture/${round}/${String(f).padStart(4, "0")}.jpg`);

export const Stage: React.FC<{ page: string; p: number; opacity?: number; scale?: number; ring?: number }> = ({ page, p, opacity = 1, scale = 1, ring = 0 }) => {
  const k = lerp(K0, K1, p) * scale;
  const cx = PANEL.x + PANEL.w / 2;
  const cy = PANEL.y + PANEL_H / 2;
  // Origin of the window on screen: the game rect sits on the panel at p = 0, the window fits at p = 1.
  let ox = lerp(PANEL.x - GAME.x * K0, FULL.x, p);
  let oy = lerp(PANEL.y - GAME.y * K0, FULL.y, p);
  // An extra scale (for entrances) zooms about the panel's centre.
  ox = cx + (ox - cx) * scale;
  oy = cy + (oy - cy) * scale;
  const t = lerp(GAME.y, 0, p);
  const l = lerp(GAME.x, 0, p);
  const r = lerp(WIN.w - GAME.x - GAME.w, 0, p);
  const b = lerp(WIN.h - GAME.y - GAME.h, 0, p);
  const radius = lerp(24 / K0, 22, p);
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: WIN.w,
        height: WIN.h,
        transformOrigin: "0 0",
        transform: `translate(${ox}px, ${oy}px) scale(${k})`,
        opacity,
        filter: `drop-shadow(0 ${30}px ${50}px rgba(22,19,15,0.35))`,
      }}
    >
      <div style={{ position: "absolute", inset: 0, clipPath: `inset(${t}px ${r}px ${b}px ${l}px round ${radius}px)` }}>
        <Img src={staticFile("window/window-offline.webp")} style={{ position: "absolute", left: 0, top: 0, width: WIN.w, height: WIN.h }} />
        <Img
          src={page}
          style={{
            position: "absolute",
            left: PAGE.x,
            top: PAGE.y,
            width: PAGE.w,
            height: PAGE.h,
            borderBottomLeftRadius: 16,
            borderBottomRightRadius: 16,
          }}
        />
        {ring > 0 && <Ring progress={ring} />}
      </div>
    </div>
  );
};

// A marker loop around the page's "No internet / ERR_INTERNET_DISCONNECTED" header, in window px.
const Ring: React.FC<{ progress: number }> = ({ progress }) => {
  const d = "M 1590 196 C 1600 110, 1180 96, 1000 100 C 760 104, 470 120, 452 210 C 436 300, 760 344, 1060 340 C 1360 336, 1610 300, 1592 190 C 1586 160, 1540 140, 1480 128";
  const len = 3300;
  return (
    <svg width={WIN.w} height={WIN.h} style={{ position: "absolute", left: 0, top: 0 }}>
      <path d={d} fill="none" stroke="#c3371f" strokeWidth={14} strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len * (1 - progress)} />
    </svg>
  );
};
