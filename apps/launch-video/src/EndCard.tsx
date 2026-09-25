import { Img, interpolate, staticFile, Easing } from "remotion";
import { C, mono, poster } from "./theme";
import { Yahu3D } from "./Yahu3D";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const outCubic = Easing.bezier(0.22, 1, 0.36, 1);

// Big Yahu doing the Griddy, the name, the line from the site's hero, where to get it.
export const EndCard: React.FC<{ local: number; leaving?: number }> = ({ local, leaving = 0 }) => {
  const a = (from: number) => interpolate(local, [from, from + 8], [0, 1], { ...clamp, easing: outCubic });
  const up = -leaving * 260;
  return (
    <div style={{ position: "absolute", inset: 0, opacity: 1 - leaving, transform: `translateY(${up}px)` }}>
      <div style={{ position: "absolute", left: 0, top: 250, width: 1080, height: 900, opacity: a(0), transform: `translateY(${(1 - a(0)) * 60}px)` }}>
        <Yahu3D width={1080} height={900} clip="Griddy" time={Math.max(0, local) / 30} yaw={0.18} />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 58, textAlign: "center" }}>
        <div style={{ ...poster(196), transform: `scale(${1.2 - 0.2 * a(2)})`, opacity: a(2) }}>Netnyahoo</div>
        <div
          style={{
            fontFamily: "Archivo Poster",
            fontWeight: 700,
            fontStretch: "87.5%",
            fontSize: 50,
            color: C.ink,
            marginTop: 20,
            opacity: a(8),
          }}
        >
          The browser that won’t leave office.
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 70,
          top: 1010,
          ...poster(84),
          color: C.stamp,
          border: `7px solid ${C.stamp}`,
          borderRadius: 16,
          padding: "12px 18px 4px",
          transform: `rotate(-7deg) scale(${interpolate(local, [18, 23], [1.8, 1], { ...clamp, easing: outCubic })})`,
          opacity: interpolate(local, [18, 20], [0, 1], clamp),
        }}
      >
        Incumbent
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 64, textAlign: "center", opacity: a(14) }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 18 }}>
          <Img src={staticFile("game/app-icon.png")} style={{ width: 64, height: 64 }} />
          <div style={{ ...mono(30, 700) }}>Free · macOS · Apple Silicon</div>
        </div>
        <div style={{ ...mono(28, 500), textTransform: "none", marginTop: 16, color: C.inkSoft }}>github.com/mantrakp04/netnyahoo</div>
      </div>
    </div>
  );
};
