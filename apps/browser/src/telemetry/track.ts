import { appInfo, capture, isSharing } from "./client";

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
  const ms = Math.round(firstWindowAt - start);
  if (ms > 0 && ms < 10 * 60_000) capture("perf_launch", { launch_ms: ms });
}

export const devOmniboxSampler = () => ({ keystrokes, pending: latency.length });
