import { Img, staticFile } from "remotion";

// The one space the video lives in: the real Netnyahoo window (a window capture of the offline
// page for x.com, 1120×860 at 2×) with the tab's content replaced by a captured game frame of
// exactly the tab's size. A camera (scale + offset, window px → frame px) looks at it through a
// mask that is either just the game (the rounds) or the whole window.
export const WIN = { w: 2240, h: 1720 };
export const PAGE = { x: 380, y: 93, w: 1846, h: 1612 };
// #game and #stage in the page (CSS px × 2, from public/capture/rounds.json), in window px.
export const GAME = { x: PAGE.x + 32, y: PAGE.y + 268.16, w: 1782, h: 1303.84 };
export const STAGE = { x: PAGE.x + 34, y: PAGE.y + 376.66, w: 1778, h: 1193.34 };

export type Cam = { s: number; x: number; y: number; mask: number };

// The rounds: the game panel, 1040 wide, under the headline.
export const PANEL = { x: 20, y: 452, w: 1040 };
export const CAM_GAME: Cam = { s: PANEL.w / GAME.w, x: PANEL.x - GAME.x * (PANEL.w / GAME.w), y: PANEL.y - GAME.y * (PANEL.w / GAME.w), mask: 0 };
export const PANEL_H = GAME.h * CAM_GAME.s;
// The whole window, 1040 wide.
export const CAM_WINDOW: Cam = { s: 1040 / WIN.w, x: 20, y: 468, mask: 1 };
// Its top-left: traffic lights, sidebar, address bar and the "No internet" header, readable.
export const CAM_HEADER: Cam = { s: 0.78, x: 20, y: 440, mask: 1 };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const mixCam = (a: Cam, b: Cam, t: number): Cam => ({
  s: lerp(a.s, b.s, t),
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  mask: lerp(a.mask, b.mask, t),
});
/** A window-px point on screen. */
export const toFrame = (c: Cam, wx: number, wy: number) => ({ x: c.x + wx * c.s, y: c.y + wy * c.s });

export const frameSrc = (round: string, f: number) => staticFile(`capture/${round}/${String(f).padStart(4, "0")}.jpg`);

export const Stage: React.FC<{ cam: Cam; page: string; nextPage?: string; mix?: number; children?: React.ReactNode }> = ({
  cam,
  page,
  nextPage,
  mix = 0,
  children,
}) => {
  const m = cam.mask;
  const t = lerp(GAME.y, 0, m);
  const l = lerp(GAME.x, 0, m);
  const r = lerp(WIN.w - GAME.x - GAME.w, 0, m);
  const b = lerp(WIN.h - GAME.y - GAME.h, 0, m);
  const radius = lerp(24 / CAM_GAME.s, 22, m);
  const pageStyle: React.CSSProperties = {
    position: "absolute",
    left: PAGE.x,
    top: PAGE.y,
    width: PAGE.w,
    height: PAGE.h,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  };
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: WIN.w,
        height: WIN.h,
        transformOrigin: "0 0",
        transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.s})`,
        filter: `drop-shadow(0 ${30 / cam.s}px ${50 / cam.s}px rgba(22,19,15,0.35))`,
      }}
    >
      <div style={{ position: "absolute", inset: 0, clipPath: `inset(${t}px ${r}px ${b}px ${l}px round ${radius}px)` }}>
        <Img src={staticFile("window/window-offline.webp")} style={{ position: "absolute", left: 0, top: 0, width: WIN.w, height: WIN.h }} />
        <Img src={page} style={pageStyle} />
        {nextPage && mix > 0 && <Img src={nextPage} style={{ ...pageStyle, opacity: mix }} />}
        {children}
      </div>
    </div>
  );
};
