import type { WebNotification } from "@netnyahoo/cef";
import {
  confirm,
  notificationPermission,
  openNotificationSettings,
  postNotification,
  removeNotifications,
  requestNotificationPermission,
  type NotificationResponse,
} from "@netnyahoo/shell";
import { useBrowser } from "../store/browser";
import { focus, switchToTab } from "./actions";
import { webviews } from "./webviews";

/**
 * Web notifications (`new Notification()` / `showNotification()`) → Notification Center.
 * The engine has already checked the site's permission. Clicking one brings its tab forward
 * and runs the page's click handler; closing it runs the close handler.
 */
/** macOS notification id → the engine's id of the page notification it shows. */
const shown = new Map<string, string>();

/** A tag names a notification per site: showing one with the same tag replaces it. */
const macId = (n: WebNotification) => (n.tag ? `web:${n.origin}#${n.tag}` : `web:${n.id}`);

export function showWebNotification(tabId: string, n: WebNotification) {
  const s = useBrowser.getState();
  const tab = s.tabs[tabId];
  const window = tab ? s.windows[tab.windowId] : undefined;
  // Like Chrome (and Dia), incognito pages don't get to notify: dismiss it so the page's handlers settle.
  if (!tab || !window || window.incognito) return void webviews.get(tabId)?.notificationAction(n.id, "close");
  const id = macId(n);
  shown.set(id, n.id);
  let site = n.origin;
  try {
    site = new URL(n.origin).host;
  } catch {}
  void ensureNotificationPermission(tab.windowId).then(async (allowed) => {
    if (!allowed || shown.get(id) !== n.id) return;
    const icon = n.icon ? await iconFor(tabId, n.icon) : undefined;
    if (shown.get(id) !== n.id) return;
    void postNotification({
      id,
      title: n.title,
      body: n.body,
      subtitle: site,
      silent: n.silent,
      icon,
      tabId,
      windowId: tab.windowId,
      origin: n.origin,
      dismissible: true,
      data: { engineId: n.id },
    });
  });
}

const ICON_PIXELS = 128;
const ICON_TIMEOUT_MS = 3000;

/**
 * The notification's icon as a data: URI, downloaded by the page's own tab (its request
 * context, no cookies) so neither the UI nor Notification Center fetches it from the network.
 * No icon if that fails or takes too long.
 */
async function iconFor(tabId: string, url: string): Promise<string | undefined> {
  const view = webviews.get(tabId);
  if (!view) return undefined;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), ICON_TIMEOUT_MS));
  const image = await Promise.race([view.downloadImage(url, ICON_PIXELS).catch(() => null), timeout]);
  return image?.uri ?? undefined;
}

/** The page called notification.close(). */
export function closeWebNotification(engineId: string) {
  for (const [id, shownId] of shown) {
    if (shownId !== engineId) continue;
    shown.delete(id);
    void removeNotifications([id]);
  }
}

/** Notification Center click / close. Returns false for notifications that aren't web ones. */
export function handleWebNotificationResponse({ id, action, tabId, data }: NotificationResponse): boolean {
  if (!id.startsWith("web:")) return false;
  // The page notification rides along in `data`, so this also works after a JS reload.
  const engineId = (data as { engineId?: string } | null)?.engineId;
  if (engineId && shown.get(id) === engineId) shown.delete(id);
  const tab = tabId ? useBrowser.getState().tabs[tabId] : undefined;
  if (!tab) return true;
  if (action === "click") {
    switchToTab(tab.id);
    focus(tab.windowId);
  }
  if (engineId) void webviews.get(tab.id)?.notificationAction(engineId, action);
  return true;
}

let asked = false;

/**
 * macOS's own permission, the first time a site may notify: the system asks once; if the user
 * has turned Netnyahoo's notifications off, explain where to turn them on (Dia does the same),
 * at most once per launch.
 */
export async function ensureNotificationPermission(windowId?: string): Promise<boolean> {
  const status = await notificationPermission();
  if (status === "granted" || status === "provisional") return true;
  if (status === "notDetermined") return requestNotificationPermission();
  if (asked) return false;
  asked = true;
  const { confirmed } = await confirm({
    title: "Netnyahoo Needs Notifications Permission",
    message: "You need to open System Settings to give Netnyahoo permission to show you Notifications.",
    confirmTitle: "Open System Settings",
    cancelTitle: "Not Now",
    windowId,
  });
  if (confirmed) void openNotificationSettings();
  return false;
}

// DEV: tooling can see which page notifications are showing (`globalThis.nnNotifications`).
if (__DEV__) (globalThis as { nnNotifications?: unknown }).nnNotifications = { shown };
