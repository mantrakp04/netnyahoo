import { type CardNetwork } from "@netnyahoo/cef";
import { Symbol } from "@netnyahoo/shell";
import { Text, View } from "react-native";
import { useBrowser } from "../../store/browser";
import { openSettings } from "../settings/windows";

/**
 * Chrome's password manager and autofill fill pages themselves: its dropdown
 * under a focused field (saved logins, strong passwords, addresses, cards) and
 * its save prompts for addresses and cards. The password save prompt is ours
 * (./Prompts.tsx); this file keeps Edit › AutoFill and the card badge.
 */

/**
 * Edit › AutoFill › Contact… / Passwords… / Credit Card…: Chrome offers saved entries
 * itself when a field is focused (its dropdown, or its context menu's manual fallback), so
 * the menu opens where they're managed: Passwords, or Autofill (addresses and cards), on the
 * window's profile. Incognito windows use the default profile's, which the pane starts on.
 */
export function requestAutofill(windowId: string, arg: string | null) {
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  const profileId = w && !w.incognito && s.profiles[w.profileId] ? w.profileId : null;
  openSettings(arg === "passwords" ? "passwords" : "autofill", profileId);
}

const BADGES: Record<CardNetwork, { label: string; fill: string; text: string }> = {
  visa: { label: "VISA", fill: "#1A1F71", text: "#FFFFFF" },
  mastercard: { label: "", fill: "#1C1C1E", text: "#FFFFFF" },
  amex: { label: "AMEX", fill: "#2E77BC", text: "#FFFFFF" },
  discover: { label: "DISC", fill: "#FF6000", text: "#FFFFFF" },
  diners: { label: "DC", fill: "#0079BE", text: "#FFFFFF" },
  jcb: { label: "JCB", fill: "#0B7A3E", text: "#FFFFFF" },
  unionpay: { label: "UP", fill: "#D7282F", text: "#FFFFFF" },
  card: { label: "", fill: "#8E8E93", text: "#FFFFFF" },
};

/** A small card-shaped network mark (Chrome shows card art in the same slot). */
export function NetworkBadge({ network }: { network: CardNetwork }) {
  const badge = BADGES[network] ?? BADGES.card;
  return (
    <View style={{ width: 28, height: 19, borderRadius: 3.5, backgroundColor: badge.fill, alignItems: "center", justifyContent: "center", flexDirection: "row" }}>
      {network === "mastercard" ? (
        <>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: "#EB001B", marginRight: -3.5 }} />
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: "#F79E1B", opacity: 0.9 }} />
        </>
      ) : badge.label ? (
        <Text style={{ fontSize: badge.label.length > 3 ? 7.5 : 8, fontWeight: "800", fontStyle: network === "visa" ? "italic" : "normal", color: badge.text, letterSpacing: 0.3 }}>
          {badge.label}
        </Text>
      ) : (
        <Symbol name="creditcard.fill" size={10} color="#FFFFFF" style={{ width: 14, height: 12 }} />
      )}
    </View>
  );
}
