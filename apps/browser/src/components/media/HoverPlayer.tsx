import { Surface } from "@netnyahoo/shell";
import { hex, layout, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { clickTab } from "../sidebar/actions";
import { dismissHover, hoverLeave, keepHover } from "../sidebar/hover";
import { measureRow, setSidebarUi, type Anchor } from "../sidebar/state";
import { useSidebarWidth } from "../sidebar/tokens";
import { MINI_PLAYER_HEIGHT, MINI_PLAYER_WIDTH, MiniPlayer } from "./MiniPlayer";
import { useMedia } from "./state";
import { useMediaTokens } from "./tokens";

/**
 * Hovering a pinned tab that plays media (Dia: Spotify and other pinned media
 * tabs) shows the mini player instead of the usual hover card.
 */
export function useShowsMiniPlayer(tabId: string | undefined): boolean {
  const pinned = useBrowser((s) => !!tabId && !!s.tabs[tabId]?.pinned);
  const hasSession = useMedia((s) => {
    const session = tabId ? s.sessions[tabId] : undefined;
    return !!session && session.playbackState !== "none" && !!(session.title || session.artwork);
  });
  return pinned && hasSession;
}

export function HoverPlayer({ tabId, windowId, anchor }: { tabId: string; windowId: string; anchor: Anchor }) {
  const theme = useTheme();
  const tokens = useMediaTokens();
  // Pinned tiles share rows: open past the sidebar's edge, not over the next tile.
  const edge = Math.max(anchor.x + anchor.width, useSidebarWidth(windowId) - layout.sidebarInset);
  return (
    <Surface
      onMouseEnter={keepHover}
      onMouseLeave={hoverLeave}
      fill={tokens.background}
      cornerRadius={12}
      borderColor={hex(tokens.border)}
      borderWidth={0.5}
      shadowColor="#000000"
      shadowOpacity={theme.panelShadowOpacity * 0.8}
      shadowRadius={16}
      shadowOffset={[0, 6]}
      style={{ position: "absolute", left: edge + 8, top: Math.max(8, anchor.y - 6), width: MINI_PLAYER_WIDTH, height: MINI_PLAYER_HEIGHT }}
    >
      <MiniPlayer
        tabId={tabId}
        onBackToTab={() => {
          dismissHover();
          clickTab(windowId, tabId);
        }}
      />
    </Surface>
  );
}

/** DEV: open a tab's hover card / mini player without a pointer (`globalThis.nnMediaHover`). */
if (__DEV__) {
  (globalThis as { nnMediaHover?: unknown }).nnMediaHover = async (windowId: string, tabId: string | null) => {
    if (!tabId) return setSidebarUi({ hover: null });
    const anchor = await measureRow(windowId, tabId);
    if (anchor) setSidebarUi({ hover: { windowId, kind: "tab", id: tabId, anchor } });
    return anchor;
  };
}
