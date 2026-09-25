import { terminateCastRoute, type CastRoute, type InstalledExtension } from "@netnyahoo/cef";
import { ContextMenuArea, showMenu, Symbol } from "@netnyahoo/shell";
import { useMemo, useRef } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { toggleCastPicker, useCastRoutes } from "../media/cast";
import type { ToolbarPalette } from "../layout/toolbarColors";
import { usePages } from "../layout/pageState";
import { useHover } from "../primitives";
import { toolbarAnchors } from "./bridge";
import {
  activateExtension,
  extensionProfile,
  openManageExtensions,
  openPinDialog,
  openWebStore,
  showExtensionMenu,
  useExtensionList,
  useExtensions,
  type Anchor,
} from "./state";

const BUTTON = 28;

/** Pinned extensions (enabled ones, in Chrome's pin order = name order here) and whether any aren't pinned. */
function useToolbarExtensions(windowId: string) {
  const profile = useBrowser((s) => extensionProfile(s, windowId));
  const list = useExtensionList(profile);
  return useMemo(() => {
    const enabled = list.filter((x) => x.enabled);
    return { pinned: enabled.filter((x) => x.pinned), overflow: enabled.some((x) => !x.pinned) };
  }, [list]);
}

/** Width the toolbar reserves at its right end for the extension (and cast) buttons. */
export function useToolbarExtensionsWidth(windowId: string): number {
  const { pinned, overflow } = useToolbarExtensions(windowId);
  const casting = useCastRoutes(windowId).length > 0;
  const count = pinned.length + (overflow ? 1 : 0) + (casting ? 1 : 0);
  return count ? count * BUTTON + 6 : 0;
}

/**
 * The toolbar's extension buttons: each pinned extension's action (icon, badge,
 * popup) and, when some aren't pinned, the Extensions button listing them all.
 */
export function ToolbarExtensions({
  tabId,
  windowId,
  palette,
  top,
  right,
}: {
  tabId: string;
  windowId: string;
  palette: ToolbarPalette;
  top: number;
  right: number;
}) {
  const { pinned, overflow } = useToolbarExtensions(windowId);
  const routes = useCastRoutes(windowId);
  const browserId = usePages((p) => {
    for (const [id, tab] of Object.entries(p.browsers)) if (tab === tabId) return Number(id);
    return 0;
  });
  if (!pinned.length && !overflow && !routes.length) return null;
  return (
    <View style={{ position: "absolute", top, right, flexDirection: "row" }}>
      {routes.length ? <CastButton windowId={windowId} routes={routes} palette={palette} /> : null}
      {pinned.map((ext) => (
        <ExtensionButton key={ext.id} ext={ext} windowId={windowId} browserId={browserId} palette={palette} />
      ))}
      {overflow && <OverflowButton windowId={windowId} palette={palette} />}
    </View>
  );
}

function useAnchor(key: string) {
  const ref = useRef<View>(null);
  const measure = () =>
    new Promise<Anchor>((resolve) => {
      const view = ref.current;
      if (!view) return resolve({ x: 0, y: 0, width: BUTTON, height: BUTTON });
      view.measureInWindow((x, y, width, height) => {
        const anchor = { x, y, width, height };
        toolbarAnchors.set(key, anchor);
        resolve(anchor);
      });
    });
  return { ref, measure };
}

function ExtensionButton({ ext, windowId, browserId, palette }: { ext: InstalledExtension; windowId: string; browserId: number; palette: ToolbarPalette }) {
  const state = useExtensions((e) => (browserId ? e.actions[browserId]?.[ext.id] : undefined));
  const open = useExtensions((e) => e.popup?.windowId === windowId && e.popup.extensionId === ext.id);
  const { hovered, hoverProps } = useHover();
  const { ref, measure } = useAnchor(`${windowId}|${ext.id}`);
  const badge = state?.badgeText ?? "";
  const dimmed = state ? !state.enabled : false;
  const title = state?.title || ext.actionTitle || ext.name;
  // action.setIcon's image for this tab, else the manifest's.
  const icon = state?.icon || ext.actionIcon || ext.icon;
  return (
    <View ref={ref} tooltip={title} {...hoverProps} onLayout={() => void measure()}>
      <ContextMenuArea onContextMenu={() => void showExtensionMenu(windowId, ext)}>
        <Pressable onPress={async () => activateExtension(windowId, ext, await measure(), state)}>
          {({ pressed }) => (
            <View
              style={{
                width: BUTTON,
                height: BUTTON,
                borderRadius: 7,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: pressed || open ? palette.pressed : hovered ? palette.hover : undefined,
              }}
            >
              {icon ? (
                <Image source={{ uri: icon }} style={{ width: 16, height: 16, opacity: dimmed ? 0.45 : 1 }} />
              ) : (
                <Symbol name="puzzlepiece.extension" size={14} color={palette.icon} style={{ width: 18, height: 18 }} />
              )}
              {badge ? <Badge text={badge} color={state?.badgeColor} textColor={state?.badgeTextColor} /> : null}
            </View>
          )}
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}

/** Chrome's badge: a small rounded label over the icon's bottom-right corner (max 4 characters). */
function Badge({ text, color, textColor }: { text: string; color?: string | null; textColor?: string | null }) {
  const fill = color && color !== "#000000" ? color : "#5F6368";
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        right: 1,
        bottom: 3,
        minWidth: 13,
        height: 11,
        paddingHorizontal: 2.5,
        borderRadius: 3,
        backgroundColor: fill,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text numberOfLines={1} style={{ fontSize: 8.5, lineHeight: 11, fontWeight: "700", color: textColor ?? contrastText(fill) }}>
        {text.slice(0, 4)}
      </Text>
    </View>
  );
}

