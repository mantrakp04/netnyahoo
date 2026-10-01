// First: the opt-in benchmark probe has to be in place before React's renderer loads.
import "./src/lib/perfProbe";
import { LogBox } from "react-native";
import { nativeApiSkew, startSkewed } from "./src/nativeApi";

LogBox.ignoreLogs(["The app is running using the Legacy Architecture"]);
// LogBox views crash react-native-macos; suppress console errors and warnings.
LogBox.ignoreAllLogs(true);

// The app loads only on the native build it was written for (src/nativeApi.tsx).
if (nativeApiSkew) startSkewed(nativeApiSkew);
else require("./src/main");
