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
import { toolbarPalette, type ToolbarPalette } from "../layout/toolbarColors";
import { ToolbarButton } from "../layout/controls";
import { addressBarInSidebar, setUrlAnchor, SIDEBAR_FIELD } from "../layout/windowLayout";
import { focusHeroBar } from "../omnibox/barState";
import { useHover } from "../primitives";
import { HistoryButton, ReloadButton, UrlField } from "../Toolbar";

/**
 * Arc's header, measured in a 2× capture of Arc 1.x (a 228 pt sidebar): the sidebar toggle 27 pt
 * past the last traffic light's centre, then back / forward / reload on a 34 pt pitch with reload's
 * centre 22 pt in from the sidebar's edge. Ours keep Dia's traffic lights and the toolbar's 30 pt
 * buttons 5 pt apart (a 35 pt pitch), 7 pt in from the edge.
 */
const BUTTON = layout.toolbarButton;
const GAP = 5;
const NAV_WIDTH = 3 * BUTTON + 2 * GAP;
/** Dia's traffic lights are centred 26.75 pt down, the last at x 70.75. */
const LIGHTS_Y = 26.75;
const TOGGLE_X = 70.75 + 27;
const EDGE = 7;
/** The toggle needs this much sidebar; narrower, it goes first (⌘S still hides the sidebar). */
const TOGGLE_MIN_WIDTH = TOGGLE_X + BUTTON / 2 + GAP + NAV_WIDTH + EDGE;

/*
 * Settings › Appearance › Address Bar "In the sidebar", laid out like Arc's sidebar in Dia's
 * materials: the header row has the sidebar toggle and back / forward / reload, the URL field
 * under it holds the pinned extension buttons, and Downloads sits in the footer (Sidebar.tsx).
 * Clicking the field (or ⌘L) opens the dropdown from its top-left corner (CommandPanel).
 * Everything acts on the active tab (the focused pane in a split), like the toolbar did.
 */

export function SidebarHeaderTools({ width }: { width: number }) {
  const windowId = useWindowId();
  const tab = useActiveTab();
  const palette = toolbarPalette(useTheme(), null);
  const top = LIGHTS_Y - BUTTON / 2;
  return (
    <>
      {width >= TOGGLE_MIN_WIDTH ? (
        <ToolbarButton
          style={{ position: "absolute", top, left: TOGGLE_X - BUTTON / 2 }}
          palette={palette}
          icon="sidebar.left"
          onPress={() => useBrowser.getState().toggleSidebar(windowId)}
          tooltip="Auto-Hide Tabs (⌘S)"
        />
      ) : null}
      <View style={{ position: "absolute", top, right: EDGE, flexDirection: "row", gap: GAP }}>
        {tab ? <NavigationButtons tab={tab} palette={palette} /> : null}
      </View>
    </>
  );
}

// The buttons act on the active tab, so there's no pane to focus first.
const alreadyFocused = () => {};

function NavigationButtons({ tab, palette }: { tab: Tab; palette: ToolbarPalette }) {
  const live = useTabLive(tab.id);
  const history = useHistoryAvailability(tab.id, live);
  return (
    <>
      <HistoryButton tab={tab} direction={-1} disabled={!history.back} palette={palette} onFocus={alreadyFocused} />
      <HistoryButton tab={tab} direction={1} disabled={!history.forward} palette={palette} onFocus={alreadyFocused} />
      <ReloadButton tab={tab} loading={live.isLoading} palette={palette} onFocus={alreadyFocused} />
    </>
  );
}

/** The URL field under the header, the sidebar's width less its inset. */
export function SidebarAddressRow() {
  const windowId = useWindowId();
  const tab = useActiveTab();
  const field = useRef<View>(null);
  // The dropdown (field click, ⌘L) opens from the field's top-left corner.
  const anchor = () =>
    field.current?.measureInWindow((x, y, width, height) => {
      if (width && addressBarInSidebar(useBrowser.getState(), windowId)) setUrlAnchor(windowId, { left: x, top: y, width, sidebar: { height } });
    });

  return (
    <View
      ref={field}
      onLayout={anchor}
      style={{ position: "absolute", left: layout.sidebarInset, right: layout.sidebarInset, top: SIDEBAR_FIELD.top, height: SIDEBAR_FIELD.height }}
    >
      {tab?.url ? <PageField tab={tab} windowId={windowId} /> : <EmptyField windowId={windowId} />}
    </View>
  );
}

function PageField({ tab, windowId }: { tab: Tab; windowId: string }) {
  const palette = toolbarPalette(useTheme(), null);
  const live = useTabLive(tab.id);
  const inSplit = useBrowser((s) => !!splitOf(s, tab.id));
  const extensionsWidth = useToolbarExtensionsWidth(windowId);
  return (
    <UrlField
      tab={tab}
      palette={palette}
      windowId={windowId}
      inSplit={inSplit}
      onFocus={alreadyFocused}
      sidebar={{
        height: SIDEBAR_FIELD.height,
        progress: live.isLoading ? live.progress : null,
        accessory: extensionsWidth ? (
          // The toolbar reserves 6 pt after its buttons; the field's own padding does that here.
          <View style={{ width: extensionsWidth - 6, height: 28 }}>
            <ToolbarExtensions tabId={tab.id} windowId={windowId} palette={palette} top={0} right={0} />
          </View>
        ) : null,
      }}
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
            borderRadius: SIDEBAR_FIELD.radius,
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
