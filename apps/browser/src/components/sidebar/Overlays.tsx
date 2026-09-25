import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useWindowId } from "../../store/hooks";
import { startSidebarEffects } from "./effects";
import { MeetingAlert } from "../live/MeetingAlert";
import { HoverCard } from "./HoverCard";
import { IconPicker } from "./IconPicker";
import { SearchTabs } from "./SearchTabs";
import { TabSwitcher } from "./TabSwitcher";
import { useSidebarWidth } from "./tokens";

/**
 * The sidebar's window-level layers, above the page: hover cards, the icon
 * picker, Search Tabs (⇧⌘A) and the ⌃Tab switcher. Mounted once per window
 * (App.tsx), after the content so they draw over web views.
 */
export function SidebarOverlays({ windowWidth }: { windowWidth: number }) {
  const windowId = useWindowId();
  const sidebarWidth = useSidebarWidth(windowId);
  const [height, setHeight] = useState(0);
  useEffect(startSidebarEffects, []);
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
      <HoverCard windowId={windowId} />
      <MeetingAlert windowId={windowId} windowWidth={windowWidth} />
      <IconPicker windowId={windowId} sidebarWidth={sidebarWidth} />
      <SearchTabs windowId={windowId} windowWidth={windowWidth} />
      <TabSwitcher windowId={windowId} windowWidth={windowWidth} windowHeight={height} />
    </View>
  );
}
