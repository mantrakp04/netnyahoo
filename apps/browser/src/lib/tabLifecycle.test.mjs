// Sleeping and freezing background tabs (lib/tabLifecycle.ts): a tab with unsaved input never sleeps.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

globalThis.__DEV__ = false;

// The battery saver's toast and Settings, and the internal pages, pull in the whole UI: stand-ins for them, and for the
// engine's task and system calls.
const nncore = new URL("../test-native-stub.mjs", import.meta.url).href;
const stubs = {
  "@netnyahoo/nncore": `export * from ${JSON.stringify(nncore)};
    export const listTasks = async () => [];
    export const onSystemState = () => ({ remove() {} });
    export const systemState = async () => null;
    export const releaseProfile = async () => {};`,
  "../components/layout/splitActions": "export const showToast = () => {};",
  "../components/settings/windows": "export const openSettings = () => {};",
  "../components/pages": "export const isInternalTab = (t) => !/^https?:/.test(t.url ?? '');",
};
registerHooks({
  resolve(specifier, context, next) {
    if (!context.parentURL?.endsWith("/lib/tabLifecycle.ts") || !(specifier in stubs)) return next(specifier, context);
    return { url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true };
  },
});

const { useBrowser } = await import("../store/browser.ts");
const { webviews } = await import("./webviews.ts");
const lifecycle = await import("./tabLifecycle.ts");

const S = () => useBrowser.getState();

// A page in a tab: evaluate answers whether it has unsaved input, setFrozen resolves when the test says so.
function fakePage() {
  const page = { dirty: false, evaluated: 0, discarded: 0, release: () => {} };
  page.handle = {
    evaluate: async () => (page.evaluated++, page.dirty),
    setFrozen: () => new Promise((resolve) => (page.release = resolve)),
    discard: async () => (page.discarded++, "discarded"),
  };
  return page;
}

test("a tab shown and typed in while it was being frozen doesn't sleep", async () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.com" });
  const a = S().windows[w].tabIds[0];
  const b = S().newTab(w, { url: "https://b.com", background: true });
  const page = fakePage();
  webviews.set(b, page.handle);
  lifecycle.useLifecycle.setState({ batterySaver: true });

  const freezing = lifecycle.freezeTab(b);
  await new Promise((resolve) => setTimeout(resolve, 0));
  // Before the engine answers, the tab is shown (which unfreezes it) and typed in, then left again.
  S().activate(b);
  page.dirty = true;
  page.release();
  await freezing;
  S().activate(a);

  assert.equal(await lifecycle.sleepTab(b), false);
  assert.equal(page.evaluated, 1, "asks the page now");
  assert.equal(page.discarded, 0);
  webviews.delete(b);
});

test("a tab without unsaved input sleeps", async () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.com" });
  const b = S().newTab(w, { url: "https://b.com", background: true });
  const page = fakePage();
  webviews.set(b, page.handle);
  assert.equal(await lifecycle.sleepTab(b), true);
  assert.equal(page.discarded, 1);
  webviews.delete(b);
});
