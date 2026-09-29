// The project token is a public client key; .env (PUBLIC_POSTHOG_PROJECT_TOKEN, PUBLIC_POSTHOG_HOST) can override both.
export const POSTHOG_KEY: string = import.meta.env.PUBLIC_POSTHOG_PROJECT_TOKEN ?? "phc_qzH3gR3HsZEF8fUXnwEdugsZm6Yq5pUPiEUGMqjxL3QY";

export const POSTHOG_HOST: string = import.meta.env.PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";

/** On netnyahoo.com PostHog goes through nginx's relay (nginx.conf), which ad blockers leave alone. */
export const POSTHOG_RELAY = "/relay";

export const POSTHOG_UI_HOST = POSTHOG_HOST.replace(".i.posthog.com", ".posthog.com");

export const PRODUCTION_HOSTS = ["netnyahoo.com", "www.netnyahoo.com"];
