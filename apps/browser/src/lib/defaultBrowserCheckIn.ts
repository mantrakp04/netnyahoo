import { create } from "zustand";
import {
  defaultBrowserCheckInDoneAt,
  defaultBrowserTrialStartedAt,
  recordDefaultBrowserCheckInDone,
} from "../components/onboarding/state";
import { useBrowser } from "../store/browser";
import { sendFeedback } from "./appIntegration";

/**
 * The follow-up to onboarding's "Try it for a week" (as the default browser): a week later the
 * New Tab page asks "How are you liking Netnyahoo?" with "Leave us feedback" (Dia's try-for-a-week
 * banner). This is its trigger and state; the banner itself is drawn by the New Tab page.
 */
export const CHECK_IN_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** Dia's copy ("How are you liking Dia?" / "Leave us feedback"). */
export const CHECK_IN_COPY = { title: "How are you liking Netnyahoo?", action: "Leave us feedback" } as const;

type CheckIn = { trialStartedAt: number | null; doneAt: number | null };

/** Read once per launch; answering updates it for every window at once. */
const useCheckIn = create<CheckIn>(() => ({ trialStartedAt: defaultBrowserTrialStartedAt(), doneAt: defaultBrowserCheckInDoneAt() }));

/** Whether the banner is due: the trial week is over and it hasn't been answered or dismissed. */
export function checkInDue({ trialStartedAt, doneAt }: CheckIn, now = Date.now()): boolean {
  return trialStartedAt !== null && doneAt === null && now - trialStartedAt >= CHECK_IN_AFTER_MS;
}

/** Retires the banner for good (answered or dismissed). */
export function dismissDefaultBrowserCheckIn() {
  recordDefaultBrowserCheckInDone();
  useCheckIn.setState({ doneAt: Date.now() });
}

/**
 * For the New Tab page of `windowId`: whether to show the check-in (never in incognito), and its
 * two actions. "Leave us feedback" opens Help › Send Feedback… and, like closing it, retires the banner.
 */
export function useDefaultBrowserCheckIn(windowId: string) {
  const due = useCheckIn(checkInDue);
  const incognito = useBrowser((s) => !!s.windows[windowId]?.incognito);
  return {
    visible: due && !incognito,
    leaveFeedback() {
      dismissDefaultBrowserCheckIn();
      void sendFeedback(windowId);
    },
    dismiss: dismissDefaultBrowserCheckIn,
  };
}

// DEV: tooling drives it through the dev harness (`globalThis.nnCheckIn.store.setState(…)`).
if (__DEV__) (globalThis as { nnCheckIn?: unknown }).nnCheckIn = { store: useCheckIn, due: () => checkInDue(useCheckIn.getState()) };
