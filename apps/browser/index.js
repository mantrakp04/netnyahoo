// First: when JS started (launch telemetry), then the opt-in benchmark probe, before React's renderer loads.
import "./src/telemetry/jsStart";
import "./src/lib/perfProbe";
import { LogBox } from "react-native";
import { nativeApiSkew, startSkewed } from "./src/nativeApi";

LogBox.ignoreLogs(["The app is running using the Legacy Architecture"]);
// LogBox views crash react-native-macos; suppress console errors and warnings.
LogBox.ignoreAllLogs(true);

// The app loads only on the native build it was written for (src/nativeApi.tsx).
if (nativeApiSkew) startSkewed(nativeApiSkew);
else require("./src/main");
