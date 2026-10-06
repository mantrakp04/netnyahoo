import { switchOn } from "./killSwitches";
import type { BrowserState } from "../store/browser";

/** The launch order's switch (lib/killSwitches.ts): off, a launch opens the windows as after it, the focused one last. */
const focusedWindowFirstOn = () => switchOn("focusedWindowFirst");

/** How the app opens a window it doesn't have yet: made key, or placed behind another window once that one's content
 *  is on screen (WindowManager's `behind`). */
export type WindowOpen = { id: string; focus: boolean; behind?: string };

/**
 * The order the windows the store has open in. The focused window first, so its content is the first the app builds
 * and its page the first to load; at launch the others wait until it shows, then go behind it in the order they were
 * opened, so the last of them sits right under it (the same stack as the focus order, ui.focusOrder). After launch
 * the focused one opens last, so it comes to front.
 */
export function windowOpens(s: Pick<BrowserState, "windows" | "windowOrder" | "ui">, ids: string[], launching: boolean): WindowOpen[] {
  const focused = s.ui.focusedWindowId && s.windows[s.ui.focusedWindowId] ? s.ui.focusedWindowId : null;
  const wanted = new Set(ids);
  const order = s.windowOrder.filter((id) => wanted.has(id) && id !== focused);
  if (!focused || !wanted.has(focused)) return order.map((id) => ({ id, focus: false }));
  if (!launching || !focusedWindowFirstOn()) return [...order.map((id) => ({ id, focus: false })), { id: focused, focus: true }];
  return [{ id: focused, focus: true }, ...order.map((id) => ({ id, focus: false, behind: focused }))];
}
