// JS entry for native-bench.mjs: the app's own index.js plus a small command channel, bundled in production
// mode (no dev React, no Metro) so a Release build can be driven. Never part of a shipped bundle.
//
// The bench writes `bench-cmd.js` (first line `// <id>`) into NETNYAHOO_DATA_DIR; the body gets `nn` and its
// return value (or promise) lands in `bench-result.json`. Polling stops while the bench measures idle
// (`nn.pause(ms)`), so the channel adds no wakeups to what it measures.
// First: nothing the app sends leaves this machine (see bench-offline.js).
import "./bench-offline";
import "../../index";
import { answerWithSkew, nativeApiSkew } from "../../src/nativeApi";

// The channel drives the app, which index.js loads only on the native build this bundle was written for.
if (nativeApiSkew) answerWithSkew(nativeApiSkew, "bench-cmd.js", "bench-result.json");
else require("./bench-channel");
