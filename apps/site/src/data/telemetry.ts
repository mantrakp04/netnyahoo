// First-party analytics and session replay: what the site sends, where, and when (src/scripts/telemetry/).
// The wire format is OTLP/HTTP JSON logs; netnyahoo.com's nginx forwards /otel/ to our own collector.

/** Only these hosts report; anywhere else stays silent unless opted in (DEV_OPT_IN). */
export const PRODUCTION_HOSTS = ["netnyahoo.com", "www.netnyahoo.com"];

/** `localStorage.setItem(key, "dev")` makes any other host (localhost, a preview) report too. */
export const DEV_OPT_IN = ["nn:telemetry", "nn:posthog"];

/** Same path on whatever origin serves the page. */
export const LOGS_PATH = "/otel/v1/logs";
export const REPLAY_PATH = "/otel/replay";

export const SERVICE_NAME = "netnyahoo-site";

/** PostHog's project token, only to find the visitor id posthog-js stored (ph_<token>_posthog), so a returning
 * visitor stays the same visitor across the switch. */
export const LEGACY_POSTHOG_TOKEN = "phc_qzH3gR3HsZEF8fUXnwEdugsZm6Yq5pUPiEUGMqjxL3QY";

/** A new session after this long without activity, or after SESSION_MAX_MS in all (posthog-js's rules). */
export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const SESSION_MAX_MS = 24 * 60 * 60 * 1000;

/** Events go out in batches this often (and at once when a page is hidden). */
export const FLUSH_MS = 3000;

/** Replays: every session is recorded, but uploaded only once it's this long, and only for this share of
 * sessions (chosen per session, so every page of a session agrees). */
export const REPLAY_MIN_SESSION_MS = 4000;
export const REPLAY_SAMPLE_RATE = 1;
/** A gzipped chunk goes up this often. */
export const REPLAY_CHUNK_MS = 5000;
/** rrweb masks the text of anything matching this, and blocks (draws a placeholder for) BLOCK. */
export const PRIVATE_SELECTOR = ".nn-private, [data-private]";
export const BLOCK_SELECTOR = ".nn-block, [data-private-block]";

/** Feature flags, bucketed on the visitor id with PostHog's algorithm, so visitors keep their variant.
 * The id, version and reason are what PostHog reported for this flag, kept for continuity. */
export const FLAGS = {
  "download-band": {
    id: 293364,
    version: 2,
    rollout: 100,
    variants: [
      { key: "control", rollout: 50 },
      { key: "band", rollout: 50 },
    ],
    experiment: true,
  },
} as const;
export type FlagKey = keyof typeof FLAGS;
