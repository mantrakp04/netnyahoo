// A cut of the launch film: its shots on the beat grid, the score under them, inside the Studio document.
import { Audio } from "@remotion/media";
import type { ComponentProps } from "react";
import { AbsoluteFill, Sequence, staticFile } from "remotion";
import { StudioObjects } from "../studio-objects-v6";
import { ShotProvider } from "./kit";
import { CUTS, type CutName, f } from "./plan";
import { SHOTS } from "./shots";
import { color, loadFonts } from "./theme";

loadFonts();

type Doc = ComponentProps<typeof StudioObjects>["document"];

export function Film({ cut, document }: { cut: CutName; document: Doc }) {
  const { shots } = CUTS[cut];
  return (
    <StudioObjects document={document}>
      <AbsoluteFill style={{ backgroundColor: color.paper }}>
        {shots.map((shot) => {
          const Shot = SHOTS[shot.kind];
          return (
            <Sequence key={shot.id} from={f(shot.at)} durationInFrames={f(shot.beats)} name={shot.id}>
              <ShotProvider value={shot}>
                <Shot />
              </ShotProvider>
            </Sequence>
          );
        })}
        <Audio src={staticFile(`music/${cut}.wav`)} />
      </AbsoluteFill>
    </StudioObjects>
  );
}

export const meta = (cut: CutName, width: number, height: number) => ({
  durationInFrames: f(CUTS[cut].beats),
  fps: 30,
  width,
  height,
});
