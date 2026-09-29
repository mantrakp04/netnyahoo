export const POSTHOG = {
  host: "https://eu.i.posthog.com",
  key: "phc_qzH3gR3HsZEF8fUXnwEdugsZm6Yq5pUPiEUGMqjxL3QY",
} as const;

export const BATCH_URL = `${POSTHOG.host}/batch/`;
export const LOGS_URL = `${POSTHOG.host}/i/v1/logs`;

// DEV telemetry sends only with NETNYAHOO_TELEMETRY=1.
export const DEV_SEND_ENV = "NETNYAHOO_TELEMETRY";
