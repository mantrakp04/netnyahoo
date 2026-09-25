import { useRef } from "react";
import { FadeLabel } from "@netnyahoo/shell";
import { Pressable, StyleSheet, View } from "react-native";
import { layout, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useActiveTab, useTabLive, useWindowId } from "../../store/hooks";
import { splitOf } from "../../store/splits";
import type { Tab } from "../../store/types";
import { ToolbarExtensions, useToolbarExtensionsWidth } from "../extensions/ToolbarExtensions";
import { useHistoryAvailability } from "../layout/history";
import { toolbarPalette } from "../layout/toolbarColors";
import { addressBarInSidebar, setUrlAnchor, SIDEBAR_FIELD } from "../layout/windowLayout";
import { focusHeroBar } from "../omnibox/barState";
import { IconButton, useHover } from "../primitives";
import { HistoryButton, ReloadButton, UrlField } from "../Toolbar";

/** Back / forward / reload: the toolbar's buttons, at the trailing end of the traffic-light row. */
export const SIDEBAR_NAV_WIDTH = 3 * layout.toolbarButton;

/*
 * Settings › Appearance › Address Bar "In the sidebar" (Arc's layout). The sidebar header
 * takes the toolbar's back / forward / reload, and a row under it holds the focused page's
 * URL field with the extension buttons and Downloads beside it. Everything acts on the
 * active tab (the focused pane in a split), like the toolbar did.
 */

export function SidebarNavigation() {
  const tab = useActiveTab();
  return tab ? <NavigationButtons tab={tab} /> : <View style={{ width: SIDEBAR_NAV_WIDTH }} />;
}

// The buttons act on the active tab, so there's no pane to focus first.
const alreadyFocused = () => {};

function NavigationButtons({ tab }: { tab: Tab }) {
  const palette = toolbarPalette(useTheme(), null);
  const live = useTabLive(tab.id);
  const history = useHistoryAvailability(tab.id, live);
  return (
    <View style={{ flexDirection: "row" }}>
      <HistoryButton tab={tab} direction={-1} disabled={!history.back} palette={palette} onFocus={alreadyFocused} />
      <HistoryButton tab={tab} direction={1} disabled={!history.forward} palette={palette} onFocus={alreadyFocused} />
      <ReloadButton tab={tab} loading={live.isLoading} palette={palette} onFocus={alreadyFocused} />
    </View>
  );
}

/** The URL field row under the header: the field, the extension buttons, Downloads. */
export function SidebarAddressRow() {
  const windowId = useWindowId();
  const tab = useActiveTab();
  const palette = toolbarPalette(useTheme(), null);
  const extensionsWidth = useToolbarExtensionsWidth(windowId);
  const field = useRef<View>(null);
  // The command panel (field click, ⌘L) opens over the field.
  const anchor = () =>
    field.current?.measureInWindow((x, y, width, height) => {
      if (width && addressBarInSidebar(useBrowser.getState(), windowId)) setUrlAnchor(windowId, { left: x, top: y, width, sidebar: { height } });
    });

  return (
    <View
      style={{
        position: "absolute",
        left: layout.sidebarInset,
        right: layout.sidebarInset,
        top: SIDEBAR_FIELD.top,
        height: SIDEBAR_FIELD.height,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
      }}
    >
      <View ref={field} style={{ flex: 1 }} onLayout={anchor}>
        {tab?.url ? <PageField tab={tab} windowId={windowId} /> : <EmptyField windowId={windowId} />}
      </View>
      {tab && extensionsWidth ? (
        // The toolbar reserves 6pt after its buttons; here the row's gap does that.
        <View style={{ width: extensionsWidth - 6, height: 28 }}>
          <ToolbarExtensions tabId={tab.id} windowId={windowId} palette={palette} top={0} right={0} />
        </View>
      ) : null}
      <IconButton
        icon="arrow.down.circle"
        size={16}
        box={SIDEBAR_FIELD.height}
        radius={10}
        tooltip="Downloads (⇧⌘J)"
        onPress={() => {
          const s = useBrowser.getState();
          s.setDownloadsOpen(windowId, !s.windowUi[windowId]?.downloadsOpen);
        }}
      />
    </View>
  );
}

function PageField({ tab, windowId }: { tab: Tab; windowId: string }) {
  const palette = toolbarPalette(useTheme(), null);
  const live = useTabLive(tab.id);
  const inSplit = useBrowser((s) => !!splitOf(s, tab.id));
  return (
    <UrlField
      tab={tab}
      palette={palette}
      windowId={windowId}
      inSplit={inSplit}
      onFocus={alreadyFocused}
      sidebar={{ height: SIDEBAR_FIELD.height, progress: live.isLoading ? live.progress : null }}
    />
  );
}

/** The New Tab page (or an empty split pane): ⌘L's behaviour, its own bar or the command panel. */
function EmptyField({ windowId }: { windowId: string }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const open = () => {
    if (!focusHeroBar(windowId)) useBrowser.getState().openPanel(windowId, "");
  };
  return (
    <View {...hoverProps}>
      <Pressable onPress={open}>
        <View
          style={{
            height: SIDEBAR_FIELD.height,
            borderRadius: 10,
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: theme.pinnedRestingStroke,
            backgroundColor: hovered ? theme.tabHover : theme.pinnedResting,
            justifyContent: "center",
            paddingLeft: 10,
          }}
        >
          {/* FadeLabel pads its text 2pt on each side. */}
          <FadeLabel text="Search or enter address" fontSize={13} color={theme.placeholder} fadeWidth={14} style={{ height: 18, marginLeft: -2 }} />
        </View>
      </Pressable>
    </View>
  );
}
