import type { SearchScope } from "@netnyahoo/core";
import { Text, View } from "react-native";
import { useTheme } from "../../lib/theme";
import { Favicon } from "../primitives";

/**
 * Tab-to-search: the site or engine the query is scoped to, as a token before the text
 * ("youtube.com ⇥" → [▶ YouTube] cats). Backspace on an empty query or Esc removes it.
 */
export function ScopeChip({ scope, large }: { scope: SearchScope; large: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={{
        height: large ? 28 : 26,
        borderRadius: 8,
        paddingLeft: 7,
        paddingRight: 9,
        gap: 6,
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: theme.rowSelected,
      }}
    >
      <Favicon url={`https://${scope.host}`} size={14} />
      <Text numberOfLines={1} style={{ fontSize: large ? 15 : 14, fontWeight: "500", color: theme.textPrimary, maxWidth: 220 }}>
        {scope.name}
      </Text>
    </View>
  );
}
