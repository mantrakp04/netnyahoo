import { launchEnvironment, readDocument, writeDocument } from "@netnyahoo/shell";

// Kill switches for speed changes people can feel. A switch is ON by default and the old behaviour is what it falls back
// to when it's turned off, so a release that turns out slow or broken on someone's Mac can be backed out without
// shipping another build. netnyahoo.com/switches.json (apps/site/public/switches.json) says which are off.
//
// Privacy: the file is a plain static page. The request carries no cookie, no ID and no query, the answer is the same
// for everyone, and nothing here knows which switches a copy has (docs/kill-switches.md). It is fetched at most once a
// launch, only where the update check also runs (killSwitchesLaunch.ts), and cached in the data dir for offline.
//
// Reading is synchronous and cheap (one object lookup after the cache's first read) and never re-renders anything: a
// value that arrives from the network is saved for the next launch, and applied now only to a `live` switch, which is
// read where it is used, never held in state.

export type SwitchDef = {
  /** What it turns off, in a line. */
  about: string;
  /** Who answers for it (an area, not a person), and who removes it. */
  owner: string;
  /** YYYY-MM-DD: the switch and its old path are deleted by then; killSwitches.test.mjs fails after it. */
  removeBy: string;
  /** A value from the network applies as soon as it arrives. Otherwise at the next launch (the switch is read once, at launch). */
  live: boolean;
};

/** The most switches that may exist at once. Delete one (and its fallback) before adding the ninth. */
export const MAX_SWITCHES = 8;

export const SWITCHES = {
  newTabPrewarm: {
    about: "A New Tab page's engine tab is made a moment after it opens, so Enter only navigates it (lib/preload.ts).",
    owner: "command bar",
    removeBy: "2026-12-15",
    live: true,
  },
  lazySidebarRows: {
    about: "A launch mounts only the sidebar rows its window shows, and the profile pages beside it a frame later (Sidebar.tsx).",
    owner: "sidebar",
    removeBy: "2026-12-15",
    live: false,
  },
  updatePrewarm: {
    about: "An update staged for install-on-quit is run once, hidden, so its first launch skips macOS's first-exec checks (Updater.swift).",
    owner: "updater",
    removeBy: "2026-12-15",
    live: true,
  },
  launchTab: {
    about: "The focused window's page starts loading as the app starts, before its window is up (store/launchTab.ts).",
    owner: "launch",
    removeBy: "2026-12-15",
    live: false,
  },
  focusedWindowFirst: {
    about: "A launch with several windows builds the focused one first and opens the others behind it after (lib/windowOpenOrder.ts).",
    owner: "launch",
    removeBy: "2026-12-15",
    live: false,
  },
  sidebarSlide: {
    about: "Hiding or showing the sidebar (⌘S) slides it and the card's edge (Arc's motions and toolbar-less card with the address bar in the sidebar); off, they jump (layout/SidebarDock.tsx).",
    owner: "sidebar",
    removeBy: "2026-12-15",
    live: true,
  },
  sidebarSlideLean: {
    about: "The sidebar's slide draws the traffic lights' moves and lays them out once they stop (NNCoreChromeWindow.mm).",
    owner: "sidebar",
    removeBy: "2026-12-15",
    live: false,
  },
} as const satisfies Record<string, SwitchDef>;

export type SwitchName = keyof typeof SWITCHES;

const CACHE_DOC = "switches-cache.json";
export const SWITCHES_URL = "https://netnyahoo.com/switches.json";
/** NETNYAHOO_SWITCHES="name=off,other=on": a launch's own values, over everything else (benches, tests, support). */
export const SWITCHES_ENV = "NETNYAHOO_SWITCHES";
const FETCH_TIMEOUT_MS = 5000;
const MAX_BYTES = 4096;

type Values = Partial<Record<SwitchName, boolean>>;

const known = (name: string): name is SwitchName => Object.hasOwn(SWITCHES, name);

/** The booleans in `{ "switches": { name: boolean } }` for switches this build knows; anything else is ignored. */
export function parseSwitches(json: string | null | undefined): Values {
  const out: Values = {};
  try {
    const switches = (JSON.parse(json ?? "") as { switches?: Record<string, unknown> } | null)?.switches;
    if (switches && typeof switches === "object")
      for (const [name, value] of Object.entries(switches)) if (known(name) && typeof value === "boolean") out[name] = value;
  } catch {}
  return out;
}

/** "a=off,b=on" (also 0/1, false/true). */
export function parseOverride(text: string | null | undefined): Values {
  const out: Values = {};
  for (const part of (text ?? "").split(",")) {
    const [name, value] = part.split("=").map((s) => s.trim());
    if (!name || !known(name)) continue;
    if (value === "off" || value === "0" || value === "false") out[name] = false;
    else if (value === "on" || value === "1" || value === "true") out[name] = true;
  }
  return out;
}

let override: Values = {};
let cached: Values = {};
let loaded = false;

function load() {
  loaded = true;
  try {
    cached = parseSwitches(readDocument(CACHE_DOC));
    override = parseOverride(launchEnvironment(SWITCHES_ENV));
  } catch {
    cached = {};
    override = {};
  }
}

/** Whether `name` is on: this launch's override, else the cached value, else its default (on). Synchronous, never throws. */
export function switchOn(name: SwitchName): boolean {
  if (!loaded) load();
  return override[name] ?? cached[name] ?? true;
}

/** Forgets what was read, so the next read reloads the cache and the override (tests, and a launch's first read). */
export function reloadSwitches() {
  loaded = false;
  cached = {};
  override = {};
}

let fetchedThisLaunch = false;

export type RefreshResult = "updated" | "failed" | "already";

/**
 * Asks netnyahoo.com for the switches, once per launch, and saves the answer for the next launch (and, for a `live`
 * switch, applies it now). A failed or odd answer leaves what was cached. `fetchFn` is for tests.
 */
export async function refreshSwitches(fetchFn: typeof fetch = fetch): Promise<RefreshResult> {
  if (fetchedThisLaunch) return "already";
  fetchedThisLaunch = true;
  if (!loaded) load();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);
  try {
    // No cookies, no headers of ours, no query string: the same request anyone's browser makes for the file.
    const response = await fetchFn(SWITCHES_URL, { method: "GET", credentials: "omit", cache: "no-store", signal: abort.signal });
    if (!response.ok) return "failed";
    const text = await response.text();
    if (text.length > MAX_BYTES) return "failed";
    const parsed = JSON.parse(text) as { version?: unknown; switches?: unknown };
    if (parsed?.version !== 1 || !parsed.switches || typeof parsed.switches !== "object") return "failed";
    const values = parseSwitches(text);
    writeDocument(CACHE_DOC, JSON.stringify({ version: 1, switches: values }));
    // A switch that's live follows the new answer at once (one that's gone from it is back to its default);
    // the others keep this launch's value, so a launch behaves the same from start to end.
    const next: Values = { ...cached };
    for (const name of Object.keys(SWITCHES) as SwitchName[]) if (SWITCHES[name].live) next[name] = values[name];
    cached = next;
    return "updated";
  } catch {
    return "failed";
  } finally {
    clearTimeout(timer);
  }
}

/** For tests: lets `refreshSwitches` run again. */
export const resetRefreshForTests = () => void (fetchedThisLaunch = false);
