import { Composition, Still } from "remotion";
import { Launch } from "./Launch";
import { Cover } from "./Cover";
import { Answer } from "./Answer";
import { FPS, H, TOTAL, W } from "./timeline";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Launch" component={Launch} durationInFrames={TOTAL} fps={FPS} width={W} height={H} />
    <Still id="Cover" component={Cover} width={W} height={H} />
    <Still id="Answer" component={Answer} width={W} height={H} />
  </>
);
