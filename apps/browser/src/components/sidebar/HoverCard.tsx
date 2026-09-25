import { FadeLabel, Surface, Symbol } from "@netnyahoo/shell";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { displayUrl } from "@netnyahoo/core";
import { hex, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useIsBookmarked } from "../../store/hooks";
import { activeTabId, bookmarkProfileId } from "../../store/model";
import { awayFromPin, groupLabel } from "../../store/organize";
import { openInSplit } from "../layout/splitActions";
import { CalendarPreview, useIsCalendarTab } from "../live/CalendarPreview";
import { LiveItemCard } from "../live/LiveItemCard";
import { useIsSleeping } from "../../lib/tabLifecycle";
import { useHover } from "../primitives";
import { clickTab, tabTitle } from "./actions";
import { dismissHover, hoverLeave, keepHover } from "./hover";
import { useSidebarUi, type Anchor } from "./state";
import { TabIcon } from "./TabIcon";
import { HoverPlayer, useShowsMiniPlayer } from "../media/HoverPlayer";
import { useMedia, usePictureInPicture } from "../media/state";

const WIDTH = 264;

/**
 * Dia's tab hover card: title, URL and quick actions (pin, bookmark, split
 * with the current tab, back to the pinned page) — or, over a collapsed
 * group, a peek at its tabs.
 */
export function HoverCard({ windowId }: { windowId: string }) {
  const hover = useSidebarUi((u) => (u.hover?.windowId === windowId ? u.hover : null));
  // Pinned tabs playing media get the mini player (components/media).
  const player = useShowsMiniPlayer(hover?.kind === "tab" ? hover.id : undefined);
  // Live Calendar: a pinned calendar tab previews the day (src/live).
  const calendar = useIsCalendarTab(hover?.kind === "tab" ? hover.id : null);
  if (!hover) return null;
  if (hover.kind === "live") return <LiveItemCard id={hover.id} windowId={windowId} anchor={hover.anchor} />;
  if (hover.kind === "tab" && player) return <HoverPlayer tabId={hover.id} windowId={windowId} anchor={hover.anchor} />;
  if (hover.kind === "tab" && calendar) return <CalendarPreview tabId={hover.id} windowId={windowId} anchor={hover.anchor} />;
  return hover.kind === "tab" ? <TabCard tabId={hover.id} windowId={windowId} anchor={hover.anchor} /> : <GroupPeek groupId={hover.id} windowId={windowId} anchor={hover.anchor} />;
}

function Card({ anchor, children }: { anchor: Anchor; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <Surface
      onMouseEnter={keepHover}
      onMouseLeave={hoverLeave}
      fill={hex(theme.panel)}
      cornerRadius={12}
      borderColor={hex(theme.panelBorder)}
      borderWidth={0.5}
      shadowColor="#000000"
      shadowOpacity={theme.panelShadowOpacity * 0.8}
      shadowRadius={16}
      shadowOffset={[0, 6]}
      style={{ position: "absolute", left: anchor.x + anchor.width + 8, top: Math.max(8, anchor.y - 6), width: WIDTH, padding: 10 }}
    >
      {children}
    </Surface>
  );
}

