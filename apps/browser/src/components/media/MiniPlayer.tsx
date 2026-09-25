import { Symbol } from "@netnyahoo/shell";
import { useEffect, useRef, useState } from "react";
import { Animated, Image, Pressable, Text, View, type GestureResponderEvent, type TextStyle } from "react-native";
import { toggleMute } from "../../lib/actions";
import { hex } from "../../lib/theme";
import { useTab } from "../../store/hooks";
import { Favicon, useHover } from "../primitives";
import { useArtwork } from "./artwork";
import { useMarqueeGroup, Marquee } from "./Marquee";
import {
  formatTime,
  hasTrackControls,
  hostOf,
  isPlaying,
  mediaCommand,
  positionOf,
  setNowPlaying,
  SKIP_SECONDS,
  useSession,
  useTicker,
  type Session,
} from "./state";
import { useMediaTokens, type MediaTokens } from "./tokens";

/** AudioMiniPlayerView's size (AudioMiniPlayerLayout). */
export const MINI_PLAYER_WIDTH = 320;
export const MINI_PLAYER_HEIGHT = 76;
const INSET = 10;
const ART = 56;
/** Text starts 12 after the art (x 78); controls take the last 88 + 8. */
const TEXT_X = INSET + ART + 12;
const CONTROLS_WIDTH = 88;

/**
 * Dia's audio mini player (the pinned-tab hover preview): album art, marquee
 * title and artist, previous / play-pause / next, and a seekable progress bar
 * with elapsed and remaining time. Pages without track handlers get ±15 s
 * skips instead of previous/next. Frames follow AudioMiniPlayerView.layout.
 */
export function MiniPlayer({ tabId, onBackToTab }: { tabId: string; onBackToTab: () => void }) {
  const tokens = useMediaTokens();
  const session = useSession(tabId);
  const tab = useTab(tabId);
  const playing = isPlaying(session);
  useTicker(playing);
  const group = useMarqueeGroup(`${session?.title}|${session?.artist}`);
  if (!session || !tab) return null;
  const width = MINI_PLAYER_WIDTH;
  const textWidth = width - TEXT_X - CONTROLS_WIDTH - 8 - INSET;
  const controlsX = width - INSET - CONTROLS_WIDTH;
  const tracks = hasTrackControls(session);
  const artist = session.artist || hostOf(tab.url);
  const title = session.title || tab.title;

  return (
    <View style={{ width, height: MINI_PLAYER_HEIGHT }}>
      <AlbumArt tabId={tabId} profileId={tab.profileId} session={session} url={tab.url} favicon={tab.favicon} tokens={tokens} muted={tab.muted} onPress={onBackToTab} onUnmute={() => toggleMute(tabId)} />
      <View style={{ position: "absolute", left: TEXT_X, top: 10, width: textWidth }}>
        <Marquee id="title" text={title} group={group} height={18} background={tokens.backgroundRgb} style={{ fontSize: 13, fontWeight: "600", color: tokens.label }} />
      </View>
      <View style={{ position: "absolute", left: TEXT_X, top: 30, width: textWidth }}>
        <Marquee id="artist" text={artist} group={group} height={16} background={tokens.backgroundRgb} style={{ fontSize: 11, color: tokens.secondary }} />
      </View>

      <TransportButton
        left={controlsX}
        width={16}
        icon={tracks ? "backward.end.fill" : `gobackward.${SKIP_SECONDS}`}
        size={tracks ? 14 : 15}
        tooltip={tracks ? "Play Previous Track" : `Skip back ${SKIP_SECONDS} seconds`}
        tokens={tokens}
        onPress={() => (tracks ? mediaCommand(tabId, "previous") : skip(tabId, session, -SKIP_SECONDS))}
      />
      <TransportButton
        left={controlsX + 32}
        width={24}
        icon={playing ? "pause.fill" : "play.fill"}
        size={24}
        tooltip={playing ? "Pause" : "Play"}
        tokens={tokens}
        onPress={() => mediaCommand(tabId, "toggle")}
      />
      <TransportButton
        left={controlsX + 72}
        width={16}
        icon={tracks ? "forward.end.fill" : `goforward.${SKIP_SECONDS}`}
        size={tracks ? 14 : 15}
        tooltip={tracks ? "Play Next Track" : `Skip ahead ${SKIP_SECONDS} seconds`}
        tokens={tokens}
        onPress={() => (tracks ? mediaCommand(tabId, "next") : skip(tabId, session, SKIP_SECONDS))}
      />

      <View style={{ position: "absolute", left: TEXT_X, right: INSET, top: 50, height: 18 }}>
        <TimeBar tabId={tabId} session={session} tokens={tokens} />
      </View>
    </View>
  );
}

