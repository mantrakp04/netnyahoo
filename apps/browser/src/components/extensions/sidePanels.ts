import { extensionSidePanelUrl } from "@netnyahoo/nncore";
import { useBrowser } from "../../store/browser";
import { activeBrowserId, extensionProfile, isPrivate, pageProfile, shownIn, useExtensions } from "./store";

// Which extension's side panel each window wants, set the moment it is asked for: a second click while the first is
// still fetching the panel's page closes it again. What the window shows (useExtensions.sidePanels) follows from that
// and its active tab, through one fetch per window at a time: a newer fetch drops an older one's answer, so A→B→A
// ends on A's page whatever order Chrome answers in.
const wanted = new Map<string, string>();
const fetches = new Map<string, number>();

const nextFetch = (windowId: string) => {
  const ticket = (fetches.get(windowId) ?? 0) + 1;
  fetches.set(windowId, ticket);
  return ticket;
};

/** [windowId, extensionId] of each side panel open or opening. */
export const wantedSidePanels = () => [...wanted];

export function openSidePanel(windowId: string, extensionId: string): Promise<void> {
  if (!shownIn(windowId, extensionId)) return Promise.resolve();
  wanted.set(windowId, extensionId);
  return syncSidePanel(windowId);
}

export function closeSidePanel(windowId: string, extensionId?: string) {
  const id = wanted.get(windowId);
  if (!id || (extensionId && id !== extensionId)) return;
  wanted.delete(windowId);
  nextFetch(windowId);
  if (!useExtensions.getState().sidePanels[windowId]) return;
  useExtensions.setState((e) => {
    const sidePanels = { ...e.sidePanels };
    delete sidePanels[windowId];
    return { sidePanels };
  });
}

export function toggleSidePanel(windowId: string, extensionId: string): Promise<void> | void {
  if (wanted.get(windowId) === extensionId) closeSidePanel(windowId);
  else return openSidePanel(windowId, extensionId);
}

export function closeSidePanelsOf(extensionId: string) {
  for (const [windowId, id] of wanted) if (id === extensionId) closeSidePanel(windowId);
}

/** Shows the wanted panel's page for the window's active tab (Chrome's answer for the tab can differ per tab). */
export async function syncSidePanel(windowId: string): Promise<void> {
  const extensionId = wanted.get(windowId);
  if (!extensionId) return;
  const ticket = nextFetch(windowId);
  const browserId = activeBrowserId(windowId);
  const shown = useExtensions.getState().sidePanels[windowId];
  // A tab whose page isn't there yet keeps the panel as it is.
  if (!browserId && shown?.extensionId === extensionId) return;
  const ext = shownIn(windowId, extensionId);
  // Chrome's answer for the tab is final; the manifest's path is only for a window without a tab.
  const url = !ext
    ? null
    : browserId
      ? await extensionSidePanelUrl(browserId, extensionId)
      : !isPrivate(useBrowser.getState(), windowId) && ext.sidePanel
        ? `chrome-extension://${extensionId}/${ext.sidePanel.replace(/^\//, "")}`
        : null;
  if (fetches.get(windowId) !== ticket) return;
  if (!url || !shownIn(windowId, extensionId)) return closeSidePanel(windowId);
  // The window may show another profile now: the panel's page runs in that profile's copy of the extension.
  const s = useBrowser.getState();
  const panel = { extensionId, profile: extensionProfile(s, windowId), pageProfile: pageProfile(s, windowId), url };
  const now = useExtensions.getState().sidePanels[windowId];
  if (now && now.extensionId === panel.extensionId && now.url === url && now.profile === panel.profile && now.pageProfile === panel.pageProfile) return;
  useExtensions.setState((e) => ({ sidePanels: { ...e.sidePanels, [windowId]: panel } }));
}
