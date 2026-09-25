import { AbsoluteFill, Img } from "remotion";
import { C, mono, poster } from "./theme";
import { CAM_GAME, PANEL, Stage, frameSrc } from "./Stage";

// For a reply under the post: round 3's answer. The crowd exactly as the video leaves it (0.0 on the
// clock), a ring where he is, and a magnifier on him.
// His head in round 3, in page px (rounds.json: stage origin + yahuScreen, ×2).
const HEAD = { x: (17 + 229.9) * 2, y: (188.33 + 309.2) * 2 - 16 };
const K0 = PANEL.w / 1782;
const ON_SCREEN = { x: PANEL.x + (380 + HEAD.x - 412) * K0, y: PANEL.y + (93 + HEAD.y - 361.16) * K0 };
const LENS = { x: 790, y: 700, r: 170, zoom: 3.2 };

export const Answer: React.FC = () => {
  const k = K0 * LENS.zoom;
  return (
    <AbsoluteFill style={{ backgroundColor: C.paper }}>
      <Stage cam={CAM_GAME} page={frameSrc("r3", 29)} />
      <svg width={1080} height={1350} style={{ position: "absolute", inset: 0 }}>
        <line x1={ON_SCREEN.x + 30} y1={ON_SCREEN.y - 10} x2={LENS.x - LENS.r + 8} y2={LENS.y + 20} stroke={C.stamp} strokeWidth={6} />
        <circle cx={ON_SCREEN.x} cy={ON_SCREEN.y} r={34} fill="none" stroke={C.stamp} strokeWidth={7} />
      </svg>
      <div
        style={{
          position: "absolute",
          left: LENS.x - LENS.r,
          top: LENS.y - LENS.r,
          width: LENS.r * 2,
          height: LENS.r * 2,
          borderRadius: "50%",
          overflow: "hidden",
          border: `8px solid ${C.stamp}`,
          boxShadow: "0 18px 40px rgba(22,19,15,0.45)",
          background: "#000",
        }}
      >
        <Img
          src={frameSrc("r3", 29)}
          style={{ position: "absolute", width: 1846 * k, height: 1612 * k, left: LENS.r - 8 - HEAD.x * k, top: LENS.r - 8 - HEAD.y * k }}
        />
      </div>
      <div style={{ position: "absolute", left: 40, top: 40, width: 1000 }}>
        <div style={{ ...mono(30, 600), color: C.stamp }}>Round 3, answer</div>
        <div style={{ ...poster(210), marginTop: 18 }}>There he is.</div>
        <div style={{ fontFamily: "Archivo Poster", fontWeight: 640, fontStretch: "87.5%", fontSize: 38, color: C.inkSoft, marginTop: 22 }}>
          Left side, behind a donor. Naturally.
        </div>
      </div>
    </AbsoluteFill>
  );
};
