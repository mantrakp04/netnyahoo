import { onPermission, onPermissionDismissed, resolvePermission, type PermissionKind, type PermissionRequest, type PermissionResult } from "@netnyahoo/cef";
import { ensureNotificationPermission } from "../../lib/webNotifications";
import { useBrowser } from "../../store/browser";
import { patchPage, pageOf, tabForBrowser, usePages } from "../layout/pageState";

/**
 * Web permission requests (camera, location, notifications…) → a prompt on the
 * requesting tab. One shows at a time per tab; later ones wait their turn.
 * Answers are remembered per site ("Always" semantics: the engine stores them,
 * and the site controls popover can change them later).
 */
const queues = new Map<string, PermissionRequest[]>();
/** Requests that arrived before their tab's browser id was known. */
const orphans: PermissionRequest[] = [];
let started = false;

export function startPermissionPrompts() {
  if (started) return;
  started = true;
  onPermission((request) => {
    const tabId = tabForBrowser(request.browserId);
    if (!tabId) {
      orphans.push(request);
      return;
    }
    enqueue(tabId, request);
  });
  // Chromium withdrew the request (navigation, tab closed, page cancelled it).
  onPermissionDismissed(({ id }) => drop(id));
  // A browser id learned later may own a waiting request.
  usePages.subscribe((s, prev) => {
    if (s.browsers === prev.browsers || !orphans.length) return;
    for (const request of orphans.splice(0)) {
      const tabId = tabForBrowser(request.browserId);
      if (tabId) enqueue(tabId, request);
    }
  });
}

function enqueue(tabId: string, request: PermissionRequest) {
  if (!pageOf(tabId).permission) patchPage(tabId, { permission: request });
  else queues.set(tabId, [...(queues.get(tabId) ?? []), request]);
}

function next(tabId: string) {
  const queue = queues.get(tabId) ?? [];
  patchPage(tabId, { permission: queue.shift() ?? null });
  if (queue.length) queues.set(tabId, queue);
  else queues.delete(tabId);
}

function drop(id: string) {
  for (const [tabId, page] of Object.entries(usePages.getState().pages)) {
    if (page.permission?.id === id) next(tabId);
  }
  for (const [tabId, queue] of queues) queues.set(tabId, queue.filter((r) => r.id !== id));
}

/** Allow / Don't Allow (remembered for the site) or dismiss (asks again next time). */
export function answerPermission(tabId: string, result: PermissionResult) {
  const request = pageOf(tabId).permission;
  if (!request) return;
  void resolvePermission(request.id, result, result !== "dismiss");
  // The first site allowed to notify triggers macOS's own permission prompt.
  if (result === "accept" && request.permissions.includes("notifications")) {
    void ensureNotificationPermission(useBrowser.getState().tabs[tabId]?.windowId);
  }
  next(tabId);
}

/** Leaving the page dismisses whatever it was asking for. */
export function dismissPermissions(tabId: string) {
  for (const r of queues.get(tabId) ?? []) void resolvePermission(r.id, "dismiss");
  queues.delete(tabId);
  const current = pageOf(tabId).permission;
  if (current) {
    void resolvePermission(current.id, "dismiss");
    patchPage(tabId, { permission: null });
  }
}

type Describe = { icon: string; noun?: string; question?: (site: string) => string };

/** Dia's wording: "Allow %@ to access your %@?", with its own lines for some kinds. */
const KINDS: Record<PermissionKind, Describe> = {
  camera: { icon: "video", noun: "camera" },
  microphone: { icon: "mic", noun: "microphone" },
  cameraPanTiltZoom: { icon: "video", noun: "camera's pan, tilt and zoom" },
  screen: { icon: "rectangle.on.rectangle", question: (s) => `Allow ${s} to share your screen?` },
  location: { icon: "location", noun: "location" },
  notifications: { icon: "bell", question: (s) => `Allow ${s} to send you notifications?` },
  clipboard: { icon: "doc.on.clipboard", noun: "clipboard" },
  midi: { icon: "pianokeys", noun: "MIDI devices" },
  multipleDownloads: { icon: "arrow.down.circle", question: (s) => `Allow ${s} to download multiple files?` },
  localFonts: { icon: "textformat", noun: "fonts" },
  idleDetection: { icon: "person.crop.circle.badge.clock", question: (s) => `Allow ${s} to know when you're actively using this device?` },
  storageAccess: { icon: "externaldrive", question: (s) => `Allow ${s} to use cookies and site data while embedded?` },
  diskQuota: { icon: "internaldrive", question: (s) => `Allow ${s} to store files on your device?` },
  windowManagement: { icon: "macwindow.on.rectangle", noun: "displays to open and place windows" },
  fileSystem: { icon: "folder", noun: "files" },
  keyboardLock: { icon: "keyboard", noun: "keyboard" },
  pointerLock: { icon: "cursorarrow", noun: "mouse pointer" },
  protectedMedia: { icon: "lock.shield", question: (s) => `Allow ${s} to play protected content?` },
  protocolHandler: { icon: "envelope", question: (s) => `Make ${s} your default mail app?` },
  sensors: { icon: "gyroscope", noun: "motion sensors" },
  localNetwork: { icon: "network", noun: "devices on your local network" },
  vr: { icon: "visionpro", noun: "virtual reality devices" },
  ar: { icon: "visionpro", noun: "augmented reality data" },
  handTracking: { icon: "hand.raised", noun: "hand tracking" },
  identityProvider: { icon: "person.badge.key", question: (s) => `Allow ${s} to sign you in with an identity provider?` },
  webAppInstallation: { icon: "app.badge", question: (s) => `Allow ${s} to install web apps?` },
  capturedSurfaceControl: { icon: "rectangle.on.rectangle", question: (s) => `Allow ${s} to scroll and zoom the tab you share?` },
};

const list = (words: string[]) => (words.length < 2 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`);

export function describePermission(request: PermissionRequest): { icons: string[]; question: string } {
  let site = request.origin;
  try {
    site = new URL(request.origin).hostname.replace(/^www\./, "") || request.origin;
  } catch {}
  const kinds = request.permissions.map((k) => KINDS[k] ?? { icon: "questionmark.circle", noun: k });
  const icons = [...new Set(kinds.map((k) => k.icon))];
  const single = kinds.length === 1 ? kinds[0]!.question : undefined;
  if (single) return { icons, question: single(site) };
  const nouns = kinds.map((k) => k.noun).filter((n): n is string => !!n);
  if (nouns.length === kinds.length) return { icons, question: `Allow ${site} to access your ${list(nouns)}?` };
  // Mixed kinds with their own sentences: fall back to a generic line.
  return { icons, question: `Allow ${site} to use ${list(request.permissions.map((k) => KINDS[k]?.noun ?? k))}?` };
}
