export const POSTHOG_KEY: string =
  import.meta.env.PUBLIC_POSTHOG_KEY ?? "phc_qzH3gR3HsZEF8fUXnwEdugsZm6Yq5pUPiEUGMqjxL3QY";

export const POSTHOG_HOST = "https://eu.i.posthog.com";

/** On netnyahoo.com PostHog goes through nginx's relay (nginx.conf), which ad blockers leave alone. */
export const POSTHOG_RELAY = "/relay";

export const POSTHOG_UI_HOST = "https://eu.posthog.com";

export const PRODUCTION_HOSTS = ["netnyahoo.com", "www.netnyahoo.com"];
