import { Symbol } from "@netnyahoo/shell";
import { memo } from "react";
import { View } from "react-native";
import { hex } from "../../lib/theme";
import { usePage } from "../layout/pageState";
import { useSidebarTokens } from "../sidebar/tokens";
import { useMedia } from "./state";
import { CAPTURE_RED } from "./tokens";

// `pip: false` where Dia shows no picture-in-picture badge (the top tab strip).
export const TabBadges = memo(function TabBadges({ tabId, size = 16, pip = true }: { tabId: string; size?: number; pip?: boolean }) {
  return (
    <>
      {pip && <PipBadge tabId={tabId} size={size} />}
      <CaptureBadge tabId={tabId} size={size} />
    </>
  );
});

function PipBadge({ tabId, size }: { tabId: string; size: number }) {
  const tokens = useSidebarTokens();
  const open = useMedia((m) => !!m.pipOpen[tabId]);
  if (!open) return null;
  const d = Math.round(size * 0.72);
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", right: -d / 3, top: -d / 3, width: d, height: d, borderRadius: d / 2, backgroundColor: tokens.badge, alignItems: "center", justifyContent: "center" }}
    >
      <Symbol name="pip.fill" size={d * 0.55} weight="bold" color={hex(tokens.badgeGlyph)} style={{ width: d, height: d }} />
    </View>
  );
}

function CaptureBadge({ tabId, size }: { tabId: string; size: number }) {
  const capture = usePage(tabId, (p) => p.mediaAccess);
  if (!capture) return null;
  if (capture.screen) {
    const d = Math.round(size * 0.72);
    return (
      <View
        pointerEvents="none"
        style={{ position: "absolute", right: -d / 3, bottom: -d / 3, width: d, height: d, borderRadius: d / 2, backgroundColor: CAPTURE_RED, alignItems: "center", justifyContent: "center" }}
      >
        <Symbol name="rectangle.inset.filled" size={d * 0.5} weight="bold" color="#FFFFFF" style={{ width: d, height: d }} />
      </View>
    );
  }
  const d = Math.max(6, Math.round(size * 0.44));
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", right: -d / 4, bottom: -d / 4, width: d, height: d, borderRadius: d / 2, backgroundColor: CAPTURE_RED, borderWidth: 1, borderColor: "rgba(0,0,0,0.25)" }}
    />
  );
}
