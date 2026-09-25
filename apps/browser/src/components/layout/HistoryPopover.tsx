import { MouseArea, Symbol } from "@netnyahoo/shell";
import { useEffect, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { openModeFor, openUrl } from "../bookmarks/actions";
import { openInternalPage } from "../pages/urls";
import { Favicon, NewTabIcon, useHover } from "../primitives";
import { modifiersOf, Popover, PopoverSeparator } from "./controls";
import { closeHistoryMenu, goToHistoryItem, useHistoryMenu, type HistoryItem } from "./history";

const WIDTH = 300;

/**
 * The back / forward list (press-and-hold or right-click on the toolbar's arrows), as
 * our own popover rather than an NSMenu so entries open like links: click goes there,
 * ⌘-click or middle-click opens a background tab (the list stays open for more),
 * ⇧⌘ a foreground tab, ⇧ a new window. "Show Full History" closes it, like Chrome's.
 */
export function HistoryPopover({ tabId, windowId, anchors }: { tabId: string; windowId: string; anchors: { back: number; forward: number } }) {
  const menu = useHistoryMenu((s) => (s.menu?.tabId === tabId ? s.menu : null));
  const profileId = useBrowser((s) => s.tabs[tabId]?.profileId ?? "");
  const favicons = useMemo(() => {
    if (!menu) return new Map<string, string | null>();
    const history = useBrowser.getState().history[profileId] ?? [];
    const urls = new Set(menu.items.map((i) => i.url));
    return new Map(history.filter((h) => urls.has(h.url)).map((h) => [h.url, h.favicon]));
  }, [menu, profileId]);
  // Leaving the tab (or closing it) closes its list.
  useEffect(() => () => void (useHistoryMenu.getState().menu?.tabId === tabId && closeHistoryMenu()), [tabId]);
  if (!menu) return null;

  const open = (item: HistoryItem, e: { metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; middle?: boolean }) => {
    const mode = openModeFor(e);
    if (mode === "current" || mode === "split" || !item.url) {
      closeHistoryMenu();
      return void goToHistoryItem(tabId, item);
    }
    if (mode !== "background") closeHistoryMenu();
    openUrl(item.url, windowId, mode);
  };

  return (
    <Popover width={WIDTH} top={2} left={Math.max(6, (menu.direction < 0 ? anchors.back : anchors.forward) - 15)} onDismiss={closeHistoryMenu}>
      <View style={{ paddingVertical: 5 }}>
        {menu.items.map((item) => (
          <Row key={item.key} item={item} favicon={favicons.get(item.url) ?? null} onOpen={(e) => open(item, e)} />
        ))}
        <PopoverSeparator />
        <ActionRow
          icon="clock"
          title="Show Full History"
          onPress={() => {
            closeHistoryMenu();
            openInternalPage("history", windowId);
          }}
        />
      </View>
    </Popover>
  );
}

function RowFrame({ children, hovered, pressed }: { children: React.ReactNode; hovered: boolean; pressed: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={{
        height: 30,
        marginHorizontal: 5,
        paddingHorizontal: 8,
        borderRadius: 7,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
        backgroundColor: pressed || hovered ? (theme.dark ? `rgba(255,255,255,${pressed ? 0.12 : 0.07})` : `rgba(0,0,0,${pressed ? 0.1 : 0.06})`) : undefined,
      }}
    >
      {children}
    </View>
  );
}

function Row({
  item,
  favicon,
  onOpen,
}: {
  item: HistoryItem;
  favicon: string | null;
  onOpen: (e: { metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; middle?: boolean }) => void;
}) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} tooltip={item.url || undefined}>
      <MouseArea onMiddleClick={(e) => onOpen({ ...e, middle: true })}>
        <Pressable onPress={(e) => onOpen(modifiersOf(e))}>
          {({ pressed }) => (
            <RowFrame hovered={hovered} pressed={pressed}>
              {item.offset === "newTab" ? <NewTabIcon size={16} /> : <Favicon url={item.url} favicon={favicon} size={16} />}
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: theme.textPrimary }}>
                {item.title}
              </Text>
            </RowFrame>
          )}
        </Pressable>
      </MouseArea>
    </View>
  );
}

function ActionRow({ icon, title, onPress }: { icon: string; title: string; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress}>
        {({ pressed }) => (
          <RowFrame hovered={hovered} pressed={pressed}>
            <Symbol name={icon} size={13} color={theme.icon} style={{ width: 16, height: 16 }} />
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: theme.textPrimary }}>
              {title}
            </Text>
          </RowFrame>
        )}
      </Pressable>
    </View>
  );
}
