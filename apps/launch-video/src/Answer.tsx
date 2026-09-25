import { AbsoluteFill } from "remotion";
import { C, mono, poster } from "./theme";
import { CAM_GAME, Stage, frameSrc } from "./Stage";

// For a reply under the post: where he was in the video's crowd, as the game itself shows it
// when the clock runs out.
export const Answer: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: C.paper }}>
    <Stage cam={CAM_GAME} page={frameSrc("r1", 125)} />
    <div style={{ position: "absolute", left: 40, top: 40, width: 1000 }}>
      <div style={{ ...mono(30, 600), color: C.stamp }}>Where’s Big Yahu? The answer</div>
      <div style={{ ...poster(210), marginTop: 18 }}>There he is.</div>
      <div style={{ fontFamily: "Archivo Poster", fontWeight: 640, fontStretch: "87.5%", fontSize: 38, color: C.inkSoft, marginTop: 22 }}>
        Right of centre, in the middle rows.
      </div>
    </div>
  </AbsoluteFill>
);
