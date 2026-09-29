import { ContextMenuArea, GlassEffect } from "@netnyahoo/shell";
import { useMemo } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useActiveTab, useTabLive, useWindowId } from "../../store/hooks";
import { clearableTabs } from "../../store/organize";
import { plural } from "../../store/model";
import type { Tab } from "../../store/types";
import { useHistoryAvailability } from "../layout/history";
import { GLASS_LIGHTS } from "../layout/windowLayout";
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
 * (lib/theme GLASS). Measurements are from the reference capture (1.8 px per pt).
 */

/** Liquid Glass: rows on a 39 pt pitch (the reference's), Dia's 34 pt rows 5 apart. */
export const GLASS_ROW_GAP = 5;
/** Liquid Glass: the reference's tiles are 42 pt tall (57 wide at its 193 pt sidebar, 6 apart). */
export const GLASS_TILE_HEIGHT = 42;

/**
 * The reference's frost: a light, neutral, cool grey (≈ #D1D4D9) whatever the wallpaper, so the glass
 * carries a neutral wash that leaves the desktop a faint presence (15%), and no profile tint (the
 * profile shows in its dots). Dark: the same wash in a neutral dark grey.
 */
const WASH = { light: "rgba(205,207,212,0.85)", dark: "rgba(46,47,51,0.85)" };

/**
 * The glass behind the sidebar. `bleed`: it reaches this far past the window's top, left and bottom
 * edges, where the glass's own edge shading (a dark band, a highlight line) is clipped away. Its edge
 * beside the page stays: under the wash that shading is under a level.
 */
export function SidebarGlass({ cornerRadius, bleed = 0, style }: { cornerRadius?: number; bleed?: number; style: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const fill = { position: "absolute", top: -bleed, left: -bleed, bottom: -bleed, right: 0 } as const;
  return (
    <View pointerEvents="none" style={style}>
      <GlassEffect cornerRadius={cornerRadius} dark={theme.dark} style={fill} />
      <View style={[fill, { borderRadius: cornerRadius, backgroundColor: theme.dark ? WASH.dark : WASH.light }]} />
    </View>
  );
}

/** The reference's back / forward / link: 13 pt glyphs on a 24.4 pt pitch, the last centred 18 pt in. */
const BOX = 26;
const PITCH = 24;
const LAST_X = 18;
/** The reference's header glyphs on its glass: enabled 86 (the link), disabled 160 (back, forward). */
const HEADER_ICON = { light: ["rgba(0,0,0,0.59)", "rgba(0,0,0,0.24)"], dark: ["rgba(255,255,255,0.6)", "rgba(255,255,255,0.25)"] };

/** Arc's header: back, forward and Copy URL right-aligned in the traffic lights' row. */
export function GlassHeaderTools() {
  const tab = useActiveTab();
  if (!tab) return null;
  return (
    <View style={{ position: "absolute", top: GLASS_LIGHTS.y - BOX / 2, right: LAST_X - BOX / 2, flexDirection: "row", gap: PITCH - BOX }}>
      <HeaderButtons tab={tab} />
    </View>
  );
}

// The buttons act on the active tab, so there's no pane to focus first.
const alreadyFocused = () => {};

function HeaderButtons({ tab }: { tab: Tab }) {
  const theme = useTheme();
  const [icon, iconDisabled] = HEADER_ICON[theme.dark ? "dark" : "light"];
  const base = toolbarPalette(theme, null);
  const palette = useMemo(() => ({ ...base, icon: icon!, iconDisabled: iconDisabled! }), [base, icon, iconDisabled]);
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
/** The reference's + (114) and trash (126) on its glass. */
const DIVIDER_ICON = { light: "rgba(0,0,0,0.43)", dark: "rgba(255,255,255,0.45)" };

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
            color={theme.dark ? DIVIDER_ICON.dark : DIVIDER_ICON.light}
            tooltip="New Tab (⌘T)"
            onPress={() => useBrowser.getState().newTab(windowId)}
          />
          <IconButton
            icon="trash"
            size={10}
            box={DIVIDER_BOX}
            radius={5}
            disabled={!clearable}
            color={clearable ? (theme.dark ? DIVIDER_ICON.dark : DIVIDER_ICON.light) : theme.iconDisabled}
            tooltip="Clear Unpinned Tabs"
            onPress={clear}
          />
        </View>
      </View>
    </ContextMenuArea>
  );
}
