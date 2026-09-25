import { FadeLabel, Surface, Symbol } from "@netnyahoo/shell";
import { useShallow } from "zustand/react/shallow";
import { Image, Pressable, View } from "react-native";
import { switchToTab, toggleMute } from "../../lib/actions";
import { hex, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useTab } from "../../store/hooks";
import { viewTabIds } from "../../store/model";
import { Favicon, IconButton, useHover } from "../primitives";
import { useSidebarTokens } from "../sidebar/tokens";
import { useArtwork } from "./artwork";
import { seekTo, SeekBar, skip } from "./MiniPlayer";
import { hasTrackControls, hostOf, isPlaying, isTabShown, mediaCommand, playerTabFor, SKIP_SECONDS, useMedia, useSession, useTicker } from "./state";
import { useMediaTokens } from "./tokens";

/** Height the sidebar reserves for the player (card + gap above it). */
export const SIDEBAR_PLAYER_HEIGHT = 74 + 8;

/**
 * The tab whose media the sidebar player controls: one of the window's tabs
 * that isn't on screen, playing now (the one that started last) or else the
 * last one paused. Closing the player hides it until that tab plays again.
 */
export function useSidebarPlayerTab(windowId: string): string | undefined {
  const hidden = useBrowser(useShallow((s) => viewTabIds(s, windowId).filter((id) => !isTabShown(s, id))));
  return useMedia((m) => playerTabFor(m, hidden));
}

/**
 * The now-playing card at the bottom of the sidebar for media playing in a
 * background tab: art and titles (click to go to the tab), then transport and
 * a thin seek bar. Hover for its close button.
 */
export function SidebarPlayer({ tabId }: { tabId: string }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const media = useMediaTokens();
  const session = useSession(tabId);
  const tab = useTab(tabId);
  const playing = isPlaying(session);
  const { hovered, hoverProps } = useHover();
  useTicker(playing, 1000);
  const artwork = useArtwork(tabId, session?.artwork);
  if (!session || !tab) return null;
  const tracks = hasTrackControls(session);
  const title = session.title || tab.title;
  const subtitle = session.artist || hostOf(tab.url);
  const go = () => switchToTab(tabId);

  return (
    <View {...hoverProps} style={{ height: SIDEBAR_PLAYER_HEIGHT - 8 }}>
      <Surface fill={hex(tokens.groupFill)} cornerRadius={12} borderColor={hex(tokens.groupStroke)} borderWidth={0.5} style={{ flex: 1, paddingHorizontal: 7, paddingTop: 7 }}>
        <View style={{ flexDirection: "row", alignItems: "center", height: 32 }}>
          <Pressable onPress={go} tooltip="Back to Tab">
            <View style={{ width: 32, height: 32, borderRadius: 6, overflow: "hidden", backgroundColor: media.artPlaceholder, alignItems: "center", justifyContent: "center" }}>
              {artwork ? (
                <Image source={{ uri: artwork }} resizeMode="cover" style={{ width: 32, height: 32 }} />
              ) : (
                <Favicon url={tab.url} favicon={tab.favicon} size={18} profileId={tab.profileId} />
              )}
            </View>
          </Pressable>
          <Pressable onPress={go} style={{ flex: 1, marginLeft: 8, minWidth: 0 }}>
            <FadeLabel text={title} fontSize={12} weight="semibold" color={theme.textPrimary} style={{ height: 16 }} />
            <View style={{ flexDirection: "row", alignItems: "center", height: 14 }}>
              {tab.muted ? <Symbol name="speaker.slash.fill" size={9} color={theme.textSecondary} style={{ width: 13, height: 12 }} /> : null}
              <FadeLabel text={subtitle} fontSize={11} color={theme.textSecondary} style={{ flex: 1, height: 14 }} />
            </View>
          </Pressable>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", height: 24, marginTop: 4, marginLeft: -4 }}>
          <IconButton
            icon={tracks ? "backward.fill" : `gobackward.${SKIP_SECONDS}`}
            size={tracks ? 10 : 12}
            box={24}
            radius={6}
            tooltip={tracks ? "Play Previous Track" : `Skip back ${SKIP_SECONDS} seconds`}
            onPress={() => (tracks ? mediaCommand(tabId, "previous") : skip(tabId, session, -SKIP_SECONDS))}
          />
          <IconButton icon={playing ? "pause.fill" : "play.fill"} size={13} box={24} radius={6} tooltip={playing ? "Pause" : "Play"} onPress={() => mediaCommand(tabId, "toggle")} />
          <IconButton
            icon={tracks ? "forward.fill" : `goforward.${SKIP_SECONDS}`}
            size={tracks ? 10 : 12}
            box={24}
            radius={6}
            tooltip={tracks ? "Play Next Track" : `Skip ahead ${SKIP_SECONDS} seconds`}
            onPress={() => (tracks ? mediaCommand(tabId, "next") : skip(tabId, session, SKIP_SECONDS))}
          />
          {session.duration ? (
            <View style={{ flex: 1, flexDirection: "row", marginLeft: 6 }}>
              <SeekBar session={session} tokens={media} height={12} barHeight={3} onSeek={(p) => seekTo(tabId, session, p * session.duration!)} />
            </View>
          ) : null}
        </View>
      </Surface>
      {hovered ? (
        <View style={{ position: "absolute", top: -6, right: -6, flexDirection: "row", gap: 2 }}>
          <CornerButton icon={tab.muted ? "speaker.wave.2.fill" : "speaker.slash.fill"} tooltip={tab.muted ? "Unmute Site" : "Mute Site"} onPress={() => toggleMute(tabId)} />
          <CornerButton icon="xmark" tooltip="Close Player" onPress={() => useMedia.setState((m) => ({ dismissed: { ...m.dismissed, [tabId]: true } }))} />
        </View>
      ) : null}
    </View>
  );
}

function CornerButton({ icon, tooltip, onPress }: { icon: string; tooltip: string; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} tooltip={tooltip}>
      <Pressable onPress={onPress}>
        <Surface
          fill={hex(theme.panel)}
          cornerRadius={9}
          borderColor={hex(theme.panelBorder)}
          borderWidth={0.5}
          shadowColor="#000000"
          shadowOpacity={theme.panelShadowOpacity * 0.5}
          shadowRadius={3}
          shadowOffset={[0, 1]}
          style={{ width: 18, height: 18, alignItems: "center", justifyContent: "center" }}
        >
          <Symbol name={icon} size={8} weight="bold" color={hovered ? theme.textPrimary : theme.textSecondary} style={{ width: 12, height: 12 }} />
        </Surface>
      </Pressable>
    </View>
  );
}
