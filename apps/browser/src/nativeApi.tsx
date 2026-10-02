import { requireNativeModule, requireOptionalNativeModule } from "expo-modules-core";
import { AppRegistry, Text, View } from "react-native";

// The JS/native contract. Bump it together with `apiVersion` in packages/shell/ios/AppModule.swift whenever JS
// starts needing native code an older build lacks (a module, function, view, event or field), so JS never has to
// guard for older builds. Metro serves the working tree to every dev instance, built before or after a native
// change; a Release build embeds its own bundle, so there a mismatch can only be a broken build.
export const NATIVE_API_VERSION = 6;

// Only modules every build has: on another version the app's own imports may throw before anything shows.
const built = requireOptionalNativeModule<{ apiVersion?: number }>("NetnyahooApp")?.apiVersion ?? 0;

export const nativeApiSkew =
  built === NATIVE_API_VERSION
    ? null
    : `Native API skew: this JS bundle needs native API ${NATIVE_API_VERSION}, but the app was built with ` +
      `${built || "none (a build from before the check)"}. Rebuild the app from this checkout.`;

type Shell = {
  openWindow(id: string, options: { kind: string; title: string; focus: boolean }): Promise<void>;
  readDocument(name: string): string | null;
  writeDocument(name: string, contents: string): void;
};

// Instead of the app: one window that shows the skew, and in Debug the dev harness answering every script with it.
export function startSkewed(message: string) {
  console.error(`[netnyahoo] ${message}`);
  AppRegistry.registerComponent("main", () => () => (
    <View style={{ flex: 1, backgroundColor: "#1b1416", padding: 24, paddingTop: 48 }}>
      <Text selectable style={{ color: "#ff8a8a", fontSize: 14, fontFamily: "Menlo" }}>
        {message}
      </Text>
    </View>
  ));
  void requireNativeModule<Shell>("NetnyahooShell").openWindow("native-api-skew", { kind: "settings", title: "Netnyahoo", focus: false });
  if (__DEV__) answerWithSkew(message, "dev-eval.js", "dev-eval-result.json");
}

// Answers every script a driver drops into the data folder as `command` (first line `// <id>`) with the skew, in
// `result`, so the driver fails at once instead of waiting for an app that never loaded.
export function answerWithSkew(message: string, command: string, result: string) {
  const shell = requireNativeModule<Shell>("NetnyahooShell");
  const idOf = (source: string | null) => source?.match(/^\/\/ *(\S+)/)?.[1];
  let lastId = idOf(shell.readDocument(command)) ?? "";
  setInterval(() => {
    const id = idOf(shell.readDocument(command));
    if (!id || id === lastId) return;
    lastId = id;
    shell.writeDocument(result, JSON.stringify({ id, error: message }));
  }, 250);
}
