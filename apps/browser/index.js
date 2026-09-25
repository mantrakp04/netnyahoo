import "./global.css";
import { AppRegistry, LogBox } from "react-native";
import { WindowRoot } from "./src/App";
import { DevErrorBoundary } from "./src/DevErrorBoundary";
import { startAppIntegration } from "./src/lib/appIntegration";
import { startNativeSync } from "./src/lib/native";
import { startPersistence } from "./src/lib/persist";
import { startTabLifecycle } from "./src/lib/tabLifecycle";

// Intentional: react-native-macos 0.81's New Architecture is still experimental.
LogBox.ignoreLogs(["The app is running using the Legacy Architecture"]);
// LogBox's own views use RN shadow props, which crash react-native-macos (RCTView
// didUpdateShadow), so any console.error/warn would take the app down. In DEV they're
// written to $NETNYAHOO_DATA_DIR/dev-console.log instead (lib/devHarness).
LogBox.ignoreAllLogs(true);

// One JS runtime serves every window: restore the session, then open its windows.
startPersistence();
startNativeSync();
startAppIntegration();
startTabLifecycle();
if (__DEV__) require("./src/lib/devHarness").startDevHarness();

// The native side renders "main" once per window, with `initialProperties: { windowId }`.
function Root({ windowId }) {
  return __DEV__ ? (
    <DevErrorBoundary>
      <WindowRoot windowId={windowId} />
    </DevErrorBoundary>
  ) : (
    <WindowRoot windowId={windowId} />
  );
}

AppRegistry.registerComponent("main", () => Root);
