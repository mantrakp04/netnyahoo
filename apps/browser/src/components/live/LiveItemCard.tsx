import { FadeLabel, Surface, Symbol } from "@netnyahoo/shell";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Image, Pressable, Text, View } from "react-native";
import { hex, useTheme } from "../../lib/theme";
import { openLiveItem } from "../../live/engine";
import { summarizeChecks } from "../../live/github";
import { ago } from "../../live/meetings";
import { useLive } from "../../live/store";
import type { LiveItem, PullRequestCheck } from "../../live/types";
import { useBrowser } from "../../store/browser";
import { useHover } from "../primitives";
import { dismissHover, hoverLeave, keepHover } from "../sidebar/hover";
import type { Anchor } from "../sidebar/state";
import { TabIcon } from "../sidebar/TabIcon";
import { useLiveColors, type LiveColors } from "./colors";

/** The hover card's frame, beside the row (the sidebar's other hover cards use the same). */
export function HoverSurface({ anchor, width, children }: { anchor: Anchor; width: number; children: ReactNode }) {
  const theme = useTheme();
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(appear, { toValue: 1, duration: 140, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, []);
  return (
    <Animated.View
      style={{
        position: "absolute",
        left: anchor.x + anchor.width + 8,
        top: Math.max(8, anchor.y - 6),
        width,
        opacity: appear,
        transform: [{ translateX: appear.interpolate({ inputRange: [0, 1], outputRange: [-4, 0] }) }],
      }}
    >
      <Surface
        onMouseEnter={keepHover}
        onMouseLeave={hoverLeave}
        fill={hex(theme.panel)}
        cornerRadius={12}
        borderColor={hex(theme.panelBorder)}
        borderWidth={0.5}
        shadowColor="#000000"
        shadowOpacity={theme.panelShadowOpacity * 0.8}
        shadowRadius={16}
        shadowOffset={[0, 6]}
        style={{ padding: 12 }}
      >
        {children}
      </Surface>
    </Animated.View>
  );
}

/** Hover card for a live folder row: Dia's GitHubPRHoverPreview for PRs, a summary for documents. */
export function LiveItemCard({ id, windowId, anchor }: { id: string; windowId: string; anchor: Anchor }) {
  const [, folderId = "", itemId = ""] = id.split("|");
  const item = useLive((s) => s.items[folderId]?.find((i) => i.id === itemId));
  if (!item) return null;
  return (
    <HoverSurface anchor={anchor} width={item.pr ? 300 : 280}>
      {item.pr ? <PullRequestPreview item={item} folderId={folderId} windowId={windowId} /> : <DocumentPreview item={item} />}
    </HoverSurface>
  );
}

/** A small avatar: the image, or initials when it can't load. */
export function Avatar({ uri, name, size = 20 }: { uri: string | null; name: string; size?: number }) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  const initials = name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: "hidden", backgroundColor: theme.dark ? "#4A4A4F" : "#D5D5DA", alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: size * 0.42, fontWeight: "600", color: theme.textPrimary }}>{initials || "?"}</Text>
      {uri && !failed ? <Image source={{ uri }} onError={() => setFailed(true)} style={{ position: "absolute", width: size, height: size }} /> : null}
    </View>
  );
}

const open = (windowId: string, url: string) => {
  dismissHover();
  useBrowser.getState().newTab(windowId, { url });
};

