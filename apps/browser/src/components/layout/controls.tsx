import { ContextMenuArea, Surface, Symbol, VisualEffect, type SymbolProps } from "@netnyahoo/shell";
import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View, type GestureResponderEvent, type ViewStyle } from "react-native";
import { hex, useTheme } from "../../lib/theme";
import { useHover } from "../primitives";
import type { ToolbarPalette } from "./toolbarColors";

/** Modifier keys of a click (react-native-macos puts them on the press event). */
export type ClickModifiers = { metaKey: boolean; altKey: boolean; shiftKey: boolean };
export function modifiersOf(e: GestureResponderEvent | undefined): ClickModifiers {
  const n = (e?.nativeEvent ?? {}) as Partial<ClickModifiers>;
  return { metaKey: !!n.metaKey, altKey: !!n.altKey, shiftKey: !!n.shiftKey };
}

/**
 * Toolbar button: Dia's 30pt rounded square with a hover / press fill. Unlike
 * primitives' IconButton it passes the click's modifiers on, and supports
 * press-and-hold and right-click (the back / forward history menus).
 */
export function ToolbarButton({
  icon,
  onPress,
  onLongPress,
  onContextMenu,
  disabled,
  size = 15,
  box = 30,
  radius = 7,
  weight = "regular",
  tooltip,
  palette,
  color,
  style,
}: {
  icon: string;
  onPress?: (modifiers: ClickModifiers) => void;
  onLongPress?: () => void;
  onContextMenu?: () => void;
  disabled?: boolean;
  size?: number;
  box?: number;
  radius?: number;
  weight?: SymbolProps["weight"];
  tooltip?: string;
  palette: Pick<ToolbarPalette, "icon" | "iconDisabled" | "hover" | "pressed">;
  color?: string;
  style?: ViewStyle;
}) {
  const { hovered, hoverProps } = useHover();
  const button = (
    <Pressable
      onPress={(e) => onPress?.(modifiersOf(e))}
      onLongPress={onLongPress}
      delayLongPress={450}
      disabled={disabled}
    >
      {({ pressed }) => (
        <View
          style={{
            width: box,
            height: box,
            borderRadius: radius,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: disabled ? undefined : pressed ? palette.pressed : hovered ? palette.hover : undefined,
          }}
        >
          <Symbol name={icon} size={size} weight={weight} color={color ?? (disabled ? palette.iconDisabled : palette.icon)} style={{ width: box, height: box }} />
        </View>
      )}
    </Pressable>
  );
  return (
    <View tooltip={tooltip} style={style} {...hoverProps}>
      {onContextMenu && !disabled ? <ContextMenuArea onContextMenu={onContextMenu}>{button}</ContextMenuArea> : button}
    </View>
  );
}

/**
 * A popover over the page, anchored under the toolbar (Dia's site menu and
 * permission prompts): menu material, hairline border, soft shadow, and a quick
 * scale-in from its anchor corner. `onDismiss` fires for clicks outside it.
 */