/** ±15 s through the page's seek handlers (or the element), shown right away. */
export function skip(tabId: string, session: Session, seconds: number) {
  const now = Date.now();
  const position = Math.max(0, Math.min(session.duration ?? Infinity, positionOf(session, now) + seconds));
  setNowPlaying(tabId, { ...session, position, timestamp: now });
  mediaCommand(tabId, "seekBy", seconds);
}

export function seekTo(tabId: string, session: Session, seconds: number) {
  setNowPlaying(tabId, { ...session, position: seconds, timestamp: Date.now() });
  mediaCommand(tabId, "seekTo", seconds);
}

/** Resting controls are 60% opaque (Dia sets alphaValue 0.6); hovered ones are opaque. */
function TransportButton({
  left,
  width,
  icon,
  size,
  tooltip,
  tokens,
  onPress,
}: {
  left: number;
  width: number;
  icon: string;
  size: number;
  tooltip: string;
  tokens: MediaTokens;
  onPress: () => void;
}) {
  const { hovered, hoverProps } = useHover();
  // Symbols wider than the slot (the ±15 s arrows) stay centred on it.
  const box = Math.max(width, size + 4);
  return (
    <View {...hoverProps} tooltip={tooltip} style={{ position: "absolute", left: left - (box - width) / 2, top: 9, width: box, height: 38 }}>
      <Pressable onPress={onPress}>
        {({ pressed }) => (
          <View style={{ width: box, height: 38, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.45 : hovered ? 1 : 0.6 }}>
            <Symbol name={icon} size={size} color={hex(tokens.label)} style={{ width: box, height: 38 }} />
          </View>
        )}
      </Pressable>
    </View>
  );
}

/**
 * Album art (radius 6): fades in when it arrives; the tab's favicon at half
 * opacity when the page has none. Hovering darkens it with an arrow: click goes
 * back to the tab. A mute badge shows when the tab (or its site) is muted.
 */
