// "Write to the office" (components/Footer.astro): PostHog's support chat. posthog-js loads only when the button is
// clicked, through nginx's /relay, and only for the chat: it captures nothing else (no pageviews, clicks,
// replays, errors, vitals, logs, surveys or flags). The chat needs PostHog's remote config, which stays on.
// The button shows on netnyahoo.com, where the chat is allowed (PostHog's widget domains), as it did when
// posthog-js was on every page; if the chat can't load (a blocker), the button goes away again.
import { PRODUCTION_HOSTS } from "../data/telemetry";
import { distinctId } from "./telemetry/core";
import { track } from "./track";

/** PostHog's public project token, used only for the support chat. */
const SUPPORT_CHAT_POSTHOG_TOKEN = "phc_qzH3gR3HsZEF8fUXnwEdugsZm6Yq5pUPiEUGMqjxL3QY";
const RELAY = "/relay";

interface PostHog {
  init(token: string, config: Record<string, unknown>): void;
  conversations?: { isAvailable?(): boolean; show?(): void };
}
const ph = () => (window as Window & { posthog?: PostHog }).posthog;

let loading: Promise<PostHog | null> | null = null;

/** posthog-js, set up for the chat alone; resolves once the chat is ready (null if it never is). */
function load(): Promise<PostHog | null> {
  return (loading ??= new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = `${RELAY}/static/array.js`;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => resolve(null);
    script.onload = () => {
      const posthog = ph();
      if (!posthog?.init) return resolve(null);
      posthog.init(SUPPORT_CHAT_POSTHOG_TOKEN, {
        api_host: RELAY,
        ui_host: "https://eu.posthog.com",
        defaults: "2026-08-30",
        bootstrap: { distinctID: distinctId },
        autocapture: false,
        rageclick: false,
        capture_pageview: false,
        capture_pageleave: false,
        capture_dead_clicks: false,
        capture_exceptions: false,
        capture_performance: false,
        capture_heatmaps: false,
        enable_heatmaps: false,
        capture_copied_text: false,
        disable_session_recording: true,
        enable_recording_console_log: false,
        disable_surveys: true,
        disable_product_tours: true,
        disable_web_experiments: true,
        advanced_disable_feature_flags: true,
        logs: undefined,
      });
      let waited = 0;
      const ready = () => {
        if (posthog.conversations?.isAvailable?.()) resolve(posthog);
        else if ((waited += 100) < 10_000) setTimeout(ready, 100);
        else resolve(null);
      };
      ready();
    };
    document.head.append(script);
  }));
}

/** show() only puts PostHog's chat bubble in the corner; this opens the chat itself. */
function open(posthog: PostHog) {
  posthog.conversations?.show?.();
  let waited = 0;
  const press = () => {
    const bubble = document.querySelector<HTMLButtonElement>('#ph-conversations-widget-container button[aria-label="Open chat"]');
    if (bubble) bubble.click();
    else if ((waited += 50) < 2000) setTimeout(press, 50);
  };
  press();
}

// On localhost, ?nnsupport=1 shows it too (PostHog only allows the chat on netnyahoo.com's domains).
const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && new URLSearchParams(location.search).has("nnsupport");
const buttons = document.querySelectorAll<HTMLButtonElement>("[data-support]");
if (buttons.length && (PRODUCTION_HOSTS.includes(location.hostname) || local)) {
  // As before: the button appears once the page has loaded.
  const reveal = () => setTimeout(() => buttons.forEach((b) => (b.hidden = false)), 1000);
  if (document.readyState === "complete") reveal();
  else addEventListener("load", reveal, { once: true });
  for (const b of buttons) {
    b.addEventListener("click", () => {
      track("support_opened", { location: b.dataset.support ?? null });
      b.setAttribute("aria-busy", "true");
      void load().then((posthog) => {
        b.removeAttribute("aria-busy");
        if (posthog) open(posthog);
        else buttons.forEach((x) => (x.hidden = true));
      });
    });
  }
}