export function Popover({
  width,
  top,
  right,
  left,
  onDismiss,
  children,
  modal = true,
}: {
  width: number;
  top: number;
  right?: number;
  left?: number;
  onDismiss?: () => void;
  children: ReactNode;
  /** Catch clicks elsewhere in the pane to dismiss (off for prompts the page keeps waiting on). */
  modal?: boolean;
}) {
  const theme = useTheme();
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(appear, { toValue: 1, duration: 170, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, []);
  const origin = right !== undefined ? "top right" : "top left";
  return (
    <>
      {modal && onDismiss && <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />}
      <Animated.View
        style={{
          position: "absolute",
          top,
          right,
          left,
          width,
          opacity: appear,
          transformOrigin: origin,
          transform: [
            { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
            { translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [-4, 0] }) },
          ],
        }}
      >
        <Surface
          fill={hex(theme.dark ? "rgba(38,36,37,0.94)" : "rgba(252,251,252,0.96)")}
          cornerRadius={12}
          borderColor={hex(theme.dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.12)")}
          borderWidth={0.5}
          shadowColor="#000000"
          shadowOpacity={theme.dark ? 0.45 : 0.16}
          shadowRadius={18}
          shadowOffset={[0, 8]}
        >
          <VisualEffect material="menu" cornerRadius={12} style={StyleSheet.absoluteFill} />
          <View style={{ ...StyleSheet.absoluteFillObject, borderRadius: 12, backgroundColor: theme.dark ? "rgba(38,36,37,0.72)" : "rgba(252,251,252,0.7)" }} />
          {children}
        </Surface>
      </Animated.View>
    </>
  );
}

/** A row in a popover: icon, title, optional detail / accessory; Dia's 7% hover fill. */
export function PopoverRow({
  icon,
  iconColor,
  title,
  detail,
  accessory,
  onPress,
  disabled,
  destructive,
}: {
  icon?: string;
  iconColor?: string;
  title: string;
  detail?: string;
  accessory?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const tint = destructive ? "#FF6B63" : theme.textPrimary;
  const content = (pressed: boolean) => (
    <View
      style={{
        minHeight: 32,
        marginHorizontal: 5,
        paddingHorizontal: 8,
        borderRadius: 7,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
        opacity: disabled ? 0.45 : 1,
        backgroundColor: onPress && !disabled && (pressed || hovered) ? (theme.dark ? `rgba(255,255,255,${pressed ? 0.12 : 0.07})` : `rgba(0,0,0,${pressed ? 0.1 : 0.06})`) : undefined,
      }}
    >
      {icon ? <Symbol name={icon} size={13} color={iconColor ?? (destructive ? tint : theme.icon)} style={{ width: 18, height: 18 }} /> : null}
      <View style={{ flex: 1, paddingVertical: 6 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, color: tint }}>
          {title}
        </Text>
        {detail ? (
          <Text numberOfLines={2} style={{ fontSize: 11, color: theme.textSecondary, marginTop: 1 }}>
            {detail}
          </Text>
        ) : null}
      </View>
      {accessory}
    </View>
  );
  if (!onPress) return <View {...hoverProps}>{content(false)}</View>;
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress} disabled={disabled}>
        {({ pressed }) => content(pressed)}
      </Pressable>
    </View>
  );
}

export function PopoverSeparator() {
  const theme = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, marginVertical: 5, marginHorizontal: 13, backgroundColor: theme.dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)" }} />;
}

/** macOS-style pill button for prompts (primary = accent fill). */
export function PromptButton({ title, onPress, primary, flex }: { title: string; onPress: () => void; primary?: boolean; flex?: boolean }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} style={flex ? { flex: 1 } : undefined}>
      <Pressable onPress={onPress}>
        {({ pressed }) => (
          <View
            style={{
              height: 28,
              paddingHorizontal: 12,
              borderRadius: 8,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: primary
                ? theme.dark
                  ? pressed ? "#C9B8C5" : hovered ? "#E6D8E2" : theme.goButton
                  : pressed ? "#26314A" : hovered ? "#1B2640" : theme.goButton
                : theme.dark
                  ? `rgba(255,255,255,${pressed ? 0.18 : hovered ? 0.14 : 0.1})`
                  : `rgba(0,0,0,${pressed ? 0.12 : hovered ? 0.09 : 0.06})`,
            }}
          >
            <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "500", color: primary ? theme.goButtonText : theme.textPrimary }}>
              {title}
            </Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

/** A small on/off switch (macOS mini switch proportions). */
export function Toggle({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  const theme = useTheme();
  const x = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(x, { toValue: value ? 1 : 0, duration: 150, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [value]);
  return (
    <Pressable onPress={() => onChange(!value)} hitSlop={6}>
      <Animated.View
        style={{
          width: 30,
          height: 17,
          borderRadius: 9,
          padding: 1.5,
          backgroundColor: x.interpolate({ inputRange: [0, 1], outputRange: [theme.dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.12)", "#3478F6"] }),
        }}
      >
        <Animated.View
          style={{
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: "#FFFFFF",
            transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, 13] }) }],
          }}
        />
      </Animated.View>
    </Pressable>
  );
}
