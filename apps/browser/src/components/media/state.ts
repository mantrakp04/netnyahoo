import type { DisplayMediaRequest, MediaCommand, NowPlaying, PictureInPictureState } from "@netnyahoo/cef";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { webviews } from "../../lib/webviews";
import { useBrowser } from "../../store/browser";
import type { BrowserState } from "../../store/browser";
import { activeTabId } from "../../store/model";
import { splitOf } from "../../store/splits";

/**
 * What each tab is playing (the engine's Media Session report), for the mini
 * players. Never persisted; a tab's entry goes when the tab closes or the page
 * stops reporting.
 */
export type Session = NowPlaying & {
  /** When this tab last started playing (ms), for "the most recent playing tab". */
  playedAt: number;
};

type Store = {
  sessions: Record<string, Session>;
  /** Sessions closed from the sidebar player; they come back when they play again. */
  dismissed: Record<string, true>;
  /** Tabs put into Picture in Picture from our controls (or the window-hidden auto PiP). */
  pip: Record<string, "manual" | "auto">;
  /** Tabs with a Picture in Picture window open (the engine's report), for their indicator. */
  pipOpen: Record<string, PictureInPictureState["kind"]>;
  /** getDisplayMedia() calls waiting on the share picker, by tab. */
  displayRequests: Record<string, DisplayMediaRequest>;
  /** Tabs a page is sharing (picked in the share picker), by the sharing tab (ShareBar.tsx). */
  tabShares: Record<string, TabShare>;
};

export type TabShare = {
  /** The tab being shared now ("Share this tab instead" changes it). */
  capturedTabId: string;
  /** The site it's shared with. */
  origin: string;
  /** Tabs whose bar the user dismissed (for this share). */
  dismissed: Record<string, true>;
};

export const useMedia = create<Store>()(() => ({ sessions: {}, dismissed: {}, pip: {}, pipOpen: {}, displayRequests: {}, tabShares: {} }));

/**
 * The engine's onPictureInPicture, for the tab's indicator and the PiP toggles. (PiP the
 * page opened itself, or the engine's tab-switch PiP, isn't in `pip`: the engine closes its
 * own when the tab shows again, and the page's stays.)
 */
export function setPictureInPictureState(tabId: string, { kind, active }: PictureInPictureState) {
  useMedia.setState((s) => {
    if (active ? s.pipOpen[tabId] === kind : !s.pipOpen[tabId]) return s;
    const pipOpen = { ...s.pipOpen };
    if (active) pipOpen[tabId] = kind;
    else delete pipOpen[tabId];
    // Closed from its own window: forget who opened it.
    const pip = { ...s.pip };
    if (!active) delete pip[tabId];
    return { pipOpen, pip };
  });
}

export function setNowPlaying(tabId: string, state: NowPlaying | null) {
  useMedia.setState((s) => {
    const sessions = { ...s.sessions };
    const dismissed = { ...s.dismissed };
    if (!state) {
      if (!sessions[tabId]) return s;
      delete sessions[tabId];
      return { sessions };
    }
    const before = sessions[tabId];
    const started = state.playbackState === "playing" && before?.playbackState !== "playing";
    sessions[tabId] = { ...state, playedAt: started ? Date.now() : (before?.playedAt ?? (state.playbackState === "playing" ? Date.now() : 0)) };
    if (started) delete dismissed[tabId];
    return { sessions, dismissed };
  });
}

export const useSession = (tabId: string | undefined): Session | undefined => useMedia((s) => (tabId ? s.sessions[tabId] : undefined));

export const isPlaying = (session: Session | undefined) => session?.playbackState === "playing";

/** Seconds into the track now: the engine reports a position at a timestamp. */
export function positionOf(session: Session, now = Date.now()): number {
  const elapsed = isPlaying(session) ? ((now - session.timestamp) / 1000) * (session.playbackRate || 1) : 0;
  const position = session.position + elapsed;
  return session.duration ? Math.min(Math.max(0, position), session.duration) : Math.max(0, position);
}

/** Re-renders every `ms` while `active` (the mini players' clock). */
export function useTicker(active: boolean, ms = 500) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [active, ms]);
}

