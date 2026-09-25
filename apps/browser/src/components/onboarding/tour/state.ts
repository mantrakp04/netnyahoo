import { systemInfo } from "@netnyahoo/shell";
import { create } from "zustand";
import { openUrls } from "../../../lib/actions";
import { useBrowser } from "../../../store/browser";
import { resolveWindowId } from "../../../store/model";
import { closeReleaseNotes } from "../../ntp/releaseNotes";
import { locateAnchor, type TourAnchor } from "./anchors";

/**
 * The tool tour: coach marks over the real window, one feature at a time (Dia's tool tour shows
 * its AI tools on sample pages; ours points at the browser itself). It starts from the welcome
 * step's "Take the Tour" and from Help › Tool Tour.
 */
export type TourStop = {
  id: string;
  title: string;
  body: string;
  /** What it points at; stops whose anchor isn't in the window are left out. None: a centred card. */
  anchor?: TourAnchor;
  /** Where the card sits relative to the spotlight. */
  placement?: "below" | "right" | "inside";
  /** Spotlight corner radius and padding around the anchor. */
  radius?: number;
  pad?: number;
};

export const TOUR_STOPS: TourStop[] = [
  {
    id: "commandBar",
    title: "Search or go anywhere",
    body: "Type a question, an address or the name of an open tab. ⌘L brings the command bar up from any page, and ⌘T opens a new tab.",
    anchor: "commandBar",
    placement: "below",
    radius: 20,
    pad: 6,
  },
  {
    id: "tabs",
    title: "Your tabs live in the sidebar",
    body: "New tabs land here. Drag them to reorder or group them; right-click one to pin it, so it's always a click away.",
    anchor: "tabs",
    placement: "right",
    radius: 10,
    pad: 4,
  },
  {
    id: "sidebar",
    title: "Room to focus",
    body: "⌘S hides the sidebar. Move the pointer to the window's left edge to peek at your tabs while it's hidden.",
    anchor: "sidebarButton",
    placement: "below",
    radius: 9,
    pad: 3,
  },
  {
    id: "split",
    title: "Two pages, side by side",
    body: "Drag a tab onto the page to split the window, or press ⌃⇧=. ⌃⇧] and ⌃⇧[ move between the panes.",
    anchor: "page",
    placement: "inside",
    radius: 10,
    pad: -10,
  },
  {
    id: "done",
    title: "You're all set",
    body: "Everything else is in the menu bar and in Settings (⌘,). You can take this tour again from the Help menu.",
  },
];

type TourState = {
  windowId: string | null;
  /** The stops that have something to point at in this window (resolved when it starts). */
  stops: TourStop[];
  index: number;
  /** Bumped on every start, so a restart gets a fresh overlay. */
  session: number;
};

export const useTour = create<TourState>(() => ({ windowId: null, stops: [], index: 0, session: 0 }));

/** Help › Tool Tour, or the welcome step's "Take the Tour": over a window (the focused one by default). */
export async function startToolTour(windowId?: string | null) {
  const id = resolveWindowId(useBrowser.getState(), windowId);
  if (!id) return;
  const session = useTour.getState().session + 1;
  useTour.setState({ windowId: null, stops: [], index: 0, session });
  // It points at the New Tab page, so the full-page release notes make way.
  closeReleaseNotes();
  const found = await Promise.all(TOUR_STOPS.map((stop) => (stop.anchor ? locateAnchor(id, stop.anchor) : Promise.resolve(true))));
  // Started again (or ended) meanwhile.
  if (useTour.getState().session !== session) return;
  useTour.setState({ windowId: id, stops: TOUR_STOPS.filter((_, i) => !!found[i]) });
}

/** Ends it (or cancels one still starting). */
export function endToolTour() {
  useTour.setState((s) => ({ windowId: null, stops: [], index: 0, session: s.session + 1 }));
}

/** Moves by `delta` stops; past the last one, the tour ends. */
export function stepToolTour(delta: number) {
  const { index, stops } = useTour.getState();
  const next = index + delta;
  if (next >= stops.length) return endToolTour();
  useTour.setState({ index: Math.max(0, next) });
}

/** Help › Video Tour's page, if this build names one (Info.plist NNVideoTourURL). */
export function videoTourUrl(): string | null {
  const url = systemInfo().videoTourURL;
  return url && /^https?:\/\//i.test(url) ? url : null;
}

/** Opens the video tour in a new tab of the window; nothing without a configured URL. */
export function openVideoTour(windowId?: string | null) {
  const url = videoTourUrl();
  if (url) openUrls([url], windowId);
}

// DEV: tooling drives it through the dev harness (`globalThis.nnTour`).
if (__DEV__) (globalThis as { nnTour?: unknown }).nnTour = { store: useTour, start: startToolTour, step: stepToolTour, end: endToolTour };
