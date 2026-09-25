import * as cef from "@netnyahoo/cef";
import {
  confirm,
  copyText,
  onCommand,
  onNotificationResponse,
  onScriptCommand,
  openExternalURL,
  replyToScript,
  revealFile,
  setScriptState,
  setWindowActivity,
  systemInfo,
  updaterState,
  type CommandEvent,
  type ScriptCommand,
  type ScriptState,
} from "@netnyahoo/shell";
import { maybeStartOnboarding, openVideoTour, startOnboarding, startToolTour } from "../components/onboarding";
import { openTaskManager } from "../components/taskManager/window";
import { useBrowser, type BrowserState } from "../store/browser";
import { activeTabId, resolveWindowId, viewTabIds, windowTitle } from "../store/model";
import { focus, openUrls, openWindow, switchProfile, switchToTab } from "./actions";
import { webviews } from "./webviews";
import { handleWebNotificationResponse } from "./webNotifications";

/**
 * App-level integration with macOS: the Help menu, Handoff, AppleScript,
 * notification clicks and first-launch onboarding. Call once at startup, after the session
 * has been restored and the native sync started.
 */
export function startAppIntegration() {
  onCommand(runAppCommand);
  onNotificationResponse((response) => {
    if (handleWebNotificationResponse(response) || response.action !== "click") return;
    const s = useBrowser.getState();
    const { tabId, windowId } = response;
    if (tabId && s.tabs[tabId]) switchToTab(tabId);
    else if (windowId && s.windows[windowId]) focus(windowId);
  });
  startHandoff();
  startScripting();
  maybeStartOnboarding();
}

function runAppCommand({ command, windowId }: CommandEvent) {
  switch (command) {
    case "sendFeedback":
      return void sendFeedback(windowId);
    case "copyDiagnostics":
      return void diagnostics().then(copyText);
    case "recordPerformanceIssue":
      return void recordPerformanceIssue();
    case "showOnboarding":
      return startOnboarding(windowId);
    case "toolTour":
      return void startToolTour(windowId);
    case "videoTour":
      return openVideoTour(windowId);
    case "taskManager":
      return openTaskManager();
  }
}

// MARK: Feedback and diagnostics

/**
 * Help › Send Feedback… (and the default-browser check-in's "Leave us feedback"). Where it goes
 * is set per build in Info.plist: NNFeedbackURL (a page; "%s" becomes the report), else
 * NNFeedbackEmail. Neither set (as in this repo): a mail draft with the report and no recipient.
 */
export async function sendFeedback(windowId?: string | null) {
  const app = systemInfo();
  const report = await diagnostics();
  const body = `What happened?\n\n\nWhat did you expect?\n\n\n---\n${report}`;
  const page = app.feedbackURL && /^https?:/i.test(app.feedbackURL) ? app.feedbackURL : null;
  if (page) return openUrls([page.replace("%s", encodeURIComponent(body))], windowId);
  const to = app.feedbackEmail && !/[\s?&]/.test(app.feedbackEmail) ? app.feedbackEmail : "";
  const draft = `mailto:${to}?subject=${encodeURIComponent(`${app.appName} Feedback`)}&body=${encodeURIComponent(body)}`;
  // Nothing opened it (an app build without openExternalURL): the report goes to the clipboard.
  if (!(await openExternalURL(draft))) copyText(body);
}

/** Help › Copy Diagnostics: versions and a few counts, nothing about what's browsed. */
export async function diagnostics(): Promise<string> {
  const app = systemInfo();
  const [engine, updates] = await Promise.all([cef.engineInfo().catch(() => null), updaterState().catch(() => null)]);
  const s = useBrowser.getState();
  const regular = s.windowOrder.filter((id) => !s.windows[id]?.incognito);
  return [
    `${app.appName} ${app.appVersion} (${app.appBuild}) — ${app.configuration}`,
    engine ? `Engine: CEF ${engine.cefVersion}, Chromium ${engine.chromiumVersion}` : "Engine: unavailable",
    `macOS ${app.osVersion} (${app.osBuild}), ${app.arch}, ${app.model}, ${Math.round(app.memoryGB)} GB`,
    `Bundle: ${app.bundleId}, locale ${app.locale}`,
    `Windows: ${regular.length} (+${s.windowOrder.length - regular.length} incognito), tabs: ${Object.keys(s.tabs).length}, profiles: ${s.profileOrder.length}`,
    !updates?.available
      ? "Updates: not built in"
      : !updates.configured
        ? "Updates: not set up for this build"
        : `Updates: automatic checks ${updates.automaticChecks ? "on" : "off"}, feed ${updates.feedURL ?? "none"}`,
  ].join("\n");
}

