import { Composition } from "remotion";
import { Launch } from "./Launch";
import { FPS, H, TOTAL, W } from "./timeline";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Launch" component={Launch} durationInFrames={TOTAL} fps={FPS} width={W} height={H} defaultProps={{}} />
  </>
);
