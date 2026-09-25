import { Action, ActionPanel, closeMainWindow, Icon, List, showToast, Toast } from "@raycast/api";
import { getFavicon, showFailureToast } from "@raycast/utils";
import { closeTab, focusTab, useTabs, type Tab } from "./netnyahoo";
import { hostOf } from "./scripts";

export default function Command() {
  const { isLoading, data, error, revalidate, mutate } = useTabs();
  const windowCount = new Set(data?.map((tab) => tab.windowId)).size;

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search tabs…">
      {error ? (
        <List.EmptyView
          icon={Icon.Warning}
          title="Couldn't read Netnyahoo's tabs"
          description="Is Netnyahoo running, and may Raycast control it (System Settings › Privacy & Security › Automation)?"
        />
      ) : (
        <List.EmptyView icon={Icon.AppWindowList} title="No open tabs" />
      )}
      {data?.map((tab) => (
        <List.Item
          key={`${tab.windowId}-${tab.tabId}`}
          title={tab.title || (tab.url ? hostOf(tab.url) : "New Tab")}
          subtitle={tab.url ? hostOf(tab.url) : undefined}
          keywords={tab.url ? [tab.url] : undefined}
          icon={tab.url ? getFavicon(tab.url, { fallback: Icon.Globe }) : Icon.Plus}
          accessories={[
            ...(tab.isPinned ? [{ icon: Icon.Pin, tooltip: "Pinned" }] : []),
            ...(tab.isFocused && tab.windowIndex === 1 ? [{ tag: "Current" }] : []),
            ...(windowCount > 1 ? [{ text: `Window ${tab.windowIndex}` }] : []),
          ]}
          actions={
            <ActionPanel>
              <Action
                title="Switch to Tab"
                icon={Icon.ArrowRight}
                onAction={async () => {
                  try {
                    await closeMainWindow();
                    await focusTab(tab);
                  } catch (e) {
                    await showFailureToast(e, { title: "Couldn't switch to the tab" });
                  }
                }}
              />
              {tab.url && <Action.CopyToClipboard title="Copy URL" content={tab.url} shortcut={{ modifiers: ["cmd", "shift"], key: "c" }} />}
              <Action
                title="Close Tab"
                icon={Icon.XMarkCircle}
                style={Action.Style.Destructive}
                shortcut={{ modifiers: ["ctrl"], key: "x" }}
                onAction={() => void close(tab)}
              />
              <Action title="Reload Tabs" icon={Icon.ArrowClockwise} shortcut={{ modifiers: ["cmd"], key: "r" }} onAction={revalidate} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );

  async function close(tab: Tab) {
    try {
      await mutate(closeTab(tab), {
        optimisticUpdate: (tabs) => tabs?.filter((t) => !(t.windowId === tab.windowId && t.tabId === tab.tabId)),
      });
      await showToast({ style: Toast.Style.Success, title: "Closed tab" });
    } catch (e) {
      await showFailureToast(e, { title: "Couldn't close the tab" });
    }
  }
}
