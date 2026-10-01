// The app itself, which index.js loads once the native build matches this bundle (nativeApi.tsx).
// First, so every native module listener the app adds applies held page reports before it runs.
import "./lib/nativeEvents";
import { useEffect } from "react";
import { AppRegistry, unstable_batchedUpdates } from "react-native";
import { WindowRoot } from "./App";
import { DevErrorBoundary } from "./DevErrorBoundary";
import { startTranslate } from "./components/site/translate";
import { startAppIntegration } from "./lib/appIntegration";
import { startNativeSync } from "./lib/native";
import { startPersistence } from "./lib/persist";
import { perfMark, perfProbeEnabled, probeStore } from "./lib/perfProbe";
import { startTabLifecycle } from "./lib/tabLifecycle";
import { startSync } from "./sync/engine";
import { setStoreBatching, useBrowser } from "./store/browser";
import { installErrorReporting, startTelemetry } from "./telemetry";
import { markFirstWindow } from "./telemetry/track";

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
if (__DEV__ || perfProbeEnabled) require("./lib/devHarness").startDevHarness();

function Root({ windowId }: { windowId: string }) {
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