/** m:ss, or h:mm:ss for long media. */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** The page's own Media Session handlers first; `seconds` for seekBy / seekTo. */
export function mediaCommand(tabId: string, action: MediaCommand, seconds?: number) {
  const view = webviews.get(tabId);
  if (!view) return;
  // Optimistic: the engine's report follows a moment later.
  if (action === "play" || action === "pause" || action === "toggle") {
    const session = useMedia.getState().sessions[tabId];
    if (session) {
      const playing = action === "toggle" ? !isPlaying(session) : action === "play";
      const now = Date.now();
      setNowPlaying(tabId, { ...session, position: positionOf(session, now), timestamp: now, playbackState: playing ? "playing" : "paused" });
    }
  }
  void view.mediaCommand(action, seconds);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Tracks change through the page's handlers; without them the side buttons skip 15 s. */
export const hasTrackControls = (session: Session) => session.actions.includes("nexttrack") || session.actions.includes("previoustrack");

export const SKIP_SECONDS = 15;

/** Tabs showing in their window right now (the active tab and its split panes). */
export function isTabShown(s: BrowserState, tabId: string): boolean {
  const windowId = s.tabs[tabId]?.windowId;
  if (!windowId) return false;
  const active = activeTabId(s, windowId);
  if (!active) return false;
  return active === tabId || !!splitOf(s, active)?.tabIds.includes(tabId);
}

/**
 * Of `tabIds`, the one a player should control: playing now (the one that
 * started last), else the one paused last. Closed players and tabs that never
 * played are skipped.
 */
export function playerTabFor(m: Pick<Store, "sessions" | "dismissed">, tabIds: string[]): string | undefined {
  let best: Session | undefined;
  let bestId: string | undefined;
  const rank = (x: Session) => (isPlaying(x) ? 1 : 0);
  for (const id of tabIds) {
    const session = m.sessions[id];
    if (!session || m.dismissed[id] || !session.playedAt || session.playbackState === "none") continue;
    if (!best || rank(session) > rank(best) || (rank(session) === rank(best) && session.playedAt > best.playedAt)) {
      best = session;
      bestId = id;
    }
  }
  return bestId;
}

// MARK: Picture in Picture

const PIP_STATE = 'post("result", JSON.stringify(!!document.pictureInPictureElement))';

/** Whether the tab's page has a video in Picture in Picture now. */
export async function inPictureInPicture(tabId: string): Promise<boolean> {
  return (await webviews.get(tabId)?.evaluate<boolean>(PIP_STATE)) === true;
}

/** Closes the tab's PiP window: a video's, or a Document PiP window (Meet). */
export function exitPictureInPicture(tabId: string) {
  const view = webviews.get(tabId);
  if (!view) return;
  if (useMedia.getState().pipOpen[tabId] === "document") void view.executeJavaScript("window.documentPictureInPicture?.window?.close()");
  else void view.exitPictureInPicture();
  setPip(tabId, null);
}

/** Pops the tab's main video out, or brings it back. Resolves with the new state. */
export async function togglePictureInPicture(tabId: string): Promise<boolean> {
  const view = webviews.get(tabId);
  if (!view) return false;
  if (useMedia.getState().pipOpen[tabId] || (await inPictureInPicture(tabId))) {
    exitPictureInPicture(tabId);
    return false;
  }
  const ok = await view.requestPictureInPicture();
  if (ok) setPip(tabId, "manual");
  return ok;
}

export function setPip(tabId: string, kind: Store["pip"][string] | null) {
  useMedia.setState((s) => {
    if ((s.pip[tabId] ?? null) === kind) return s;
    const pip = { ...s.pip };
    if (kind) pip[tabId] = kind;
    else delete pip[tabId];
    return { pip };
  });
}

/** PiP state of a tab (reported by the engine) and a toggle for it. */
export function usePictureInPicture(tabId: string): [boolean, () => void] {
  const on = useMedia((s) => !!s.pipOpen[tabId]);
  return [on, () => void togglePictureInPicture(tabId)];
}

// Closed tabs take their sessions with them.
useBrowser.subscribe((s, prev) => {
  if (s.tabs === prev.tabs) return;
  const m = useMedia.getState();
  const keys = ["sessions", "dismissed", "pip", "pipOpen", "displayRequests", "tabShares"] as const;
  const gone = [...new Set(keys.flatMap((k) => Object.keys(m[k])))].filter((id) => !s.tabs[id]);
  if (!gone.length) return;
  const next = Object.fromEntries(keys.map((k) => [k, { ...m[k] }])) as Pick<Store, (typeof keys)[number]>;
  for (const id of gone) for (const k of keys) delete next[k][id];
  useMedia.setState(next);
});

/** DEV: the media store for lib/devHarness scripts (`globalThis.nnMedia`). */
if (typeof __DEV__ !== "undefined" && __DEV__) {
  (globalThis as { nnMedia?: unknown }).nnMedia = { useMedia, mediaCommand, togglePictureInPicture, inPictureInPicture };
}
