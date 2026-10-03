import { Config } from "@remotion/cli/config";

// Big Yahu is three.js (src/lib/nn-launch/Yahu3D.tsx): WebGL in headless Chrome needs ANGLE.
Config.setChromiumOpenGlRenderer("angle");
