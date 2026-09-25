import { Symbol, type MenuItem } from "@netnyahoo/shell";
import { Text, View } from "react-native";
import { PROFILE_COLORS } from "../../lib/theme";
import type { Profile } from "../../store/types";

/**
 * Profile icons. Dia identifies profiles by name and theme colour only (its asset
 * catalogs hold no profile artwork); ours can also carry an emoji or one of these
 * SF Symbols, drawn white on the profile's colour.
 */
export const PROFILE_SYMBOLS: { name: string; title: string }[] = [
  { name: "house.fill", title: "Home" },
  { name: "briefcase.fill", title: "Work" },
  { name: "graduationcap.fill", title: "School" },
  { name: "chevron.left.forwardslash.chevron.right", title: "Code" },
  { name: "paintpalette.fill", title: "Art" },
  { name: "hammer.fill", title: "Projects" },
  { name: "book.closed.fill", title: "Reading" },
  { name: "music.note", title: "Music" },
  { name: "camera.fill", title: "Photos" },
  { name: "gamecontroller.fill", title: "Games" },
  { name: "cart.fill", title: "Shopping" },
  { name: "banknote.fill", title: "Finance" },
  { name: "airplane", title: "Travel" },
  { name: "figure.run", title: "Fitness" },
  { name: "cup.and.saucer.fill", title: "Café" },
  { name: "leaf.fill", title: "Nature" },
  { name: "pawprint.fill", title: "Pets" },
  { name: "heart.fill", title: "Personal" },
  { name: "star.fill", title: "Favorites" },
  { name: "moon.stars.fill", title: "Evenings" },
];

const EMOJI = ["😀", "😎", "🤓", "🧑‍💻", "💼", "🏠", "🎓", "🎨", "🎮", "🎵", "📚", "✈️", "🌱", "🔥", "⭐️", "🚀", "🐶", "🐱", "🦊", "🍀"];

const SYMBOL_PREFIX = "symbol:";
/** The SF Symbol of a `symbol:<name>` icon. */
export const profileSymbol = (icon: string | null) => (icon?.startsWith(SYMBOL_PREFIX) ? icon.slice(SYMBOL_PREFIX.length) : null);

/** Menu items to pick a profile icon; the chosen id is `icon:` + the new icon ("" = the initial). */
export function iconMenuItems(current: string | null): MenuItem[] {
  return [
    { id: "icon:", title: "Initial", checked: !current },
    { separator: true },
    ...PROFILE_SYMBOLS.map((s) => ({ id: `icon:${SYMBOL_PREFIX}${s.name}`, title: s.title, symbol: s.name, checked: current === SYMBOL_PREFIX + s.name })),
    { separator: true },
    {
      id: "emoji",
      title: "Emoji",
      checked: !!current && !profileSymbol(current),
      children: EMOJI.map((e) => ({ id: `icon:${e}`, title: e, checked: current === e })),
    },
  ];
}

/**
 * A round badge on the profile's colour with its symbol or initial (an emoji sits on
 * the colour too). Bigger badges get a hairline rim.
 */
export function ProfileBadge({ profile, size = 26 }: { profile: Pick<Profile, "name" | "color" | "icon">; size?: number }) {
  const swatch = PROFILE_COLORS[profile.color]?.swatch ?? PROFILE_COLORS.plum.swatch;
  const symbol = profileSymbol(profile.icon);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: swatch,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: size >= 22 ? 0.5 : 0,
        borderColor: "rgba(0,0,0,0.12)",
      }}
    >
      {symbol ? (
        <Symbol name={symbol} size={size * 0.5} weight="semibold" color="#FFFFFF" style={{ width: size, height: size }} />
      ) : (
        <Text style={{ fontSize: profile.icon ? size * 0.55 : size * 0.46, fontWeight: "600", color: "#FFFFFF" }}>
          {profile.icon ?? (profile.name.trim()[0] ?? "?").toUpperCase()}
        </Text>
      )}
    </View>
  );
}
