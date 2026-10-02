import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

/**
 * Where a control appears on hover (a row's ✕, a folder's refresh). The slot is as wide as what it shows at rest, and
 * never narrower than `width`; the hover control lies over it, right-aligned. Hovering never moves or resizes anything
 * around the slot: `node apps/browser/scripts/hover-shift-test.mjs` checks every hover-tracked view for that.
 */
export function HoverSlot({
  hovered,
  hover,
  width,
  children,
  style,
}: {
  hovered: boolean;
  /** Shown while hovered, in place of `children`. */
  hover: ReactNode;
  width: number;
  /** Shown at rest; kept in layout (transparent) while hovered, so the slot's size stays. */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const showHover = hovered && hover != null && hover !== false;
  return (
    <View style={[{ minWidth: width, alignSelf: "stretch", flexDirection: "row", alignItems: "center", justifyContent: "flex-end" }, style]}>
      {children != null && children !== false ? (
        <View pointerEvents={showHover ? "none" : "box-none"} style={{ flexDirection: "row", alignItems: "center", opacity: showHover ? 0 : 1 }}>
          {children}
        </View>
      ) : null}
      {showHover ? <View style={{ position: "absolute", top: 0, bottom: 0, right: 0, flexDirection: "row", alignItems: "center" }}>{hover}</View> : null}
    </View>
  );
}
