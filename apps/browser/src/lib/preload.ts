import { engineCall } from "@netnyahoo/nncore";
import { useEffect, useState } from "react";
import type { Suggestion } from "@netnyahoo/core";
import { useBrowser } from "../store/browser";
import { engineProfile } from "../store/model";
import { switchOn } from "./killSwitches";

// The command bar's preloading, as Chrome's omnibox does it (engine: nn_omnibox.h). Chrome's AutocompleteActionPredictor
// learns which typed text leads to which page; once it's confident about the suggestion Enter would open, the engine
// connects to its site ahead of time, or prerenders it in the bar's tab so Enter shows it at once. Chrome's "Preload
// pages" setting decides whether any of it happens. A page the user hasn't gone to from the bar a few times before is
// never preloaded.

// MARK: The engine

// Both features need an engine that has the bar's calls (nn_omnibox.h), which came with the two fixes the prewarm relies
// on (nncore_api.mm: the prewarmed about:blank leaves no Back entry and no closed-tab entry). On an older engine, or an
// app build that doesn't let the JS call them, both stay off. Asked once, a moment after launch; a profile that isn't
// loaded yet asks again.
let engine: "unknown" | "asking" | "yes" | "no" = "unknown";
const ENGINE_PROBE_DELAY_MS = 1500;
export const engineHasBarCalls = () => engine === "yes";
function askEngine(tries = 5) {
  if (engine !== "unknown") return;
  engine = "asking";
  // Nothing typed since the last call: the predictor has nothing to learn, so this asks and changes nothing.
  engineCall("nn_omnibox_opened", "", { tab: 0, url: "" }).then(
    () => void (engine = "yes"),
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
// keystrokes): on about:blank, under the New Tab page and kept painting (warm: Chrome sees it shown, the user doesn't).
// Enter then only navigates it, and a prerender the bar starts in it (barTyped, below) may start and activate.
// Without it Enter made the tab, its renderer and its view first (J4 from a new tab: 106 ms to the page's first paint,
// against 52 ms for a page navigated in place). It goes when the New Tab page does without a navigation (another tab
// shown, the tab closed).
const PREWARM_DELAY_MS = 120;
// A kill switch, and benches' control (nn.preload): off, a New Tab page makes no page until Enter.
let prewarmOn = true;
export const setNewTabPrewarm = (on: boolean) => void (prewarmOn = on);
// The newTabPrewarm kill switch (lib/killSwitches.ts) is read each time a New Tab page asks: off, Enter makes the tab first.
export const newTabPrewarmOn = () => prewarmOn && engineHasBarCalls() && switchOn("newTabPrewarm");
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

// MARK: Preloading what the bar would open

// Chrome's tab id for each of the app's tabs with a page (ContentCard's onReady).
const chromeTabs = new Map<string, number>();
export const noteChromeTab = (tabId: string, chromeTabId: number) => chromeTabId > 0 && chromeTabs.set(tabId, chromeTabId);
export const forgetChromeTab = (tabId: string) => chromeTabs.delete(tabId);

type Match = { url: string; kind: "typed" | "history" | "bookmark" | "tab" | "search" | "suggest" | "other" };

function matchOf(s: Suggestion): Match | null {
  switch (s.kind) {
    case "page":
      return { url: s.url, kind: s.tabId ? "tab" : s.bookmarked ? "bookmark" : s.visited ? "history" : "typed" };
    case "search":
      return { url: s.url, kind: s.suggested ? "suggest" : "search" };
    case "calc":
    case "create":
      return { url: s.url, kind: "other" };
    case "action":
      return null;
  }
}

// Chrome asks on every change of the text; the bar asks once typing pauses this long (and before Enter), so a burst of
// keystrokes doesn't start and cancel prerenders along the way.
const SETTLE_MS = 60;
// An engine without these calls (older than the app's JS) answers with an error: stop asking.
let unsupported = false;
// The bar's preloading as a whole (a kill switch, and benches' control): off, the bar tells the engine nothing.
let barPreloadingOn = true;
export const setBarPreloading = (on: boolean) => void (barPreloadingOn = on);
// Each bar's text waiting for typing to pause, by the bar's tab, with the engine profile its calls go to (kept: a bar
// whose tab closed still tells the predictor it opened nothing).
type Bar = { profile: string; args?: { text: string; matches: Match[]; default: number }; timer?: ReturnType<typeof setTimeout> };
const bars = new Map<string, Bar>();

function call(name: string, profile: string, args: object) {
  if (unsupported || !engineHasBarCalls() || !switchOn("omniboxPreload")) return;
  engineCall(name, profile, args).catch((e: unknown) => {
    if (/not an engine call|the engine has no/.test(String(e))) unsupported = true;
  });
}

function cancel(tabId: string) {
  const bar = bars.get(tabId);
  if (!bar) return;
  clearTimeout(bar.timer);
  bar.timer = undefined;
  bar.args = undefined;
}

function flush(tabId: string) {
  const bar = bars.get(tabId);
  const args = bar?.args;
  cancel(tabId);
  // The tab's Chrome id as it is now: a New Tab page's prewarmed tab may have come since the text did.
  if (bar && args) call("nn_omnibox_typed", bar.profile, { ...args, tab: chromeTabs.get(tabId) ?? 0 });
}

/** The bar's typed text and the suggestions it shows changed; `selected` is the one Enter opens. */
export function barTyped(tabId: string, text: string, items: readonly Suggestion[], selected: number) {
  if (unsupported || !barPreloadingOn || !engineHasBarCalls()) return cancel(tabId);
  // A text cleared (or one without suggestions) leaves nothing to preload: what was waiting goes.
  if (!text.trim()) return cancel(tabId);
  const matches: Match[] = [];
  let index = -1;
  items.forEach((s, i) => {
    const m = matchOf(s);
    if (!m) return;
    if (i === selected) index = matches.length;
    matches.push(m);
  });
  if (!matches.length) return cancel(tabId);
  const tab = useBrowser.getState().tabs[tabId];
  if (!tab) return;
  let bar = bars.get(tabId);
  if (!bar) bars.set(tabId, (bar = { profile: engineProfile(tab.profileId) }));
  bar.args = { text, matches, default: index };
  clearTimeout(bar.timer);
  bar.timer = setTimeout(() => flush(tabId), SETTLE_MS);
}

/**
 * The bar opened `url` ("" when it closed, or went back to its start, without opening anything): what Chrome's
 * predictor learns from. `learn: false` for a page that isn't what was typed (Paste and Go), which Chrome doesn't learn
 * from either.
 */
export function barOpened(tabId: string, url: string, { learn = true }: { learn?: boolean } = {}) {
  const bar = bars.get(tabId);
  if (!bar) return;
  // Opening a page sends the text it was opened from first (what the predictor learns); closing drops it, so nothing
  // starts loading as the bar goes.
  if (url && learn) flush(tabId);
  else cancel(tabId);
  bars.delete(tabId);
  if (learn) call("nn_omnibox_opened", bar.profile, { tab: chromeTabs.get(tabId) ?? 0, url });
}
