import { Config } from "@remotion/cli/config";

// the mascot is three.js (src/lib/ac-launch/Mascot3D.tsx): WebGL in headless Chrome needs ANGLE.
Config.setChromiumOpenGlRenderer("angle");
