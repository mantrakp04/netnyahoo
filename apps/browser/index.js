// First: the opt-in benchmark probe has to be in place before React's renderer loads.
import { perfMark, perfProbeEnabled, probeStore } from "./src/lib/perfProbe";
import { useEffect } from "react";
import { AppRegistry, LogBox, unstable_batchedUpdates } from "react-native";
import { WindowRoot } from "./src/App";
import { DevErrorBoundary } from "./src/DevErrorBoundary";
import { startTranslate } from "./src/components/site/translate";
import { startAppIntegration } from "./src/lib/appIntegration";
import { startNativeSync } from "./src/lib/native";
import { startPersistence } from "./src/lib/persist";
import { startTabLifecycle } from "./src/lib/tabLifecycle";
import { startSync } from "./src/sync/engine";
import { setStoreBatching, useBrowser } from "./src/store/browser";
import { installErrorReporting, startTelemetry } from "./src/telemetry";
import { markFirstWindow } from "./src/telemetry/track";

LogBox.ignoreLogs(["The app is running using the Legacy Architecture"]);
// LogBox views crash react-native-macos; suppress console errors and warnings.
LogBox.ignoreAllLogs(true);

probeStore("browser", useBrowser);
// Reports stay silent until the user shares them.
installErrorReporting();
setStoreBatching(unstable_batchedUpdates);
startPersistence();
startNativeSync();
startAppIntegration();
startTabLifecycle();
startTranslate();
startSync();
startTelemetry();
if (__DEV__ || perfProbeEnabled) require("./src/lib/devHarness").startDevHarness();

function Root({ windowId }) {
  useEffect(() => {
    perfMark("firstWindow");
    markFirstWindow();
  }, []);
  return __DEV__ ? (
    <DevErrorBoundary>
      <WindowRoot windowId={windowId} />
    </DevErrorBoundary>
  ) : (
    <WindowRoot windowId={windowId} />
  );
}

AppRegistry.registerComponent("main", () => Root);
perfMark("bundleEnd");
