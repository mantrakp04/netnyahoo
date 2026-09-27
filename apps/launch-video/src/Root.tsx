import { Composition } from "remotion";
import { Launch } from "./Launch";
import { Pour } from "./pour/Pour";
import * as pour from "./pour/timeline";
import { FPS, H, TOTAL, W } from "./timeline";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Launch" component={Launch} durationInFrames={TOTAL} fps={FPS} width={W} height={H} defaultProps={{}} />
    {/* "Pour": the fragrance-ad parody (src/pour), 4:5 for X and 9:16 for phones */}
    <Composition id="Pour" component={Pour} durationInFrames={pour.TOTAL} fps={pour.FPS} width={pour.W} height={pour.H} defaultProps={{}} />
    <Composition id="PourPhone" component={Pour} durationInFrames={pour.TOTAL} fps={pour.FPS} width={1080} height={1920} defaultProps={{}} />
  </>
);
