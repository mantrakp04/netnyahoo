import { appInfo, capture, isSharing } from "./client";
import { launchFirstWindow } from "./journeys";

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

export const trackSettingsSection = (section: string) => capture("settings_section_opened", { section });

// A Ctrl+Tab switcher showed the focused tab's preview picture (once per switcher session).
export const trackSwitcherPreview = () => capture("tab_switcher_preview_shown");

// MARK: Command bar speed (sampled)

const SAMPLE_EVERY = 5;
const MAX_SAMPLES = 500;
const latency: number[] = [];
let keystrokes = 0;

export function sampleOmniboxLatency(ms: number) {
  if (!isSharing() || ++keystrokes % SAMPLE_EVERY) return;
  if (ms >= 0 && ms < 10_000 && latency.length < MAX_SAMPLES) latency.push(ms);
}

export const takeOmniboxLatency = () => latency.splice(0);

// MARK: Launch time

let firstWindowAt: number | null = null;

export function markFirstWindow() {
  if (firstWindowAt !== null) return;
  firstWindowAt = Date.now();
  const start = appInfo().processStart;
  if (!isSharing() || !start) return;
  // perf_launch goes once the launch's later steps are in (journeys.ts); launch_ms keeps this meaning.
  if (firstWindowAt - start > 0 && firstWindowAt - start < 10 * 60_000) launchFirstWindow(firstWindowAt);
}

export const devOmniboxSampler = () => ({ keystrokes, pending: latency.length });