function PullRequestPreview({ item, folderId, windowId }: { item: LiveItem; folderId: string; windowId: string }) {
  const theme = useTheme();
  const colors = useLiveColors();
  const pr = item.pr!;
  const summary = summarizeChecks(pr.checks);
  const failing = pr.checks.filter((c) => c.state === "failure");
  const [showAll, setShowAll] = useState(false);
  return (
    <View style={{ gap: 9 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
        <Avatar uri={pr.authorAvatar} name={pr.author} />
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: theme.textSecondary }}>
          <Text style={{ fontWeight: "600", color: theme.textPrimary }}>{pr.author}</Text> · {pr.repo} #{pr.number}
        </Text>
        {pr.draft ? <Chip text="Draft" color={colors.draft} /> : null}
      </View>
      <Text numberOfLines={3} style={{ fontSize: 13.5, lineHeight: 18, fontWeight: "600", color: theme.textPrimary }}>
        {item.title}
      </Text>

      {summary ? (
        <View style={{ gap: 6 }}>
          <CIProgressBar checks={pr.checks} colors={colors} />
          <StatusLine
            symbol={summary.tone === "success" ? "checkmark.circle.fill" : summary.tone === "failure" ? "xmark.circle.fill" : "clock.fill"}
            color={summary.tone === "success" ? colors.success : summary.tone === "failure" ? colors.failure : colors.pending}
            text={summary.text}
          />
          {(showAll ? failing : failing.slice(0, 3)).map((c) => (
            <FailingCheckRow key={c.name} check={c} colors={colors} onPress={() => c.url && open(windowId, c.url)} />
          ))}
          {failing.length > 3 && !showAll ? <LinkText text={`Show all ${failing.length} failures`} onPress={() => setShowAll(true)} /> : null}
        </View>
      ) : null}

      {pr.mergeable === "conflicting" ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <StatusLine symbol="exclamationmark.triangle.fill" color={colors.conflict} text="This branch has conflicts" />
          </View>
          <SmallButton title="Resolve Conflicts" onPress={() => open(windowId, `${item.url}/conflicts`)} />
        </View>
      ) : null}

      {pr.review ? (
        <StatusLine
          symbol={pr.review === "approved" ? "checkmark.seal.fill" : pr.review === "changesRequested" ? "arrow.uturn.backward.circle.fill" : "eye"}
          color={pr.review === "approved" ? colors.success : pr.review === "changesRequested" ? colors.failure : theme.textSecondary}
          text={pr.review === "approved" ? "Approved" : pr.review === "changesRequested" ? "Changes Requested" : item.section === "authored" ? "Review required" : "Needs your review"}
        />
      ) : null}

      <View style={{ height: 0.5, backgroundColor: theme.divider }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Pressable
          onPress={() => {
            dismissHover();
            openLiveItem(windowId, folderId, item);
          }}
          style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
        >
          <Symbol name="bubble.left" size={10.5} color={theme.textSecondary} style={{ width: 14, height: 14 }} />
          <Text style={{ fontSize: 11.5, color: theme.textSecondary }}>
            {pr.comments === 1 ? "1 comment" : `${pr.comments} comments`}
            {pr.unresolvedThreads ? ` · ${pr.unresolvedThreads} unresolved` : ""}
          </Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        {pr.additions || pr.deletions ? (
          <Text style={{ fontSize: 11.5, fontVariant: ["tabular-nums"], color: theme.textSecondary }}>
            <Text style={{ color: colors.success }}>+{pr.additions}</Text> <Text style={{ color: colors.failure }}>−{pr.deletions}</Text>
            {pr.changedFiles ? ` · ${pr.changedFiles} ${pr.changedFiles === 1 ? "file" : "files"}` : ""}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** CI as one bar: passed, running (pulsing) and failing segments, proportional to their counts. */
function CIProgressBar({ checks, colors }: { checks: PullRequestCheck[]; colors: LiveColors }) {
  const success = checks.filter((c) => c.state === "success" || c.state === "neutral").length;
  const pending = checks.filter((c) => c.state === "pending" || c.state === "queued").length;
  const failure = checks.filter((c) => c.state === "failure").length;
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!pending) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.45, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pending]);
  return (
    <View style={{ height: 6, borderRadius: 3, overflow: "hidden", flexDirection: "row", backgroundColor: colors.ciTrack, gap: 2 }}>
      {success ? <View style={{ flex: success, backgroundColor: colors.success }} /> : null}
      {pending ? <Animated.View style={{ flex: pending, backgroundColor: colors.pending, opacity: pulse }} /> : null}
      {failure ? <View style={{ flex: failure, backgroundColor: colors.failure }} /> : null}
    </View>
  );
}

function FailingCheckRow({ check, colors, onPress }: { check: PullRequestCheck; colors: LiveColors; onPress(): void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress}>
        <View style={{ height: 24, borderRadius: 6, flexDirection: "row", alignItems: "center", paddingHorizontal: 5, gap: 6, backgroundColor: hovered ? theme.rowHover : undefined }}>
          <Symbol name="xmark" size={9} weight="bold" color={colors.failure} style={{ width: 12, height: 12 }} />
          <FadeLabel text={check.name} fontSize={12} color={theme.textPrimary} style={{ flex: 1, height: 16 }} />
          {hovered ? <Symbol name="arrow.up.forward" size={9} color={theme.textSecondary} style={{ width: 12, height: 12 }} /> : null}
        </View>
      </Pressable>
    </View>
  );
}

