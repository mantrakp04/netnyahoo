import { appUrlOrigin, displayHost, urlForDisplay } from "@netnyahoo/core";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { useTheme } from "../../lib/theme";
import { SearchField } from "../settings/controls";

/** Content column width of the internal pages (Chrome's WebUI cards are ~680–960). */
export const PAGE_WIDTH = 880;

/** Header shared by History, Bookmarks and Downloads: title, search, actions. */
export function PageHeader({
  title,
  query,
  onQuery,
  placeholder,
  actions,
}: {
  title: string;
  query: string;
  onQuery: (q: string) => void;
  placeholder: string;
  actions?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={{ height: 64, flexDirection: "row", alignItems: "center", paddingHorizontal: 24, gap: 16 }}>
      <Text style={{ width: 200, fontSize: 22, fontWeight: "600", color: theme.textPrimary }}>{title}</Text>
      <View style={{ flex: 1, alignItems: "center" }}>
        <SearchField value={query} onChangeText={onQuery} placeholder={placeholder} style={{ width: "100%", maxWidth: 480 }} />
      </View>
      <View style={{ width: 200, flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>{actions}</View>
    </View>
  );
}

/** Centered empty-state message. */
export function EmptyState({ icon, title, subtitle }: { icon?: ReactNode; title: string; subtitle?: string }) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 80, gap: 8 }}>
      {icon}
      <Text style={{ fontSize: 15, fontWeight: "500", color: theme.textSecondary }}>{title}</Text>
      {subtitle ? <Text style={{ fontSize: 13, color: theme.textTertiary, textAlign: "center", maxWidth: 360 }}>{subtitle}</Text> : null}
    </View>
  );
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Start of the local day, as a key for grouping. */
export const dayStart = (ms: number) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** "Today – Friday, September 25, 2026" (Chrome's history day headers). */
export function dayLabel(start: number, now = Date.now()): string {
  const d = new Date(start);
  const full = `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  const today = dayStart(now);
  if (start === today) return `Today – ${full}`;
  if (start === dayStart(today - 1)) return `Yesterday – ${full}`;
  return full;
}

/** "2:05 PM". */
export function timeLabel(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "youtube.com" (no www., IDNs in Unicode when safe), "netnyahoo://version", or the URL itself when it has no host. */
export function hostLabel(url: string): string {
  const app = appUrlOrigin(url);
  if (app) return app;
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i.exec(url);
  return m ? displayHost(m[1]!.toLowerCase()).replace(/^www\./, "") : url;
}

export function matchesQuery(query: string, ...fields: string[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  // URLs with IDN hosts match in both forms (what's shown, and punycode).
  const hay = fields.map((f) => (/xn--/i.test(f) ? `${f} ${urlForDisplay(f)}` : f)).join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}