/** Help › Record Performance Issue…: an engine trace, recorded while the user reproduces the problem. */
async function recordPerformanceIssue() {
  if (await cef.isTracing()) return;
  const start = await confirm({
    title: "Record a performance issue?",
    message: "Netnyahoo records what the engine does while you reproduce the problem. The recording is saved to your Downloads folder.",
    confirmTitle: "Start Recording",
  });
  if (!start.confirmed || !(await cef.beginTracing())) return;
  const stop = await confirm({ title: "Recording…", message: "Reproduce the problem now, then click Stop.", confirmTitle: "Stop", cancelTitle: "Discard" });
  const path = await cef.endTracing(stop.confirmed);
  if (path) void revealFile(path);
}

// MARK: Handoff

/** Each window advertises its selected tab's page (never incognito ones). */
function startHandoff() {
  const last = new Map<string, string>();
  const sync = (s: BrowserState) => {
    for (const id of s.windowOrder) {
      const w = s.windows[id]!;
      const tabId = activeTabId(s, id);
      const tab = tabId ? s.tabs[tabId] : undefined;
      const url = !w.incognito && tab?.url && /^https?:/i.test(tab.url) ? tab.url : null;
      const title = tab ? tab.customTitle || tab.title : "";
      const key = `${url}\n${title}`;
      if (last.get(id) === key) continue;
      last.set(id, key);
      void setWindowActivity(id, url, title || null);
    }
    for (const id of last.keys()) if (!s.windows[id]) last.delete(id);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  useBrowser.subscribe((s, prev) => {
    if (s.tabs === prev.tabs && s.windows === prev.windows) return;
    timer ??= setTimeout(() => {
      timer = undefined;
      sync(useBrowser.getState());
    }, 250);
  });
  // Windows open asynchronously at launch.
  setTimeout(() => sync(useBrowser.getState()), 1000);
}

// MARK: AppleScript

function scriptState(s: BrowserState): ScriptState {
  return {
    windows: s.windowOrder.map((id) => {
      const w = s.windows[id]!;
      return {
        id,
        title: windowTitle(s, id),
        profileId: w.profileId,
        incognito: w.incognito,
        activeTabId: activeTabId(s, id) ?? null,
        tabs: viewTabIds(s, id).map((tabId) => {
          const t = s.tabs[tabId]!;
          return {
            id: tabId,
            title: t.customTitle || t.title,
            url: t.url,
            loading: !!s.live[tabId]?.isLoading,
            pinned: t.pinned,
          };
        }),
      };
    }),
    profiles: s.profileOrder.map((id) => ({ id, name: s.profiles[id]!.name })),
  };
}

function startScripting() {
  let lastJson = "";
  const push = () => {
    const state = scriptState(useBrowser.getState());
    const json = JSON.stringify(state);
    if (json === lastJson) return Promise.resolve();
    lastJson = json;
    return setScriptState(state);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  useBrowser.subscribe((s, prev) => {
    if (s.tabs === prev.tabs && s.windows === prev.windows && s.live === prev.live && s.profiles === prev.profiles) return;
    timer ??= setTimeout(() => {
      timer = undefined;
      void push();
    }, 100);
  });
  void push();

  onScriptCommand((request) => {
    let result: Record<string, unknown> | null = null;
    Promise.resolve()
      .then(async () => {
        result = (await runScriptCommand(request)) ?? {};
      })
      .then(
        // The script's next line must see the change: push the new state before replying.
        () => push().then(() => replyToScript(request.id, result)),
        (error: unknown) => push().then(() => replyToScript(request.id, null, error instanceof Error ? error.message : String(error))),
      );
  });
}

/** Runs one AppleScript request against the store; throws with a message the script shows. */
async function runScriptCommand(request: ScriptCommand): Promise<Record<string, unknown> | void> {
  const s = useBrowser.getState();
  const tabOf = (tabId: string) => {
    const tab = s.tabs[tabId];
    if (!tab) throw new Error("That tab no longer exists.");
    return tab;
  };
  const loaded = (tabId: string) => {
    const web = webviews.get(tabId);
    if (!web) throw new Error("The tab hasn't loaded yet; focus it first.");
    return web;
  };
  switch (request.command) {
    case "newWindow": {
      const windowId = openWindow({ url: request.url, incognito: request.incognito, profileId: request.profileId });
      return { windowId };
    }
    case "newTab": {
      const windowId = resolveWindowId(s, request.windowId);
      if (!windowId) {
        const created = openWindow({ url: request.url });
        return { windowId: created, tabId: activeTabId(useBrowser.getState(), created) };
      }
      const view = viewTabIds(s, windowId);
      // Script indexes count the window's visible tabs; the store's count every profile's.
      const w = s.windows[windowId]!;
      let index: number | undefined;
      if (request.index !== undefined) {
        const pinned = view.filter((id) => s.tabs[id]!.pinned).length;
        const at = Math.max(request.index, pinned);
        index = at < view.length ? w.tabIds.indexOf(view[at]!) : w.tabIds.length;
      }
      const tabId = s.newTab(windowId, { url: request.url, index });
      return { windowId, tabId };
    }
    case "setURL":
      tabOf(request.tabId);
      return s.navigate(request.tabId, request.url);
    case "closeTab":
      tabOf(request.tabId);
      return s.closeTab(request.tabId);
    case "closeWindow":
      if (!s.windows[request.windowId]) throw new Error("That window no longer exists.");
      return s.closeWindow(request.windowId);
    case "reload": {
      const tab = tabOf(request.tabId);
      const web = webviews.get(request.tabId);
      if (web) return void (await web.reload());
      if (tab.url) s.navigate(tab.id, tab.url);
      return;
    }
    case "back":
      tabOf(request.tabId);
      return void (await loaded(request.tabId).goBack());
    case "forward":
      tabOf(request.tabId);
      return void (await loaded(request.tabId).goForward());
    case "focusTab":
      tabOf(request.tabId);
      return switchToTab(request.tabId);
    case "setActiveTabIndex": {
      if (!s.windows[request.windowId]) throw new Error("That window no longer exists.");
      if (request.index < 1 || request.index > viewTabIds(s, request.windowId).length) throw new Error("There's no tab at that index.");
      return s.activateIndex(request.windowId, request.index - 1);
    }
    case "focusProfile": {
      const windowId = resolveWindowId(s, null);
      if (!s.profiles[request.profileId]) throw new Error("That profile no longer exists.");
      if (!windowId || s.windows[windowId]!.incognito) throw new Error("There's no window to show the profile in.");
      return switchProfile(windowId, request.profileId);
    }
    case "execute": {
      tabOf(request.tabId);
      const outcome = await loaded(request.tabId).evaluate<{ value?: string; error?: string }>(executeWrapper(request.code));
      if (!outcome) throw new Error("The page didn't answer.");
      if (outcome.error) throw new Error(outcome.error);
      return { value: outcome.value ?? "" };
    }
  }
}

/**
 * Runs AppleScript's JavaScript in the page's main world like Chrome's `execute`: the value
 * of the last expression (awaited if it's a promise), as text.
 */
function executeWrapper(code: string) {
  return `
const text = (v) => {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  try { const json = JSON.stringify(v); return json === undefined ? String(v) : json; } catch { return String(v); }
};
let value;
try { value = (0, eval)(${JSON.stringify(code)}); } catch (e) { post("result", JSON.stringify({ error: String(e) })); return; }
Promise.resolve(value).then(
  (v) => post("result", JSON.stringify({ value: text(v) })),
  (e) => post("result", JSON.stringify({ error: String(e) })),
);`;
}
