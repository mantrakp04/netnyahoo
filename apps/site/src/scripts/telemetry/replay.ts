// Session replay, in the main bundle only as far as deciding to record: rrweb itself (recorder.ts) loads in its
// own chunk once the page is loaded and the browser is idle.
import { REPLAY_SAMPLE_RATE } from "../../data/telemetry";
import { sessionId } from "./core";

/** Chosen per session from its id (random bits), so every page of a session agrees. */
export function sampled(id: string): boolean {
  if (REPLAY_SAMPLE_RATE >= 1) return true;
  const bits = parseInt(id.replace(/-/g, "").slice(-8), 16);
  return Number.isFinite(bits) && bits / 0xffffffff < REPLAY_SAMPLE_RATE;
}

export function startReplay() {
  if (!sampled(sessionId())) return;
  const load = () => import("./recorder").then((m) => m.record()).catch(() => {});
  const idle = () =>
    "requestIdleCallback" in window ? requestIdleCallback(load, { timeout: 3000 }) : setTimeout(load, 1000);
  if (document.readyState === "complete") idle();
  else addEventListener("load", idle, { once: true });
}
