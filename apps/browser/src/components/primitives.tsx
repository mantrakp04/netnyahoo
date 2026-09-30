import { displayHost } from "@netnyahoo/core";
import { Symbol, type SymbolProps } from "@netnyahoo/shell";
import { useState } from "react";
import { Image, Pressable, Text, View, type ViewStyle } from "react-native";
import { faviconFailed, useAppearanceDark, useFavicon, useFaviconTheme } from "../lib/favicons";
import { useTheme } from "../lib/theme";

export function useHover() {
  const [hovered, setHovered] = useState(false);
  return {
    hovered,
    hoverProps: { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) },
  };
}

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
  const theme = useTheme();
  useAppearanceDark();
  const cached = useFavicon(url, direct ? null : favicon, profileId);
  const resolved = direct && favicon ? { uri: favicon, profileId: "" } : cached;
  const shape = useFaviconTheme(theme.dark || direct ? "" : url, favicon, profileId);
  const white = shape?.kind === "template" && !!shape.stroke;
  const [broken, setBroken] = useState<string | null>(null);
  if (!url && !resolved) return <NewTabIcon size={size} />;
  if (!resolved || broken === resolved.uri) return <FaviconFallback url={url} size={size} />;
  return (
    <Image
      key={white ? `${resolved.uri} tinted` : resolved.uri}
      source={{ uri: resolved.uri }}
      onError={() => {
        setBroken(resolved.uri);
        if (resolved.profileId) faviconFailed(resolved.profileId, resolved.uri);
      }}
      style={{ width: size, height: size, borderRadius: size > 18 ? 4 : 3, tintColor: white ? theme.textPrimary : undefined }}
    />
  );
}

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

function hostInitial(url: string): string {
  const host = /^(?:https?|ftp):\/\/(?:[^@/?#]*@)?([^/?#:]+)/i.exec(url)?.[1];
  if (!host || /^[\d.]+$|^\[/.test(host)) return "";
  const shown = displayHost(host.toLowerCase()).replace(/^www\./, "");
  return Array.from(shown)[0]?.toLocaleUpperCase() ?? "";
}

const NEW_TAB_MARK = require("../../assets/new-tab-yahu.png");

export function NewTabIcon({ size = 16 }: { size?: number }) {
  const theme = useTheme();
  return (
    <Image
      key={theme.dark ? "dark" : "light"}
      source={NEW_TAB_MARK}
      style={{ width: size, height: size, tintColor: theme.dark ? "#FFFFFF" : "#000000", opacity: theme.dark ? 0.28 : 0.3 }}
    />
  );
}
