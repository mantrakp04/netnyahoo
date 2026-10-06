import { Symbol } from "@netnyahoo/shell";
import { memo } from "react";
import { Text, View } from "react-native";
import { useIsSleeping } from "../../lib/tabLifecycle";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { Favicon } from "../primitives";

export const SYMBOL_PREFIX = "symbol:";

// Memoized: rows re-render on hover and selection, and the icon's props rarely change.
export const TabIcon = memo(function TabIcon({
  tabId,
  url,
  favicon,
  icon,
  size = 16,
  color,
  profileId: profile,
  direct,
}: {
  tabId?: string;
  url: string;
  favicon?: string | null;
  icon?: string | null;
  size?: number;
  color?: string;
  profileId?: string;
  direct?: boolean;
}) {
  const sleeping = useIsSleeping(tabId ?? "");
  const props = { url, favicon, icon, size, color, direct };
  return (
    <View style={{ opacity: sleeping ? SLEEPING_OPACITY : 1 }}>
      {profile || !tabId ? <Icon {...props} profileId={profile} /> : <TabProfileIcon {...props} tabId={tabId} />}
    </View>
  );
});

// Looks the tab's profile up only when the caller didn't pass it: a subscription per icon adds up in
// the sidebar, where every row runs its selectors on every store update.
function TabProfileIcon({ tabId, ...props }: Omit<Parameters<typeof Icon>[0], "profileId"> & { tabId: string }) {
  const profileId = useBrowser((s) => s.tabs[tabId]?.profileId);
  return <Icon {...props} profileId={profileId} />;
}

const SLEEPING_OPACITY = 0.45;

function Icon({
  url,
  favicon,
  icon,
  size = 16,
  color,
  profileId,
  direct,
}: {
  url: string;
  favicon?: string | null;
  icon?: string | null;
  size?: number;
  color?: string;
  profileId?: string;
  direct?: boolean;
}) {
  const theme = useTheme();
  if (icon?.startsWith(SYMBOL_PREFIX)) {
    return <Symbol name={icon.slice(SYMBOL_PREFIX.length)} size={size - 3} weight="medium" color={color ?? theme.icon} style={{ width: size, height: size }} />;
  }
  if (icon) {
    return (
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: size - 3, lineHeight: size }}>{icon}</Text>
      </View>
    );
  }
  return <Favicon url={url} favicon={favicon} size={size} profileId={profileId} direct={direct} />;
}