function contrastText(hex: string) {
  const n = parseInt(hex.slice(1, 7), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#000000" : "#FFFFFF";
}

/**
 * Chrome's cast toolbar state: while something casts from this profile, a highlighted cast
 * button. Click: the Cast picker for the page; the menu (right-click) stops a cast.
 */
function CastButton({ windowId, routes, palette }: { windowId: string; routes: CastRoute[]; palette: ToolbarPalette }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const tooltip = routes.map((r) => (r.description ? `${r.description} on ${r.sink}` : `Casting to ${r.sink}`)).join("\n");
  const menu = async () => {
    const choice = await showMenu([
      ...routes.map((r) => ({ id: `stop:${r.id}`, title: `Stop Casting to ${r.sink}`, symbol: "stop.circle" })),
      { separator: true as const },
      { id: "open", title: "Cast…", symbol: "tv.and.mediabox" },
    ]);
    if (choice === "open") void toggleCastPicker(windowId);
    else if (choice?.startsWith("stop:")) void terminateCastRoute(choice.slice(5));
  };
  return (
    <View tooltip={tooltip} {...hoverProps}>
      <ContextMenuArea onContextMenu={() => void menu()}>
        <Pressable onPress={() => void toggleCastPicker(windowId)}>
          {({ pressed }) => (
            <View
              style={{
                width: BUTTON,
                height: BUTTON,
                borderRadius: 7,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: pressed ? palette.pressed : hovered ? palette.hover : undefined,
              }}
            >
              <Symbol name="tv.and.mediabox.fill" size={14} color={theme.accent} style={{ width: 18, height: 18 }} />
            </View>
          )}
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}

/** Lists every extension (open its popup), then Pin / Manage Extensions. */
function OverflowButton({ windowId, palette }: { windowId: string; palette: ToolbarPalette }) {
  const { hovered, hoverProps } = useHover();
  const { ref, measure } = useAnchor(`${windowId}|*`);
  const onPress = async () => {
    const anchor = await measure();
    const s = useBrowser.getState();
    const list = useExtensions.getState().lists[extensionProfile(s, windowId)] ?? [];
    const enabled = list.filter((x) => x.enabled);
    // Dia's extensions menu: the extensions, then Pin / Manage / Add.
    const choice = await showMenu([
      ...enabled.map((x) => ({ id: `open:${x.id}`, title: x.name, symbol: x.pinned ? "pin.fill" : undefined })),
      ...(enabled.length ? [{ separator: true as const }] : []),
      { id: "pin", title: "Pin Extensions…", symbol: "pin" },
      { id: "manage", title: "Manage Extensions…", symbol: "puzzlepiece.extension" },
      { id: "add", title: "Add Extension…", symbol: "plus" },
    ]);
    if (choice === "pin") return openPinDialog(windowId);
    if (choice === "manage") return openManageExtensions();
    if (choice === "add") return openWebStore(windowId);
    const ext = choice?.startsWith("open:") ? enabled.find((x) => x.id === choice.slice(5)) : undefined;
    if (ext) void activateExtension(windowId, ext, anchor);
  };
  return (
    <View ref={ref} tooltip="Extensions" {...hoverProps} onLayout={() => void measure()}>
      <Pressable onPress={onPress}>
        {({ pressed }) => (
          <View
            style={{
              width: BUTTON,
              height: BUTTON,
              borderRadius: 7,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? palette.pressed : hovered ? palette.hover : undefined,
            }}
          >
            <Symbol name="puzzlepiece.extension" size={14} color={palette.icon} style={{ width: 18, height: 18 }} />
          </View>
        )}
      </Pressable>
    </View>
  );
}
