import { launchEnvironment, readDocument, stopIntroMusic, writeDocument } from "@netnyahoo/shell";
import { create } from "zustand";
import { useBrowser } from "../../store/browser";
import { resolveWindowId } from "../../store/model";
import { pinSites } from "./sites";
import { endToolTour, startToolTour } from "./tour/state";

/**
 * First-launch onboarding (Dia's "unboxing", minus its account and AI steps): the intro
 * animation, then default browser / Dock / login item, theme colour and tab layout, import,
 * pinned-tab suggestions and a welcome. It covers the first browser window and ends on its New Tab page.
 */
export type OnboardingStep = "intro" | "defaultBrowser" | "personalize" | "import" | "pinnedTabs" | "outro";

export const STEPS: OnboardingStep[] = ["intro", "defaultBrowser", "personalize", "import", "pinnedTabs", "outro"];

type OnboardingState = {
  /** The window it covers; null when onboarding isn't showing. */
  windowId: string | null;
  step: OnboardingStep;
  /** Set while the overlay animates away (Get Started / Skip). */
  leaving: boolean;
  /** Bumped on every start, so a restart mid-exit mounts a fresh overlay. */
  session: number;
  /** Start the tool tour once the overlay has gone (the welcome's "Take the Tour"). */
  tourAfter: boolean;
  go(step: OnboardingStep): void;
  next(): void;
};

export const useOnboarding = create<OnboardingState>((set, get) => ({
  windowId: null,
  step: "intro",
  leaving: false,
  session: 0,
  tourAfter: false,
  go: (step) => set({ step }),
  next() {
    const i = STEPS.indexOf(get().step);
    const step = STEPS[i + 1];
    if (step) set({ step });
    else finishOnboarding();
  },
}));

const DOC = "onboarding.json";
type Saved = {
  version: 1;
  /** Set when it first shows: quitting halfway brings it back on the next launch. */
  startedAt?: number;
  completedAt: number | null;
  /** "Try Netnyahoo as your default for seven days": when the week started. */
  defaultBrowserTrialStartedAt?: number;
  /** When the week's follow-up banner was answered or dismissed (lib/defaultBrowserCheckIn). */
  defaultBrowserCheckInDoneAt?: number;
  /** The intro's mute button (it stays muted for the next showing). */
  introMusicMuted?: boolean;
};

function readSaved(): Saved | null {
  try {
    const json = readDocument(DOC);
    return json ? (JSON.parse(json) as Saved) : null;
  } catch {
    return null;
  }
}

function save(patch: Partial<Saved>) {
  try {
    writeDocument(DOC, JSON.stringify({ version: 1, completedAt: null, ...readSaved(), ...patch } satisfies Saved));
  } catch (error) {
    console.warn("Couldn't save onboarding state", error);
  }
}

const markCompleted = () => save({ completedAt: Date.now() });

/** The user chose to try Netnyahoo as their default browser for a week. */
export const recordDefaultBrowserTrial = () => save({ defaultBrowserTrialStartedAt: Date.now() });

/**
 * When the default-browser week started (null if they didn't pick the trial). For the New Tab
 * page's follow-up banner ("How are you liking Netnyahoo?") once seven days have passed.
 */
export const defaultBrowserTrialStartedAt = () => readSaved()?.defaultBrowserTrialStartedAt ?? null;

/** The follow-up banner was answered or dismissed; it doesn't come back. */
export const defaultBrowserCheckInDoneAt = () => readSaved()?.defaultBrowserCheckInDoneAt ?? null;
export const recordDefaultBrowserCheckInDone = () => save({ defaultBrowserCheckInDoneAt: Date.now() });

export const introMusicMuted = () => readSaved()?.introMusicMuted ?? false;
export const saveIntroMusicMuted = (muted: boolean) => save({ introMusicMuted: muted });

/** Shows onboarding over a window (the focused one by default). DEV: Help › Show Onboarding. */
export function startOnboarding(windowId?: string | null, step: OnboardingStep = "intro") {
  const id = resolveWindowId(useBrowser.getState(), windowId);
  if (!id) return;
  endToolTour();
  useOnboarding.setState((s) => ({ windowId: id, step, leaving: false, tourAfter: false, session: s.session + 1 }));
}

/**
 * Completes onboarding; the overlay fades out (see OnboardingOverlay) and it won't show again.
 * With `tour`, the tool tour starts over the New Tab page it reveals.
 */
export function finishOnboarding(options: { tour?: boolean } = {}) {
  markCompleted();
  stopIntroMusic(0.6);
  const { windowId } = useOnboarding.getState();
  if (windowId) useOnboarding.setState({ leaving: true, tourAfter: !!options.tour });
}

/** Called once the overlay of `session` has animated away (unless onboarding restarted meanwhile). */
export function dismissOnboarding(session: number) {
  const { session: current, windowId, tourAfter } = useOnboarding.getState();
  if (current !== session) return;
  useOnboarding.setState({ windowId: null, step: "intro", leaving: false, tourAfter: false });
  if (tourAfter && windowId) startToolTour(windowId);
}

/**
 * At launch, before the session has been saved for the first time: shows onboarding on a
 * first launch, and again (after the intro) until it's been completed. Existing installs
 * (a saved session, no onboarding record) count as done. DEV builds only show it on a first
 * launch with NETNYAHOO_ONBOARDING=1, so the many dev instances with fresh data directories
 * aren't covered by it.
 */
export function maybeStartOnboarding() {
  const saved = readSaved();
  if (saved?.completedAt) return;
  if (saved?.startedAt) return startOnboarding(null, "defaultBrowser");
  if (readDocument("session.json")) return markCompleted();
  if (__DEV__ && launchEnvironment("NETNYAHOO_ONBOARDING") !== "1") return;
  save({ startedAt: Date.now() });
  startOnboarding();
}

// DEV: tooling reaches the flow through the dev harness (`globalThis.nnOnboarding`).
if (__DEV__) (globalThis as { nnOnboarding?: unknown }).nnOnboarding = {
    store: useOnboarding,
    start: startOnboarding,
    finish: finishOnboarding,
    pinSites,
  };
