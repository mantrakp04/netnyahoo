// Node test hooks for the sync adapter tests (adapters.test.mjs): the store tests' hooks, plus
// stand-ins for expo-modules-core and the password API.
// Run from apps/browser:  node --import ./src/sync/test-loader.mjs --test src/sync/adapters.test.mjs
import { registerHooks } from "node:module";

const stub = new URL("./test-native-stub.mjs", import.meta.url).href;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@netnyahoo/shell" || specifier === "@netnyahoo/cef" || specifier === "expo-modules-core") return { url: stub, shortCircuit: true };
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
