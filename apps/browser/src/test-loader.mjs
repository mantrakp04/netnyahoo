// Runs the app's TypeScript under plain Node for its tests: native modules resolve to test-native-stub.mjs,
// and extensionless relative imports find their .ts/.tsx file.
import { registerHooks } from "node:module";

const stub = new URL("./test-native-stub.mjs", import.meta.url).href;
const native = new Set(["@netnyahoo/shell", "@netnyahoo/cef", "expo-modules-core"]);

registerHooks({
  resolve(specifier, context, next) {
    if (native.has(specifier)) return { url: stub, shortCircuit: true };
    try {
      return next(specifier, context);
    } catch (error) {
      if (specifier.startsWith(".")) {
        for (const ext of [".ts", ".tsx"]) {
          try {
            return next(specifier + ext, context);
          } catch {}
        }
      }
      throw error;
    }
  },
});