function TabCard({ tabId, windowId, anchor }: { tabId: string; windowId: string; anchor: Anchor }) {
  const theme = useTheme();
  const tab = useBrowser((s) => s.tabs[tabId]);
  const isActive = useBrowser((s) => activeTabId(s, windowId) === tabId);
  const bookmarked = useIsBookmarked(tab?.url ?? "");
  // A PiP window can be open without a session (Meet's Document PiP).
  const video = useMedia((m) => !!m.sessions[tabId]?.hasVideo || !!m.pipOpen[tabId]);
  const [pip, togglePip] = usePictureInPicture(tabId);
  const sleeping = useIsSleeping(tabId);
  if (!tab) return null;
  const s = () => useBrowser.getState();
  const away = awayFromPin(tab);
  return (
    <Card anchor={anchor}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <TabIcon tabId={tabId} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} />
        <FadeLabel text={tabTitle(tab)} fontSize={13} weight="medium" color={theme.textPrimary} style={{ flex: 1, height: 18 }} />
      </View>
      {tab.url ? (
        <Text numberOfLines={2} style={{ marginTop: 4, fontSize: 11.5, lineHeight: 15, color: theme.textSecondary }}>
          {displayUrl(tab.url)}
        </Text>
      ) : null}
      {sleeping ? (
        // Put to sleep to save memory (lib/tabLifecycle); Dia's wording.
        <View accessible accessibilityLabel="Web content has been discarded" style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}>
          <Symbol name="moon.zzz" size={10} color={theme.textTertiary} style={{ width: 14, height: 14 }} />
          <Text style={{ fontSize: 11.5, color: theme.textTertiary }}>This tab needs to reload</Text>
        </View>
      ) : null}
      {away && tab.pinnedUrl ? (
        <Text numberOfLines={1} style={{ marginTop: 2, fontSize: 11.5, color: theme.textTertiary }}>
          Pinned: {displayUrl(tab.pinnedUrl)}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", gap: 4, marginTop: 8 }}>
        <Action icon={tab.pinned ? "pin.slash" : "pin"} label={tab.pinned ? "Unpin" : "Pin"} onPress={() => s().togglePin(tabId)} />
        {tab.url ? (
          <Action
            icon={bookmarked ? "bookmark.fill" : "bookmark"}
            label={bookmarked ? "Bookmarked" : "Bookmark"}
            onPress={() => s().toggleBookmark(bookmarkProfileId(s(), s().windows[windowId]), { url: tab.url, title: tabTitle(tab), favicon: tab.favicon })}
          />
        ) : null}
        {!isActive && !tab.pinned ? (
          <Action
            icon="rectangle.split.2x1"
            label="Split"
            onPress={() => {
              dismissHover();
              openInSplit(tabId);
            }}
          />
        ) : null}
        {video ? <Action icon={pip ? "pip.exit" : "pip.enter"} label={pip ? "Exit PiP" : "PiP"} onPress={togglePip} /> : null}
        {away ? (
          <Action
            icon="arrow.uturn.backward"
            label="Reset"
            onPress={() => {
              dismissHover();
              s().returnToPinnedUrl(tabId);
            }}
          />
        ) : null}
      </View>
    </Card>
  );
}

function Action({ icon, label, onPress }: { icon: string; label: string; onPress(): void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} style={{ flex: 1 }}>
      <Pressable onPress={onPress}>
        {({ pressed }) => (
          <View
            style={{
              height: 44,
              borderRadius: 8,
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
              backgroundColor: pressed ? theme.toolbarPressed : hovered ? theme.toolbarHover : theme.urlPill,
            }}
          >
            <Symbol name={icon} size={13} color={theme.icon} style={{ width: 18, height: 16 }} />
            <Text style={{ fontSize: 10.5, color: theme.textSecondary }}>{label}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const PEEK_ROWS = 8;

function GroupPeek({ groupId, windowId, anchor }: { groupId: string; windowId: string; anchor: Anchor }) {
  const theme = useTheme();
  const group = useBrowser((s) => s.groups[groupId]);
  const label = useBrowser((s) => (s.groups[groupId] ? groupLabel(s, s.groups[groupId]!) : ""));
  if (!group) return null;
  const more = group.tabIds.length - PEEK_ROWS;
  return (
    <Card anchor={anchor}>
      <Text style={{ fontSize: 12, fontWeight: "600", color: theme.textSecondary, marginBottom: 4, marginLeft: 4 }}>
        {label} · {group.tabIds.length === 1 ? "1 tab" : `${group.tabIds.length} tabs`}
      </Text>
      {group.tabIds.slice(0, PEEK_ROWS).map((id) => (
        <PeekRow key={id} tabId={id} windowId={windowId} />
      ))}
      {more > 0 ? <Text style={{ fontSize: 11.5, color: theme.textTertiary, marginTop: 4, marginLeft: 4 }}>and {more} more</Text> : null}
    </Card>
  );
}

function PeekRow({ tabId, windowId }: { tabId: string; windowId: string }) {
  const theme = useTheme();
  const tab = useBrowser((s) => s.tabs[tabId]);
  const [hovered, setHovered] = useState(false);
  if (!tab) return null;
  return (
    <Pressable
      onPress={() => {
        dismissHover();
        clickTab(windowId, tabId);
      }}
    >
      <View
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ height: 28, borderRadius: 7, flexDirection: "row", alignItems: "center", paddingHorizontal: 5, backgroundColor: hovered ? theme.rowHover : undefined }}
      >
        <TabIcon url={tab.url} favicon={tab.favicon} icon={tab.customIcon} size={14} profileId={tab.profileId} />
        <FadeLabel text={tabTitle(tab)} fontSize={12.5} color={theme.textTab} style={{ flex: 1, height: 17, marginLeft: 7 }} />
      </View>
    </Pressable>
  );
}
