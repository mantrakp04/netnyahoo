import { engineCall } from "@arcadia/arcadiacore";
import { useEffect, useState } from "react";
import { switchOn } from "./killSwitches";

// The New Tab page's prewarm: its engine tab is made ahead, so Enter only navigates it.

// MARK: The engine

// The prewarm needs an engine with its fixes (ArcadiaCore: the prewarmed about:blank leaves no Back entry, and nothing in
// Chrome's closed-tab list when it, its window or the app closes), which answers ac_omnibox_opened with {prewarm: 2}
// (ac_omnibox.h). On an older engine, or an app build that doesn't let the JS call it, the prewarm stays off. Asked once, a moment after
// launch; a profile that isn't loaded yet asks again.
let engine: "unknown" | "asking" | "yes" | "no" = "unknown";
const ENGINE_PROBE_DELAY_MS = 1500;
export const engineHasPrewarmFixes = () => engine === "yes";
function askEngine(tries = 5) {
  if (engine !== "unknown") return;
  engine = "asking";
  // It answers and changes nothing.
  engineCall<{ prewarm?: number }>("ac_omnibox_opened", "", {}).then(
    (r) => void (engine = (r?.prewarm ?? 0) >= 2 ? "yes" : "no"),
    (e: unknown) => {
      if (/not an engine call|the engine has no/.test(String(e))) engine = "no";
      else {
        engine = "unknown";
        if (tries > 1) setTimeout(() => askEngine(tries - 1), ENGINE_PROBE_DELAY_MS);
      }
    },
  );
}
setTimeout(askEngine, ENGINE_PROBE_DELAY_MS);
/** Tests: what the engine answered. */
export const setEngineForTests = (has: boolean) => void (engine = has ? "yes" : "no");

// MARK: The new tab's page

// A New Tab page's engine tab is made while it's shown, a moment after it opens (off ⌘T's own frame and the bar's first
// keystrokes): on about:blank, hidden under the New Tab page. Enter then only navigates it and shows it. Hidden rather
// than kept painting (warm): the same J4 from ⌘T (71 ms median either way, n=30 each), and ~37 MB less while a New Tab
// page is open (the GPU process's surface for it).
// Without it Enter made the tab, its renderer and its view first (J4 from a new tab: 106 ms to the page's first paint,
// against 52 ms for a page navigated in place). It goes when the New Tab page does without a navigation (another tab
// shown, the tab closed).
const PREWARM_DELAY_MS = 120;
// A kill switch, and benches' control (ac.preload): off, a New Tab page makes no page until Enter.
let prewarmOn = true;
export const setNewTabPrewarm = (on: boolean) => void (prewarmOn = on);
// The newTabPrewarm kill switch (lib/killSwitches.ts) is read each time a New Tab page asks: off, Enter makes the tab first.
export const newTabPrewarmOn = () => prewarmOn && engineHasPrewarmFixes() && switchOn("newTabPrewarm");
export function usePrewarm(want: boolean) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!want || !newTabPrewarmOn()) {
      setReady(false);
      return;
    }
    const timer = setTimeout(() => setReady(true), PREWARM_DELAY_MS);
    return () => clearTimeout(timer);
  }, [want]);
  return want && ready;
}
