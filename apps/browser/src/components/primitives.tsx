import { displayHost } from "@netnyahoo/core";
import { Symbol, type SymbolProps } from "@netnyahoo/shell";
import { useState } from "react";
import { Image, Pressable, Text, View, type ViewStyle } from "react-native";
import { faviconFailed, useFavicon } from "../lib/favicons";
import { useTheme } from "../lib/theme";

/**
 * macOS pointer hover via react-native-macos' onMouseEnter/Leave. Spread
 * `hoverProps` on a plain View: Pressable doesn't forward mouse-enter events.
 */
export function useHover() {
  const [hovered, setHovered] = useState(false);
  return {
    hovered,
    hoverProps: { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) },
  };
}

/** Toolbar-style button: 30pt rounded square, fill on hover/press (Dia's toolbar). */
export function IconButton({
  icon,
  onPress,
  disabled,
  size = 15,
  box = 30,
  radius = 7,
  weight = "regular",
  tooltip,
  color,
  style,
}: {
  icon: string;
  onPress?: () => void;
  disabled?: boolean;
  size?: number;
  box?: number;
  radius?: number;
  weight?: SymbolProps["weight"];
  tooltip?: string;
  color?: string;
  style?: ViewStyle;
}) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View tooltip={tooltip} style={style} {...hoverProps}>
      <Pressable onPress={onPress} disabled={disabled}>
        {({ pressed }) => (
          <View
            style={{
              width: box,
              height: box,
              borderRadius: radius,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: disabled ? undefined : pressed ? theme.toolbarPressed : hovered ? theme.toolbarHover : undefined,
            }}
          >
            <Symbol
              name={icon}
              size={size}
              weight={weight}
              color={color ?? (disabled ? theme.iconDisabled : theme.icon)}
              style={{ width: box, height: box }}
            />
          </View>
        )}
      </Pressable>
    </View>
  );
}

/**
 * A page's favicon from the engine's per-profile cache (lib/favicons), never
 * fetched from here. Without one: Dia's empty-favicon tile (a squircle at 28% of
 * the icon colour) with the site's initial, or a globe for pages without a host.
 * Pass `profileId` for tabs so incognito ones find their in-memory icons.
 * `direct`: `favicon` isn't a page's icon but an image a connected app's API
 * handed us (a Notion page icon), loaded as is.
 */
export function Favicon({
  url,
  favicon,
  size = 16,
  profileId,
  direct,
}: {
  url: string;
  favicon?: string | null;
  size?: number;
  profileId?: string;
  direct?: boolean;
}) {
  const cached = useFavicon(url, direct ? null : favicon, profileId);
  const resolved = direct && favicon ? { uri: favicon, profileId: "" } : cached;
  const [broken, setBroken] = useState<string | null>(null);
  if (!url && !resolved) return <NewTabIcon size={size} />;
  if (!resolved || broken === resolved.uri) return <FaviconFallback url={url} size={size} />;
  return (
    <Image
      key={resolved.uri}
      source={{ uri: resolved.uri }}
      onError={() => {
        setBroken(resolved.uri);
        if (resolved.profileId) faviconFailed(resolved.profileId, resolved.uri);
      }}
      style={{ width: size, height: size, borderRadius: size > 18 ? 4 : 3 }}
    />
  );
}

/** Dia's EmptyFavicon (a 14pt continuous-corner tile at 16pt) with the host's initial in it. */
export function FaviconFallback({ url, size = 16 }: { url: string; size?: number }) {
  const theme = useTheme();
  const initial = hostInitial(url);
  if (!initial) return <Symbol name="globe" size={size - 3} color={theme.textSecondary} style={{ width: size, height: size }} />;
  const tile = Math.round((size * 14) / 16);
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: tile,
          height: tile,
          borderRadius: tile * 0.32,
          borderCurve: "continuous",
          // Dia tints its 28%-alpha template with the (translucent) icon colour.
          backgroundColor: theme.dark ? "rgba(247,245,255,0.2)" : "rgba(0,0,0,0.13)",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: Math.round(tile * 0.64), lineHeight: tile, fontWeight: "600", color: theme.textSecondary }}>{initial}</Text>
      </View>
    </View>
  );
}

/** "G" for https://www.github.com (the displayed host's first letter); "" for URLs without a host. */
function hostInitial(url: string): string {
  const host = /^(?:https?|ftp):\/\/(?:[^@/?#]*@)?([^/?#:]+)/i.exec(url)?.[1];
  if (!host || /^[\d.]+$|^\[/.test(host)) return "";
  const shown = displayHost(host.toLowerCase()).replace(/^www\./, "");
  return Array.from(shown)[0]?.toLocaleUpperCase() ?? "";
}

/** Dia marks New Tab rows with a small grey dome. */
export function NewTabIcon({ size = 16 }: { size?: number }) {
  const theme = useTheme();
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: size - 2,
          height: size - 4,
          borderTopLeftRadius: size,
          borderTopRightRadius: size,
          borderBottomLeftRadius: size / 3,
          borderBottomRightRadius: size / 3,
          backgroundColor: theme.dark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.3)",
        }}
      />
    </View>
  );
}
