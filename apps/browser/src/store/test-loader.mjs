// Node test hooks for the store tests (store.test.mjs): resolves extensionless
// TypeScript imports and swaps the native modules for an in-memory stub.
// Run from apps/browser:  node --import ./src/store/test-loader.mjs --test src/store/store.test.mjs
import { registerHooks } from "node:module";

const stub = new URL("./test-native-stub.mjs", import.meta.url).href;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@netnyahoo/shell" || specifier === "@netnyahoo/cef") return { url: stub, shortCircuit: true };
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
