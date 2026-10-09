import { launchEnvironment, readDocument, stopIntroMusic, writeDocument } from "@arcadia/shell";
import { create } from "zustand";
import { useBrowser } from "../../store/browser";
import { resolveWindowId } from "../../store/model";
import { pinSites } from "./sites";
import { endToolTour, startToolTour } from "./tour/state";

export type OnboardingStep = "intro" | "defaultBrowser" | "personalize" | "import" | "pinnedTabs" | "privacy" | "outro";

export const STEPS: OnboardingStep[] = ["intro", "defaultBrowser", "personalize", "import", "pinnedTabs", "privacy", "outro"];

type OnboardingState = {
  windowId: string | null;
  step: OnboardingStep;
  leaving: boolean;
  session: number;
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
  startedAt?: number;
  completedAt: number | null;
  defaultBrowserTrialStartedAt?: number;
  defaultBrowserCheckInDoneAt?: number;
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

export const recordDefaultBrowserTrial = () => save({ defaultBrowserTrialStartedAt: Date.now() });

export const defaultBrowserTrialStartedAt = () => readSaved()?.defaultBrowserTrialStartedAt ?? null;

export const defaultBrowserCheckInDoneAt = () => readSaved()?.defaultBrowserCheckInDoneAt ?? null;
export const recordDefaultBrowserCheckInDone = () => save({ defaultBrowserCheckInDoneAt: Date.now() });

export const onboardingCompletedAt = () => readSaved()?.completedAt ?? null;

export const introMusicMuted = () => readSaved()?.introMusicMuted ?? false;
export const saveIntroMusicMuted = (muted: boolean) => save({ introMusicMuted: muted });

export function startOnboarding(windowId?: string | null, step: OnboardingStep = "intro") {
  const id = resolveWindowId(useBrowser.getState(), windowId);
  if (!id) return;
  endToolTour();
  useOnboarding.setState((s) => ({ windowId: id, step, leaving: false, tourAfter: false, session: s.session + 1 }));
}

export function finishOnboarding(options: { tour?: boolean } = {}) {
  markCompleted();
  stopIntroMusic(0.6);
  const { windowId } = useOnboarding.getState();
  if (windowId) useOnboarding.setState({ leaving: true, tourAfter: !!options.tour });
}

export function dismissOnboarding(session: number) {
  const { session: current, windowId, tourAfter } = useOnboarding.getState();
  if (current !== session) return;
  useOnboarding.setState({ windowId: null, step: "intro", leaving: false, tourAfter: false });
  if (tourAfter && windowId) startToolTour(windowId);
}

export function maybeStartOnboarding() {
  const saved = readSaved();
  if (saved?.completedAt) return;
  if (saved?.startedAt) return startOnboarding(null, "defaultBrowser");
  if (readDocument("session.json")) return markCompleted();
  if (__DEV__ && launchEnvironment("ARCADIA_ONBOARDING") !== "1") return;
  save({ startedAt: Date.now() });
  startOnboarding();
}

if (__DEV__) (globalThis as { acOnboarding?: unknown }).acOnboarding = {
    store: useOnboarding,
    start: startOnboarding,
    finish: finishOnboarding,
    pinSites,
  };
