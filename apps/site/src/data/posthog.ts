// PostHog: how netnyahoo.com counts its visitors (analytics, session replay, errors, logs, web
// vitals, support). This is the only place the project key lives. It's PostHog's public,
// client-side key, made to ship in page code. PUBLIC_POSTHOG_KEY overrides it, and an empty value
// leaves PostHog out of the build.
export const POSTHOG_KEY: string =
  import.meta.env.PUBLIC_POSTHOG_KEY ?? "phc_qzH3gR3HsZEF8fUXnwEdugsZm6Yq5pUPiEUGMqjxL3QY";

// The project is on PostHog's EU cloud.
export const POSTHOG_HOST = "https://eu.i.posthog.com";

// Only these hosts report. Anywhere else (pnpm dev, pnpm preview, a platform preview URL) PostHog
// stays off unless you opt in for testing from the console:
//   localStorage.setItem("nn:posthog", "dev"); location.reload()
// and then every event carries environment=development (localhost also marks the person as a
// test user), so it can be filtered out.
export const PRODUCTION_HOSTS = ["netnyahoo.com", "www.netnyahoo.com"];
