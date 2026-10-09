// JS entry of the bench bundle for old releases (CEF era, before ArcadiaCore: 0.2.17 and its neighbours). legacy-bundle.mjs
// copies this file, bench-channel.js next to it and ../bench-offline.js into that release's own source tree and bundles
// it there, so the release runs its own code with the command channel native-bench needs. Those releases have no
// native API version check and no field timing, so there is no skew guard here.
import "./bench-offline";
import "../../index";
require("./bench-channel");
