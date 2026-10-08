import { FadeLabel, Surface } from "@netnyahoo/shell";
import { useEffect } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { displayUrl } from "@netnyahoo/core";
import { lastPicture } from "../../lib/tabPictures";
import { hex, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { tabTitle } from "./actions";
import { useSidebarUi } from "./state";
import { commitSwitcher, focusSwitcherRow, reportSwitcherPreview } from "./switcher";
import { TabIcon } from "./TabIcon";
import { useSidebarTokens } from "./tokens";

const WIDTH = 400;
const ROW = 40;
const MAX_ROWS = 9;
// The focused tab's last picture (lib/tabPictures): memory only, shown only while the switcher is up.
const PREVIEW_HEIGHT = 150;

export function TabSwitcher({ windowId, windowWidth, windowHeight }: { windowId: string; windowWidth: number; windowHeight: number }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const switcher = useSidebarUi((u) => (u.switcher?.windowId === windowId && u.switcher.visible ? u.switcher : null));
  if (!switcher) return null;
  const start = Math.max(0, Math.min(switcher.index - Math.floor(MAX_ROWS / 2), switcher.ids.length - MAX_ROWS));
  const shown = switcher.ids.slice(start, start + MAX_ROWS);
  const picture = lastPicture(switcher.ids[switcher.index] ?? "");
  const height = shown.length * ROW + 16 + 26 + (picture ? PREVIEW_HEIGHT + 8 : 0);
  return (
    <Surface
      fill={hex(theme.panel)}
      cornerRadius={16}
      borderColor={hex(theme.panelBorder)}
      borderWidth={0.5}
      shadowColor="#000000"
      shadowOpacity={theme.panelShadowOpacity}
      shadowRadius={28}
      shadowOffset={[0, 12]}
      style={{ position: "absolute", left: (windowWidth - WIDTH) / 2, top: Math.max(40, (windowHeight - height) / 2 - 40), width: WIDTH, padding: 8 }}
    >
      <Text style={{ fontSize: 11, fontWeight: "600", color: theme.textTertiary, paddingHorizontal: 8, paddingBottom: 6, paddingTop: 2 }}>Recent Tabs</Text>
      {shown.map((id, i) => (
        <SwitcherRow key={id} tabId={id} focused={start + i === switcher.index} index={start + i} focusFill={tokens.switcherFocus} outline={tokens.switcherOutline} />
      ))}
      {picture ? <SwitcherPreview data={picture.data} /> : null}
    </Surface>
  );
}

function SwitcherPreview({ data }: { data: string }) {
  const theme = useTheme();
  useEffect(() => reportSwitcherPreview(), []);
  return (
    <Image
      source={{ uri: `data:image/jpeg;base64,${data}` }}
      resizeMode="cover"
      style={{ width: WIDTH - 16, height: PREVIEW_HEIGHT, marginTop: 8, borderRadius: 10, borderWidth: 0.5, borderColor: hex(theme.panelBorder) }}
    />
  );
}

function SwitcherRow({ tabId, focused, index, focusFill, outline }: { tabId: string; focused: boolean; index: number; focusFill: string; outline: string }) {
  const theme = useTheme();
  const tab = useBrowser((s) => s.tabs[tabId]);
  if (!tab) return null;
  // Switch on mouse-down; the following mouse-up would close the switcher.
  return (
    <Pressable onPressIn={() => commitSwitcher(index)}>
      <View
        onMouseEnter={() => focusSwitcherRow(index)}
        style={{
          height: ROW,
          borderRadius: 10,
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 10,
          gap: 10,
          backgroundColor: focused ? focusFill : undefined,
          borderWidth: focused ? 0.5 : 0,
          borderColor: outline,
        }}
      >
        <TabIcon url={tab.url} favicon={tab.favicon} icon={tab.customIcon} size={18} profileId={tab.profileId} />
        <View style={{ flex: 1 }}>
          <FadeLabel text={tabTitle(tab)} fontSize={13} weight={focused ? "medium" : "regular"} color={theme.textPrimary} style={{ height: 17 }} />
          {tab.url ? <FadeLabel text={displayUrl(tab.url)} fontSize={11} color={theme.textSecondary} style={{ height: 14 }} /> : null}
        </View>
      </View>
    </Pressable>
  );
}
