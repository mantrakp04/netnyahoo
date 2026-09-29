import { listTasks, onExtensionsChanged } from "@netnyahoo/cef";
import { onAppEvent } from "@netnyahoo/shell";
import { useTranslate } from "../components/site/translate";
import { useBrowser } from "../store/browser";
import { useSync } from "../sync/engine";
import { capture, endSession, flush, isSharing, startClient } from "./client";
import { reportNativeCrashes } from "./errors";
import { takeOmniboxLatency } from "./track";

/**
 * Coarse feature usage and performance, watched from the store: counts and kinds only, never
 * which page, tab, profile or extension. Every watcher checks `isSharing()` first, so with
 * sharing off they do nothing (turning it on mid-session starts them reporting at once).
 */

const HOUR_MS = 60 * 60_000;
const FIRST_MEMORY_SAMPLE_MS = 10 * 60_000;
/** Chrome reports the extensions it loads at launch as installs; ignore those. */
const EXTENSION_SETTLE_MS = 20_000;

const startedAt = Date.now();
let counts = { tabs: 0, windows: 0 };
let countsSince = Date.now();

function emitCounts() {
  if (isSharing() && (counts.tabs || counts.windows)) {
    capture("usage_counts", {
      tabs_opened: counts.tabs,
      windows_opened: counts.windows,
      period_minutes: Math.round((Date.now() - countsSince) / 60_000),
    });
  }
  counts = { tabs: 0, windows: 0 };
  countsSince = Date.now();
}

const size = (o: object) => Object.keys(o).length;

function watchStore() {
  useBrowser.subscribe((s, prev) => {
    if (!isSharing()) return;
    if (s.tabs !== prev.tabs) counts.tabs += Math.max(0, size(s.tabs) - size(prev.tabs));
    if (s.windows !== prev.windows) {
      counts.windows += Math.max(0, size(s.windows) - size(prev.windows));
      for (const id in s.windows) {
        const w = s.windows[id]!;
        const before = prev.windows[id];
        if (before && before.profileId !== w.profileId && !w.incognito) profileSwitched(size(s.profiles));
      }
    }
    if (s.splits !== prev.splits) {
      for (const id in s.splits) if (!prev.splits[id]) capture("split_view_opened", { panes: s.splits[id]!.tabIds.length });
    }
    if (s.windowUi !== prev.windowUi) {
      for (const id in s.windowUi) if (s.windowUi[id]?.panel.open && !prev.windowUi[id]?.panel.open) capture("command_bar_opened");
    }
  });
}

/** Time from the store switching the window's profile to the second frame after (the new profile drawn). */
function profileSwitched(profiles: number) {
  const start = Date.now();
  requestAnimationFrame(() => requestAnimationFrame(() => capture("profile_switched", { switch_ms: Date.now() - start, profiles })));
}

function watchSync() {
  // Called after startSync: the status it starts in isn't a change.
  let last = useSync.getState().status;
  useSync.subscribe(({ status }) => {
    const was = last;
    last = status;
    if (was === status || !isSharing()) return;
    if (was === "off" && status !== "unavailable") capture("sync_toggled", { on: true });
    else if (status === "off" && was !== "unavailable") capture("sync_toggled", { on: false });
  });
}

function watchTranslate() {
  useTranslate.subscribe((s, prev) => {
    if (!isSharing()) return;
    for (const tabId in s) if (s[tabId]?.status === "translating" && prev[tabId]?.status !== "translating") capture("translate_used");
  });
}

function watchExtensions() {
  onExtensionsChanged((e) => {
    if (e.event === "installed" && Date.now() - startedAt > EXTENSION_SETTLE_MS) capture("extension_installed");
  });
}

// MARK: Performance

const mb = (bytes: number) => Math.round(bytes / 1_048_576);

/** Memory across the engine's processes (Chromium's task manager numbers), plus how many tabs. */
async function sampleMemory() {
  if (!isSharing()) return;
  try {
    // The task manager's first refresh has no numbers yet.
    await listTasks();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const tasks = await listTasks();
    let total = 0;
    let browser = 0;
    let gpu = 0;
    let renderers = 0;
    for (const t of tasks) {
      const m = Math.max(0, t.memory);
      total += m;
      if (t.type === "browser") browser += m;
      else if (t.type === "gpu") gpu += m;
      else if (t.type === "renderer") renderers++;
    }
    if (!total) return;
    capture("perf_memory", {
      total_mb: mb(total),
      browser_mb: mb(browser),
      gpu_mb: mb(gpu),
      renderer_processes: renderers,
      tabs: size(useBrowser.getState().tabs),
      uptime_hours: Math.round((Date.now() - startedAt) / HOUR_MS),
    });
  } catch {}
}

function emitOmniboxLatency() {
  const samples = takeOmniboxLatency().sort((a, b) => a - b);
  if (!samples.length || !isSharing()) return;
  const at = (p: number) => samples[Math.min(samples.length - 1, Math.floor(p * samples.length))]!;
  capture("perf_omnibox", { samples: samples.length, p50_ms: at(0.5), p95_ms: at(0.95), max_ms: samples.at(-1)! });
}

function hourly() {
  emitCounts();
  emitOmniboxLatency();
  void sampleMemory();
}

/**
 * Loads the user's choice and starts the watchers. Call once at startup, after the session is
 * restored and sync has started.
 */
export function startUsage() {
  const session = startClient();
  if (session) {
    capture("app_launched", { previous_session: session.previous });
    if (session.updatedFrom) capture("app_updated", { from_version: session.updatedFrom });
    // Let the launch settle before reading the crash report folder.
    setTimeout(() => void reportNativeCrashes(), 5000);
  }
  watchStore();
  watchSync();
  watchTranslate();
  watchExtensions();
  setTimeout(() => void sampleMemory(), FIRST_MEMORY_SAMPLE_MS);
  setInterval(hourly, HOUR_MS);
  onAppEvent((e) => e.type === "willQuit" && sessionEnding());
}

/** The app is quitting (also DEV's `nnTelemetry.quit()`, as test instances are killed, not quit). */
export function sessionEnding() {
  if (!isSharing()) return;
  emitCounts();
  emitOmniboxLatency();
  capture("app_session_ended", { duration_minutes: Math.round((Date.now() - startedAt) / 60_000) });
  // Queued events wait on disk for the next launch (quitting can't wait on the network).
  endSession();
}

/** DEV: runs the hourly report now and sends it. */
export async function devHourly() {
  hourly();
  await new Promise((resolve) => setTimeout(resolve, 2500));
  await flush();
}
