// The app itself, which index.js loads once the native build matches this bundle (nativeApi.tsx).
// First, so every native module listener the app adds applies held page reports before it runs.
import "./lib/nativeEvents";
import { useEffect, useLayoutEffect, useState } from "react";
import { AppRegistry, unstable_batchedUpdates } from "react-native";
import { WindowRoot } from "./App";
import { DevErrorBoundary } from "./DevErrorBoundary";
import { startTranslate } from "./components/site/translate";
import { firstWindowCommitted } from "./lib/afterFirstWindow";
import { startAppIntegration } from "./lib/appIntegration";
import { startKillSwitches } from "./lib/killSwitchesLaunch";
import { startNativeSync } from "./lib/native";
import { startPersistence } from "./lib/persist";
import { perfMark, perfProbeEnabled, probeStore } from "./lib/perfProbe";
import { startTabLifecycle } from "./lib/tabLifecycle";
import { startTabPages } from "./lib/tabPages";
import { startSync } from "./sync/engine";
import { setStoreBatching, useBrowser } from "./store/browser";
import { installErrorReporting, startTelemetry } from "./telemetry";
import { launchCommitted } from "./telemetry/journeys";
import { markFirstWindow } from "./telemetry/track";

probeStore("browser", useBrowser);
// Reports stay silent until the user shares them.
installErrorReporting();
setStoreBatching(unstable_batchedUpdates);
startPersistence();
// Before the native sync: a moved tab's page is handed off before the window it left closes (lib/tabPages.ts).
startTabPages();
startNativeSync();
startAppIntegration();
startTabLifecycle();
startTranslate();
startSync();
startTelemetry();
startKillSwitches();
if (__DEV__ || perfProbeEnabled) require("./lib/devHarness").startDevHarness();

// Development: `globalThis.acDevMountDelayMs` holds a window's content back that long after its root starts, as a
// window opened under load mounts late (acceptance move-tab-slow-mount).
const devMountDelay = () => (__DEV__ ? ((globalThis as { acDevMountDelayMs?: number }).acDevMountDelayMs ?? 0) : 0);

function Root({ windowId }: { windowId: string }) {
  const [delay] = useState(devMountDelay);
  const [held, setHeld] = useState(delay > 0);
  useEffect(() => {
    if (!held) return;
    const timer = setTimeout(() => setHeld(false), delay);
    return () => clearTimeout(timer);
  }, []);
  useLayoutEffect(() => launchCommitted(), []);
  useEffect(() => {
    perfMark("firstWindow");
    markFirstWindow();
    firstWindowCommitted();
  }, []);
  if (held) return null;
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
