import { Composition, Still, staticFile } from "remotion";
import { Launch } from "./Launch";
import { Cover } from "./Cover";
import { Answer } from "./Answer";
import { FPS, H, TOTAL, W } from "./timeline";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Launch"
      component={Launch}
      durationInFrames={TOTAL}
      fps={FPS}
      width={W}
      height={H}
      defaultProps={{ clips: [] as string[] }}
      calculateMetadata={async ({ props }) => {
        // Which user recordings exist (written by scripts/prepare-assets.mjs).
        const res = await fetch(staticFile("clips/manifest.json")).catch(() => null);
        return { props: { ...props, clips: res && res.ok ? ((await res.json()) as string[]) : [] } };
      }}
    />
    <Still id="Cover" component={Cover} width={W} height={H} />
    <Still id="Answer" component={Answer} width={W} height={H} />
  </>
);
