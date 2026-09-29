/**
 * Where opt-in telemetry goes: PostHog's EU cloud. The key is the project's public client key
 * (write-only, meant to ship in apps); this is the one place it lives.
 */
export const POSTHOG = {
  host: "https://eu.i.posthog.com",
  key: "phc_qzH3gR3HsZEF8fUXnwEdugsZm6Yq5pUPiEUGMqjxL3QY",
} as const;

/** Events and exceptions (PostHog's capture API). */
export const BATCH_URL = `${POSTHOG.host}/batch/`;
/** Warning and error logs (PostHog Logs, OTLP/HTTP JSON). */
export const LOGS_URL = `${POSTHOG.host}/i/v1/logs`;

/**
 * DEV builds never send, even with sharing on, unless launched with this variable set to 1
 * (their events are tagged `$environment: "dev"`). Release test instances are tagged "test".
 */
export const DEV_SEND_ENV = "NETNYAHOO_TELEMETRY";
