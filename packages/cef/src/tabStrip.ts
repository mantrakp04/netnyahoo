import { Cef } from "./native";

// Chrome's tab strips, as the engine commits them (docs/store-api.md › "Live tabs"). The app's store owns the
// workspace (sidebar order, pins, groups, splits, unloaded tabs); Chrome owns which tabs it has, their order,
// the active one and pins. The app sends commands with ids, and the engine reports every change as an ordered,
// revisioned transaction that names its cause.

/** One tab of a strip, at its index. */
export type StripTab = {
  /** The `transferKey` of the WebView that shows it (the app's tab id), kept while the tab moves between views;
   *  null while no view has shown it (a tab Chrome made, before the app adopts it as `tab:<browser>`; an engine
   *  placeholder). */
  key: string | null;
  /** The engine's browser id (`onReady`). */
  browser: number;
  index: number;
  active: boolean;
  pinned: boolean;
  /** Chrome's tab group (its id in `StripState.groups`), null for none. Absent while the engine doesn't report
   *  groups. */
  group?: string | null;
};

/** A Chrome tab group of the strip, as extensions see it (`chrome.tabGroups`). */
export type StripGroup = {
  id: string;
  title: string;
  color: "grey" | "blue" | "red" | "yellow" | "green" | "pink" | "purple" | "cyan" | "orange";
  collapsed: boolean;
};

/** A Chrome window's tab strip, whole. One per engine profile per app window. */
export type StripState = {
  strip: number;
  /** The app window it belongs to: the strips of one app window (one per profile it shows) share it. */
  window: number;
  /** The engine profile (the WebView `profile` prop). */
  profile: string;
  tabs: StripTab[];
  /** Its tab groups. Absent while the engine doesn't report groups. */
  groups?: StripGroup[];
  /** Its window is gone; the strip won't be reported again. */
  closed?: boolean;
};

export type TabStripTransaction = {
  /** One more than the previous transaction's, for the engine's lifetime. */
  rev: number;
  /** What made the change: a command's id; -1 for the app's own engine calls (a tab created or restored, moved to
   *  another window, a page command run on its tab); null when Chrome made it (an extension, the tab Chrome shows
   *  after the active one closes, a focus request). */
  cmd: number | null;
  /** Every strip the change touched, each whole. Empty for a command that changed nothing. */
  strips: StripState[];
  /** The command named tabs that aren't in its strip (any more): nothing was done. */
  rejected?: boolean;
};

export type TabStripCommand =
  /** Make the tab its strip's active tab. */
  | { op: "activate"; strip: number; key: string }
  /** Put the strip's tabs in this order, the first `pinned` pinned and the rest not. Tabs not listed (or no longer
   *  in the strip) are left out; the strip's other tabs end up after the listed ones. */
  | { op: "arrange"; strip: number; keys: string[]; pinned: number }
  /** Put the strip's listed (unpinned) tabs in a group: one of its `groups`, "new" for a new one, null for none
   *  (out of theirs); with the group's title and color when given. */
  | { op: "group"; strip: number; keys: string[]; group: string | null; title?: string; color?: StripGroup["color"] };

// Ids stay unique across a JS reload, so a command from before it can't be taken for a new one.
let lastCommand = Math.floor(Math.random() * 1e6) * 1e3;

/** Sends a command; returns its id, which comes back as the `cmd` of the one transaction it makes. */
export function sendTabStripCommand(command: TabStripCommand): number {
  const id = ++lastCommand;
  void Cef.tabStripCommand(id, command);
  return id;
}

export const onTabStripTransaction = (listener: (tx: TabStripTransaction) => void) => Cef.addListener("onTabStrip", listener);

/** Every strip as it is now, as a transaction with no command; its `rev` is the last one sent. */
export const tabStrips = (): Promise<TabStripTransaction> => Cef.tabStrips();
