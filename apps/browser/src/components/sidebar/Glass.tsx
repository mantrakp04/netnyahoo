import { ContextMenuArea, GlassEffect } from "@netnyahoo/shell";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useActiveTab, useTabLive, useWindowId } from "../../store/hooks";
import { clearableTabs } from "../../store/organize";
import { plural } from "../../store/model";
import type { Tab } from "../../store/types";
import { useHistoryAvailability } from "../layout/history";
import { showToast } from "../layout/splitActions";
import { ToolbarButton } from "../layout/controls";
import { toolbarPalette } from "../layout/toolbarColors";
import { IconButton } from "../primitives";
import { copyPageUrl } from "../site/selection";
import { HistoryButton } from "../Toolbar";
import { openOverflowMenu } from "./menus";
import { useSidebarTokens } from "./tokens";

/*
 * Settings › Appearance › Sidebar Style "Liquid Glass": Arc's sidebar on macOS 26's Liquid Glass.
 * The glass is AppKit's (GlassEffect: NSGlassEffectView, the sidebar material before macOS 26), laid
 * under the sidebar's transparent React views; the rows and tiles take the glass variant of the theme
 * (lib/theme GLASS). Measurements are from the reference capture, in our row pitch (37 pt).
 */

/**
 * The glass behind the sidebar, tinted toward the profile colour like Dia's window tint (Personal plum,
 * Work slate), but subtly: the tint's own strength (0.36, neutral 0.12) halved.
 */
export function SidebarGlass({ cornerRadius, style }: { cornerRadius?: number; style: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const { tintColor, tintAlpha } = theme.backdrop;
  const alpha = Math.round(tintAlpha * 0.5 * 255)
    .toString(16)
    .padStart(2, "0");
  return <GlassEffect pointerEvents="none" cornerRadius={cornerRadius} tint={`${tintColor.slice(0, 7)}${alpha}`} dark={theme.dark} style={style} />;
}

/** The traffic lights' centre (Dia's, 26.75 pt down): Arc's header buttons line up with it. */
const LIGHTS_Y = 26.75;
/** The reference's back / forward / link: 13 pt glyphs on a 24.4 pt pitch, the last centred 18 pt in. */
const BOX = 26;
const PITCH = 24;
const LAST_X = 18;

/** Arc's header: back, forward and Copy URL right-aligned in the traffic lights' row. */
export function GlassHeaderTools() {
  const tab = useActiveTab();
  if (!tab) return null;
  return (
    <View style={{ position: "absolute", top: LIGHTS_Y - BOX / 2, right: LAST_X - BOX / 2, flexDirection: "row", gap: PITCH - BOX }}>
      <HeaderButtons tab={tab} />
    </View>
  );
}

// The buttons act on the active tab, so there's no pane to focus first.
const alreadyFocused = () => {};

function HeaderButtons({ tab }: { tab: Tab }) {
  const palette = toolbarPalette(useTheme(), null);
  const live = useTabLive(tab.id);
  const history = useHistoryAvailability(tab.id, live);
  return (
    <>
      <HistoryButton tab={tab} direction={-1} disabled={!history.back} palette={palette} onFocus={alreadyFocused} compact />
      <HistoryButton tab={tab} direction={1} disabled={!history.forward} palette={palette} onFocus={alreadyFocused} compact />
      <ToolbarButton
        palette={palette}
        icon="link"
        size={13}
        box={BOX}
        radius={6}
        disabled={!tab.url}
        onPress={() => void copyPageUrl(tab.id)}
        tooltip="Copy URL (⇧⌘C)"
      />
    </>
  );
}

/** The divider's buttons: 20 pt boxes, the trash centred 8 pt in from the list's edge, + 18 pt before it. */
const DIVIDER_BOX = 20;

/**
 * Arc's divider between the pinned part of the sidebar and today's tabs: a hairline, then + (a new
 * tab) and Clear, which closes the unpinned tabs into Recently Cleaned with an Undo
 * toast. Right-click: the open and recently closed tabs (the New Tab row's ⌄ in Dia's style).
 */
export function GlassDivider() {
  const windowId = useWindowId();
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const clearable = useBrowser((s) => clearableTabs(s, windowId).length);
  const clear = () => {
    const s = useBrowser.getState();
    const cleared = s.clearTabs(windowId);
    if (!cleared.length) return;
    showToast(windowId, `Cleared ${plural(cleared.length, "Tab")}`, undefined, {
      icon: "trash",
      action: { title: "Undo", run: () => useBrowser.getState().restoreCleaned(cleared) },
    });
  };
  return (
    <ContextMenuArea onContextMenu={() => void openOverflowMenu(windowId)}>
      <View style={{ height: DIVIDER_BOX, flexDirection: "row", alignItems: "center", paddingLeft: 8, paddingRight: 2 }}>
        <View style={{ flex: 1, height: StyleSheet.hairlineWidth, marginRight: 3, backgroundColor: tokens.separator }} />
        <View style={{ flexDirection: "row", gap: -2 }}>
          <IconButton
            icon="plus"
            size={11}
            weight="medium"
            box={DIVIDER_BOX}
            radius={5}
            color={theme.textTertiary}
            tooltip="New Tab (⌘T)"
            onPress={() => useBrowser.getState().newTab(windowId)}
          />
          <IconButton
            icon="trash"
            size={10}
            box={DIVIDER_BOX}
            radius={5}
            disabled={!clearable}
            color={clearable ? theme.textTertiary : theme.iconDisabled}
            tooltip="Clear Unpinned Tabs"
            onPress={clear}
          />
        </View>
      </View>
    </ContextMenuArea>
  );
}
