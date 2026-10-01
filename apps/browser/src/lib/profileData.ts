import { deleteProfileData } from "@netnyahoo/nncore";
import { useBrowser } from "../store/browser";

// A deleted profile's engine data goes once its web views have closed. What can't be deleted stays queued
// (in session.json) and is tried again at the next launch.
const CLOSE_DELAY_MS = 1500;

const failed = new Set<string>();
let running = false;

async function drain() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const engine = useBrowser.getState().orphanedProfileData.find((e) => !failed.has(e));
      if (engine === undefined) return;
      await new Promise((resolve) => setTimeout(resolve, CLOSE_DELAY_MS));
      const remaining = await deleteProfileData(engine).catch((error: unknown) => [String(error)]);
      if (remaining.length) {
        failed.add(engine);
        console.warn(`Couldn't delete profile data (${engine || "original profile"}): ${remaining.join(", ")}`);
      } else {
        useBrowser.getState().profileDataDeleted(engine);
      }
    }
  } finally {
    running = false;
  }
}

export function startProfileDataCleanup() {
  failed.clear();
  void drain();
  return useBrowser.subscribe((s, prev) => {
    if (s.orphanedProfileData !== prev.orphanedProfileData) void drain();
  });
}