function StatusLine({ symbol, color, text }: { symbol: string; color: string; text: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Symbol name={symbol} size={11} color={color} style={{ width: 14, height: 14 }} />
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: theme.textPrimary }}>
        {text}
      </Text>
    </View>
  );
}

function Chip({ text, color }: { text: string; color: string }) {
  return (
    <View style={{ height: 17, borderRadius: 8.5, paddingHorizontal: 7, borderWidth: 0.5, borderColor: color, justifyContent: "center" }}>
      <Text style={{ fontSize: 10.5, fontWeight: "500", color }}>{text}</Text>
    </View>
  );
}

export function SmallButton({ title, onPress, primary, icon, height = 24 }: { title: string; onPress(): void; primary?: boolean; icon?: string; height?: number }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const fg = primary ? (theme.dark ? "#000000" : "#FFFFFF") : theme.textPrimary;
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress}>
        {({ pressed }) => (
          <View
            style={{
              height,
              borderRadius: height > 26 ? 9 : 7,
              paddingHorizontal: 9,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
              backgroundColor: primary ? theme.textPrimary : pressed ? theme.toolbarPressed : hovered ? theme.toolbarHover : theme.urlPill,
              opacity: primary && (pressed || hovered) ? 0.85 : 1,
            }}
          >
            {icon ? <Symbol name={icon} size={10.5} weight="semibold" color={fg} style={{ width: 14, height: 14 }} /> : null}
            <Text style={{ fontSize: 12, fontWeight: "500", color: fg }}>{title}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

function LinkText({ text, onPress }: { text: string; onPress(): void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress}>
        <Text style={{ fontSize: 12, color: theme.accent, textDecorationLine: hovered ? "underline" : "none" }}>{text}</Text>
      </Pressable>
    </View>
  );
}

function DocumentPreview({ item }: { item: LiveItem }) {
  const theme = useTheme();
  const doc = item.doc;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {item.icon && /^https?:/.test(item.icon) ? <TabIcon url={item.url} favicon={item.icon} direct /> : <TabIcon url={item.url} icon={item.icon} />}
        <Text numberOfLines={2} style={{ flex: 1, fontSize: 13.5, lineHeight: 18, fontWeight: "600", color: theme.textPrimary }}>
          {item.title}
        </Text>
      </View>
      <Text numberOfLines={1} style={{ fontSize: 12, color: theme.textSecondary }}>
        {[doc?.kind, doc?.place ?? item.subtitle].filter(Boolean).join(" · ")}
      </Text>
      {item.updatedAt ? (
        <Text numberOfLines={1} style={{ fontSize: 12, color: theme.textSecondary }}>
          Edited {ago(item.updatedAt, Date.now())}
          {doc?.editedBy ? ` by ${doc.editedBy}` : ""}
        </Text>
      ) : null}
    </View>
  );
}
