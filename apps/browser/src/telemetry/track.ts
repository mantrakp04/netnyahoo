import { appInfo, capture, isSharing } from "./client";

/**
 * The calls UI code makes into telemetry (the command bar, Settings, the first window). Light on
 * purpose: it only depends on the client, so components can import it without pulling in the
 * store watchers. Each is a no-op while sharing is off.
 */

/** What kind of row was chosen in the command bar: never the row itself. */
export type SuggestionType = "history" | "bookmark" | "tab" | "url" | "search" | "calc" | "action" | "create" | "typed";

type SuggestionLike = { kind: string; tabId?: string; bookmarked?: boolean; visited?: boolean } | undefined;

export function suggestionType(s: SuggestionLike): SuggestionType {
  if (!s) return "typed";
  switch (s.kind) {
    case "page":
      return s.tabId ? "tab" : s.bookmarked ? "bookmark" : s.visited ? "history" : "url";
    case "search":
    case "calc":
    case "action":
    case "create":
      return s.kind;
    default:
      return "url";
  }
}

export const trackSuggestionChosen = (s: SuggestionLike) => capture("suggestion_chosen", { type: suggestionType(s) });

/** Settings › <section> was shown (`section` is the pane's fixed id, e.g. "privacy"). */
export const trackSettingsSection = (section: string) => capture("settings_section_opened", { section });

// MARK: Command bar speed (sampled)

const SAMPLE_EVERY = 5;
const MAX_SAMPLES = 500;
const latency: number[] = [];
let keystrokes = 0;

/** A keystroke's time from reaching JS to the suggestions it produced being committed. */
export function sampleOmniboxLatency(ms: number) {
  if (!isSharing() || ++keystrokes % SAMPLE_EVERY) return;
  if (ms >= 0 && ms < 10_000 && latency.length < MAX_SAMPLES) latency.push(ms);
}

/** Takes the samples gathered since the last call (usage.ts reports them hourly). */
export const takeOmniboxLatency = () => latency.splice(0);

// MARK: Launch time

let firstWindowAt: number | null = null;

/** The first window's React root committed: launch-to-first-window, from process start. */
export function markFirstWindow() {
  if (firstWindowAt !== null) return;
  firstWindowAt = Date.now();
  const start = appInfo().processStart;
  if (!isSharing() || !start) return;
  const ms = Math.round(firstWindowAt - start);
  if (ms > 0 && ms < 10 * 60_000) capture("perf_launch", { launch_ms: ms });
}

/** DEV: the command bar sampler's counters. */
export const devOmniboxSampler = () => ({ keystrokes, pending: latency.length });
