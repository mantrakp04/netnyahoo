import { changeCaptureSource, stopCapture } from "@netnyahoo/cef";
import { Symbol } from "@netnyahoo/shell";
import { useEffect, useRef } from "react";
import { Animated, Easing, Text, View } from "react-native";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { engineProfile } from "../../store/model";
import { browserIdOf } from "../extensions/state";
import { PromptButton } from "../layout/controls";
import { pageOf, usePages } from "../layout/pageState";
import { useMedia, type TabShare } from "./state";
import { CAPTURE_RED } from "./tokens";

export const SHARE_BAR_HEIGHT = 38;

const hostOf = (origin: string) => {
  try {
    return new URL(origin).hostname.replace(/^www\./, "") || origin;
  } catch {
    return origin;
  }
};

function useShareFor(tabId: string): [string, TabShare] | null {
  const shares = useMedia((m) => m.tabShares);
  const profile = useBrowser((s) => {
    const tab = s.tabs[tabId];
    return tab && /^https?:|^file:/.test(tab.url) ? engineProfile(tab.profileId) : null;
  });
  const capturing = usePages((p) => Object.keys(shares).filter((id) => p.pages[id]?.mediaAccess?.screen).join(","));
  if (profile === null) return null;
  for (const capturer of capturing ? capturing.split(",") : []) {
    const share = shares[capturer];
    if (!share || share.dismissed[tabId]) continue;
    const owner = useBrowser.getState().tabs[capturer];
    if (owner && engineProfile(owner.profileId) === profile) return [capturer, share];
  }
  return null;
}

export function noteTabShare(capturerTabId: string, capturedTabId: string, origin: string) {
  useMedia.setState((m) => ({ tabShares: { ...m.tabShares, [capturerTabId]: { capturedTabId, origin, dismissed: {} } } }));
}

export function startTabShareCleanup() {
  return usePages.subscribe((p, prev) => {
    if (p.pages === prev.pages) return;
    const shares = useMedia.getState().tabShares;
    const ended = Object.keys(shares).filter((id) => prev.pages[id]?.mediaAccess?.screen && !p.pages[id]?.mediaAccess?.screen);
    if (!ended.length) return;
    const next = { ...shares };
    for (const id of ended) delete next[id];
    useMedia.setState({ tabShares: next });
  });
}

async function shareInstead(capturer: string, tabId: string) {
  const ok = await changeCaptureSource(browserIdOf(capturer), browserIdOf(tabId));
  if (!ok) return;
  useMedia.setState((m) => {
    const share = m.tabShares[capturer];
    return share ? { tabShares: { ...m.tabShares, [capturer]: { ...share, capturedTabId: tabId, dismissed: {} } } } : m;
  });
}

function dismiss(capturer: string, tabId: string) {
  useMedia.setState((m) => {
    const share = m.tabShares[capturer];
    return share ? { tabShares: { ...m.tabShares, [capturer]: { ...share, dismissed: { ...share.dismissed, [tabId]: true } } } } : m;
  });
}

export function ShareBar({ tabId }: { tabId: string }) {
  const theme = useTheme();
  const found = useShareFor(tabId);
  const height = useRef(new Animated.Value(0)).current;
  const visible = !!found;
  useEffect(() => {
    Animated.timing(height, { toValue: visible ? SHARE_BAR_HEIGHT : 0, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [visible]);
  const last = useRef(found);
  if (found) last.current = found;
  const shown = found ?? last.current;
  if (!shown) return null;
  const [capturer, share] = shown;
  const isShared = share.capturedTabId === tabId;
  const host = hostOf(share.origin || pageOf(capturer).security?.origin || useBrowser.getState().tabs[capturer]?.url || "");
  return (
    <Animated.View style={{ height, overflow: "hidden" }}>
      <View
        style={{
          height: SHARE_BAR_HEIGHT,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingLeft: 12,
          paddingRight: 8,
          borderBottomWidth: 0.5,
          borderBottomColor: theme.dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)",
        }}
      >
        <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: CAPTURE_RED, alignItems: "center", justifyContent: "center" }}>
          <Symbol name="rectangle.inset.filled" size={9} weight="bold" color="#FFFFFF" style={{ width: 14, height: 14 }} />
        </View>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: theme.textSecondary }}>
          {"Sharing "}
          <Text style={{ fontWeight: "600", color: theme.textPrimary }}>{isShared ? "this tab" : "another tab"}</Text>
          {` with ${host}`}
        </Text>
        {isShared ? (
          <PromptButton title="Stop Sharing" onPress={() => void stopCapture(browserIdOf(capturer))} />
        ) : (
          <PromptButton title="Share This Tab Instead" primary onPress={() => void shareInstead(capturer, tabId)} />
        )}
        <PromptButton title="Dismiss" onPress={() => dismiss(capturer, tabId)} />
      </View>
    </Animated.View>
  );
}
