// Sends a named PostHog event. PostHog itself is set up in components/PostHog.astro; this goes
// through window.posthog, which is a queueing stub until the SDK loads (and stays one on hosts that
// don't report), so calling it early or off-production is harmless. Side-effect free, so any
// script can import it; the event list is in scripts/analytics.ts.

export type Props = Record<string, string | number | boolean | null>;
export interface PostHog {
  capture(event: string, props?: Props, options?: { send_instantly?: boolean }): void;
  conversations?: { isAvailable?(): boolean; show?(): void };
}

export const ph = () => (window as Window & { posthog?: PostHog }).posthog;

export function track(event: string, props?: Props, options?: { send_instantly?: boolean }) {
  try {
    ph()?.capture(event, props, options);
  } catch {
    // Analytics never breaks the page.
  }
}