function AlbumArt({
  tabId,
  profileId,
  session,
  url,
  favicon,
  tokens,
  muted,
  onPress,
  onUnmute,
}: {
  tabId: string;
  profileId: string;
  session: Session;
  url: string;
  favicon: string | null;
  tokens: MediaTokens;
  muted: boolean;
  onPress: () => void;
  onUnmute: () => void;
}) {
  const { hovered, hoverProps } = useHover();
  const [failed, setFailed] = useState<string | null>(null);
  const fade = useRef(new Animated.Value(0)).current;
  // Downloaded by the tab itself (never fetched by the UI); a data: URI.
  const downloaded = useArtwork(tabId, session.artwork);
  const art = downloaded && downloaded !== failed ? downloaded : null;
  useEffect(() => fade.setValue(0), [art]);
  return (
    <View {...hoverProps} style={{ position: "absolute", left: INSET, top: INSET, width: ART, height: ART }}>
      <Pressable onPress={onPress} tooltip="Back to Tab">
        <View style={{ width: ART, height: ART, borderRadius: 6, overflow: "hidden", backgroundColor: tokens.artPlaceholder, alignItems: "center", justifyContent: "center" }}>
          {art ? (
            <Animated.View style={{ position: "absolute", left: 0, top: 0, width: ART, height: ART, opacity: fade }}>
              <Image
                key={art}
                source={{ uri: art }}
                resizeMode="cover"
                onLoad={() => Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: false }).start()}
                onError={() => setFailed(art)}
                style={{ width: ART, height: ART }}
              />
            </Animated.View>
          ) : (
            <View style={{ opacity: 0.5 }}>
              <Favicon url={url} favicon={favicon} size={24} profileId={profileId} />
            </View>
          )}
          {hovered ? (
            <View style={{ position: "absolute", left: 0, top: 0, width: ART, height: ART, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" }}>
              <Symbol name="arrow.up.left" size={16} weight="semibold" color="#FFFFFF" style={{ width: 22, height: 22 }} />
            </View>
          ) : null}
        </View>
      </Pressable>
      {muted ? (
        <Pressable onPress={onUnmute} tooltip="Unmute Site" style={{ position: "absolute", right: -5, bottom: -5 }}>
          <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: tokens.background, alignItems: "center", justifyContent: "center" }}>
            <Symbol name="speaker.slash.fill" size={10} color={hex(tokens.label)} style={{ width: 16, height: 16 }} />
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Elapsed · progress bar · remaining (Dia: 10pt monospaced digits, 6 pt gaps). */
function TimeBar({ tabId, session, tokens }: { tabId: string; session: Session; tokens: MediaTokens }) {
  const [drag, setDrag] = useState<number | null>(null);
  const duration = session.duration;
  const shownPosition = drag !== null && duration ? drag * duration : positionOf(session);
  const label: TextStyle = { fontSize: 10, fontVariant: ["tabular-nums"], color: tokens.secondary };
  return (
    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Text style={label}>{formatTime(shownPosition)}</Text>
      {duration ? (
        <>
          <SeekBar
            session={session}
            tokens={tokens}
            height={18}
            barHeight={6}
            onDrag={setDrag}
            onSeek={(p) => {
              setDrag(null);
              seekTo(tabId, session, p * duration);
            }}
          />
          <Text style={label}>-{formatTime(duration - shownPosition)}</Text>
        </>
      ) : (
        <View style={{ flex: 1 }} />
      )}
    </View>
  );
}

const HOVER_SEGMENTS = 40;

/**
 * Track, fill and hover fill (to the pointer). Click or drag to seek. RN has
 * no mouse-move events, so thin hover strips report where the pointer is.
 */
export function SeekBar({
  session,
  tokens,
  height,
  barHeight,
  onDrag,
  onSeek,
}: {
  session: Session;
  tokens: MediaTokens;
  height: number;
  barHeight: number;
  onDrag?: (progress: number | null) => void;
  onSeek: (progress: number) => void;
}) {
  const ref = useRef<View>(null);
  const frame = useRef({ x: 0, width: 1 });
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const duration = session.duration ?? 0;
  const progress = drag ?? (duration ? positionOf(session) / duration : 0);
  const measure = () => ref.current?.measureInWindow((x, _y, width) => (frame.current = { x, width: Math.max(1, width) }));
  const at = (e: GestureResponderEvent) => Math.min(1, Math.max(0, (e.nativeEvent.pageX - frame.current.x) / frame.current.width));
  const update = (p: number | null) => {
    setDrag(p);
    onDrag?.(p);
  };
  const radius = barHeight / 2;
  const top = (height - barHeight) / 2;
  return (
    <View
      ref={ref}
      style={{ flex: 1, height }}
      onLayout={measure}
      onMouseEnter={measure}
      onMouseLeave={() => setHover(null)}
      onStartShouldSetResponder={() => duration > 0}
      onResponderGrant={(e) => update(at(e))}
      onResponderMove={(e) => update(at(e))}
      onResponderRelease={(e) => {
        const p = at(e);
        update(null);
        onSeek(p);
      }}
      onResponderTerminate={() => update(null)}
    >
      <View style={{ position: "absolute", left: 0, right: 0, top, height: barHeight, borderRadius: radius, backgroundColor: tokens.track, overflow: "hidden" }}>
        <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${progress * 100}%`, borderRadius: radius, backgroundColor: tokens.fill }} />
        {hover !== null && drag === null ? (
          <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${hover * 100}%`, borderRadius: radius, backgroundColor: tokens.hoverFill }} />
        ) : null}
      </View>
      <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, flexDirection: "row" }}>
        {Array.from({ length: HOVER_SEGMENTS }, (_, i) => (
          <View key={i} style={{ flex: 1 }} onMouseEnter={() => setHover((i + 0.5) / HOVER_SEGMENTS)} />
        ))}
      </View>
    </View>
  );
}
