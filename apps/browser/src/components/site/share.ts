import { cleanUrl } from "@arcadia/core";
import { sharePage, sharePageVia, type ShareAnchor } from "@arcadia/shell";
import type { Tab } from "../../store/types";

export const canShare = (tab: Pick<Tab, "url"> | undefined) => /^https?:/i.test(tab?.url ?? "");

// Shares a web page's link without trackers (as Copy Clean Link copies it) and its title: through `via`, a service a
// Share menu listed, else the share sheet at `anchor`. Resolves once the sheet closes.
export async function shareTab(tab: Pick<Tab, "url" | "title" | "customTitle"> | undefined, windowId: string, via?: string | null, anchor?: ShareAnchor) {
  if (!tab || !canShare(tab)) return;
  const url = cleanUrl(tab.url);
  const title = tab.customTitle || tab.title || null;
  return via ? sharePageVia(via, url, title, windowId) : sharePage(url, title, windowId, anchor);
}
