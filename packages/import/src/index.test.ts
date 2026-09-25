// JS wrapper tests against a fake native module (the native side has its own Swift tests).
import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

type Listener = (e: Record<string, unknown>) => void;
const listeners = new Set<Listener>();
const calls: string[] = [];
let unlocked = false;

const native = {
  addListener(_name: string, listener: Listener) {
    listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  },
  emit: (e: Record<string, unknown>) => listeners.forEach((l) => l(e)),
  async listBrowsers() {
    return JSON.stringify([{ id: "chrome", name: "Google Chrome", profiles: [] }]);
  },
  async importData(jobId: string, browserId: string, profileId: string, kinds: string[], options: Record<string, unknown>) {
    calls.push(`importData ${browserId} ${profileId} ${kinds.join(",")} stream=${options.streamHistory}`);
    native.emit({ jobId: "someone-else", type: "progress", kind: "history", phase: "start", processed: 0 });
    native.emit({ jobId, type: "progress", kind: "history", phase: "start", processed: 0, total: 3 });
    native.emit({ jobId, type: "history", entries: JSON.stringify([{ url: "https://a.example/", title: "A", visits: 1, lastVisit: 1 }]) });
    if (kinds.includes("slow")) {
      await new Promise((r) => setTimeout(r, 20));
      if (calls.includes(`cancel ${jobId}`)) throw Object.assign(new Error("Import cancelled"), { code: "cancelled" });
    }
    const passwordsFailed = kinds.includes("passwords") && !unlocked;
    return JSON.stringify({
      browserId, profileId, history: [], historyCount: 1, tabs: [], tabGroups: [], cookies: [], spaces: [], favorites: [],
      credentials: kinds.includes("passwords") && unlocked ? [{ url: "https://x.example/", username: "u", password: "p" }] : [],
      failed: passwordsFailed ? ["passwords"] : [],
      warnings: passwordsFailed ? [{ kind: "passwords", code: "locked", message: "Unlock first" }] : [],
    });
  },
  cancelImport(jobId: string) {
    calls.push(`cancel ${jobId}`);
  },
  async unlockBrowser(browserId: string, primaryPassword: string | null) {
    calls.push(`unlock ${browserId} ${primaryPassword}`);
    if (browserId === "brave") throw Object.assign(new Error("Access to Brave Safe Storage was denied"), { code: "locked" });
    unlocked = true;
    return null;
  },
  isBrowserUnlocked: () => unlocked,
  forgetUnlockedKeys() {
    unlocked = false;
  },
};

// Swap expo-modules-core for the fake before loading the wrapper.
(globalThis as { __importNative?: unknown }).__importNative = native;
const hook = `export async function resolve(specifier, context, next) {
  if (specifier === "expo-modules-core") {
    return { shortCircuit: true, url: "data:text/javascript,export const requireNativeModule = () => globalThis.__importNative;" };
  }
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hook)}`);
const lib = await import("./index.ts");

test("listBrowsers parses the native JSON", async () => {
  assert.deepEqual((await lib.listBrowsers()).map((b) => b.id), ["chrome"]);
});

test("importData routes only its own job's events and streams history", async () => {
  const progress: string[] = [];
  const chunks: unknown[] = [];
  const result = await lib.importData("chrome", "Default", ["history"], {
    onProgress: (p) => progress.push(`${p.kind}:${p.phase}:${p.total}`),
    onHistoryChunk: (c) => chunks.push(...c),
  });
  assert.equal(result.historyCount, 1);
  assert.deepEqual(progress, ["history:start:3"]);
  assert.equal(chunks.length, 1);
  assert.match(calls.at(-1)!, /stream=true$/);
  assert.equal(listeners.size, 0, "listener removed after the job");
});

test("aborting cancels the native job and rejects with code cancelled", async () => {
  const controller = new AbortController();
  const running = lib.importData("chrome", "Default", ["slow" as never], { signal: controller.signal });
  controller.abort();
  await assert.rejects(running, (e: unknown) => e instanceof lib.ImportError && e.code === "cancelled");
  assert.ok(calls.some((c) => c.startsWith("cancel import-")));
});

test("password helpers require literal consent and unlock first", async () => {
  await assert.rejects(lib.decryptChromiumPasswords("chrome", "Default", {} as never), /consent/);
  assert.ok(!calls.some((c) => c.startsWith("unlock")));
  const creds = await lib.decryptChromiumPasswords("chrome", "Default", { userConsented: true });
  assert.deepEqual(creds.map((c) => c.password), ["p"]);
  assert.ok(calls.includes("unlock chrome null"));
  lib.forgetUnlockedKeys();
  await assert.rejects(lib.decryptChromiumPasswords("brave", "Default", { userConsented: true }),
    (e: unknown) => e instanceof lib.ImportError && e.code === "locked");
});

test("flattenBookmarks and toolbarFolder", () => {
  const root = {
    type: "folder" as const, title: "Bookmarks", children: [
      { type: "folder" as const, title: "Bar", role: "toolbar" as const, children: [{ type: "url" as const, title: "A", url: "https://a/" }] },
      { type: "url" as const, title: "B", url: "https://b/" },
    ],
  };
  assert.deepEqual(lib.flattenBookmarks(root).map((b) => b.title), ["A", "B"]);
  assert.equal(lib.toolbarFolder(root)?.title, "Bar");
});
