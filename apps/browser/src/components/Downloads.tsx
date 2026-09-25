import { cancelDownload, pauseDownload, resumeDownload, type Download } from "@netnyahoo/cef";
import { ContextMenuArea, copyText, fileExists, fileIcon, MouseArea, moveToTrash, openFile, revealFile, showMenu, Surface, Symbol, type MenuItem } from "@netnyahoo/shell";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { hex, useTheme } from "../lib/theme";
import { useShallow } from "zustand/react/shallow";
import { useBrowser } from "../store/browser";
import { useSidebarOpen, useWindowId, useWindowUi } from "../store/hooks";
import { downloadsIn, downloadVisibleIn } from "../store/ui";
import { SIDEBAR_FIELD, SIDEBAR_HEADER_WITH_FIELD, useAddressBarInSidebar, useTabLayout } from "./layout/windowLayout";
import { openInternalPage } from "./pages/urls";
import { useSidebarWidth } from "./sidebar/tokens";
import { IconButton, useHover } from "./primitives";

// MARK: Formatting

export function formatBytes(n: number) {
  if (n < 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} sec left`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min left`;
  return `${Math.round(seconds / 3600)} hr left`;
}

/** Chrome-style status line: "1.2 MB of 5.0 MB, 2 MB/s — 3 sec left", "Paused", "Deleted"… */
export function downloadStatus(d: Download, exists = true) {
  if (d.state === "finished") return exists ? formatBytes(d.total > 0 ? d.total : d.received) : "Deleted";
  // Dia's wording.
  if (d.state === "failed") return "Failed to Download";
  if (d.state === "cancelled") return "Cancelled";
  const progress = d.total > 0 ? `${formatBytes(d.received)} of ${formatBytes(d.total)}` : formatBytes(d.received);
  if (d.paused) return `${progress} — Paused`;
  if (d.speed > 0 && d.total > 0) return `${progress}, ${formatBytes(d.speed)}/s — ${formatDuration((d.total - d.received) / d.speed)}`;
  return progress;
}

// MARK: Actions

/** Downloads flagged "Open When Done" (this session only: a download can't outlive a relaunch). */
const openWhenDone = new Set<string>();
export const isOpenWhenDone = (id: string) => openWhenDone.has(id);

// Finished downloads flagged "Open When Done" open themselves. Guarded against re-subscribing on reload.
const g = globalThis as { __nnDownloadsWatch?: () => void };
g.__nnDownloadsWatch?.();
g.__nnDownloadsWatch = useBrowser.subscribe((s, prev) => {
  if (s.downloads === prev.downloads || !openWhenDone.size) return;
  for (const d of s.downloads) {
    if (d.state !== "downloading" && openWhenDone.delete(d.id) && d.state === "finished") void openFile(d.path);
  }
});

export function toggleOpenWhenDone(id: string) {
  if (openWhenDone.has(id)) openWhenDone.delete(id);
  else openWhenDone.add(id);
}

export async function downloadMenu(d: Download, windowId: string) {
  const exists = d.state === "finished" && fileExists(d.path);
  const items: MenuItem[] =
    d.state === "downloading"
      ? [
          { id: "whenDone", title: "Open When Done", checked: openWhenDone.has(d.id) },
          { id: d.paused ? "resume" : "pause", title: d.paused ? "Resume" : "Pause" },
          { id: "cancel", title: "Cancel" },
        ]
      : [
          { id: "open", title: "Open", enabled: exists },
          { id: "reveal", title: "Show in Finder", enabled: exists },
        ];
  items.push(
    { separator: true },
    { id: "copy", title: "Copy Download Link" },
    { id: "page", title: "Show All Downloads" },
    { separator: true },
    ...(exists ? [{ id: "trash", title: "Move to Trash" }] : []),
    { id: "remove", title: "Remove from List", enabled: d.state !== "downloading" },
  );
  const choice = await showMenu(items);
  if (choice === "whenDone") toggleOpenWhenDone(d.id);
  if (choice === "pause") void pauseDownload(d.id);
  if (choice === "resume") void resumeDownload(d.id);
  if (choice === "cancel") void cancelDownload(d.id);
  if (choice === "open") void openFile(d.path);
  if (choice === "reveal") void revealFile(d.path);
  if (choice === "copy") copyText(d.url);
  if (choice === "page") openInternalPage("downloads", windowId);
  if (choice === "trash") void trashDownload(d);
  if (choice === "remove") useBrowser.getState().removeDownload(d.id);
}

/** Move to Trash: the file goes, and so does its row. */
export async function trashDownload(d: Download) {
  if (await moveToTrash(d.path)) useBrowser.getState().removeDownload(d.id);
}

/** The file's Finder icon (cached per path/extension). */
const iconCache = new Map<string, string | null>();
export function FileIcon({ path, size = 28 }: { path: string; size?: number }) {
  const theme = useTheme();
  const key = `${path}@${size}`;
  const [uri, setUri] = useState(() => iconCache.get(key) ?? null);
  useEffect(() => {
    if (iconCache.has(key)) return setUri(iconCache.get(key) ?? null);
    let live = true;
    void fileIcon(path || "file.bin", size).then((u) => {
      iconCache.set(key, u);
      if (live) setUri(u);
    });
    return () => {
      live = false;
    };
  }, [key]);
  return uri ? (
    <Image source={{ uri }} style={{ width: size, height: size }} />
  ) : (
    <Symbol name="doc" size={size * 0.62} color={theme.icon} style={{ width: size, height: size }} />
  );
}

// MARK: Popover

/** Dia's Downloads/DownloadProgressBarBackground. */
const progressTrack = (dark: boolean) => (dark ? "#717782" : "#CED7E7");

/**
 * Dia's recent-downloads popover under the sidebar's downloads button (⇧⌘J):
 * "RECENT DOWNLOADS" with Clear, the rows (drag a finished file out, click to
 * open), then "View all downloads".
 */
export function DownloadsPopover() {
  const theme = useTheme();
  const windowId = useWindowId();
  const open = useWindowUi().downloadsOpen;
  const downloads = useBrowser(useShallow((s) => downloadsIn(s, windowId)));
  // Under the downloads button: the sidebar header's (or the URL field row's, with the address
  // bar in the sidebar), or the top strip's (right end).
  const top = useTabLayout() === "top";
  const addressBar = useAddressBarInSidebar();
  const setOpen = (value: boolean) => useBrowser.getState().setDownloadsOpen(windowId, value);
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!open) return;
    appear.setValue(0);
    Animated.timing(appear, { toValue: 1, duration: 160, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [open]);
  if (!open) return null;

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* A click anywhere else dismisses it. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
      <Animated.View
        style={{
          position: "absolute",
          top: addressBar ? SIDEBAR_HEADER_WITH_FIELD : 44,
          ...(top ? { right: 8 } : { left: 10 }),
          opacity: appear,
          transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [-4, 0] }) }],
        }}
      >
        <Surface
          fill={hex(theme.panel)}
          cornerRadius={14}
          borderColor={hex(theme.panelBorder)}
          borderWidth={0.5}
          shadowColor="#000000"
          shadowOpacity={theme.panelShadowOpacity}
          shadowRadius={20}
          shadowOffset={[0, 8]}
          style={{ width: 340, paddingTop: 6, paddingBottom: 6 }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: 14, paddingRight: 8, height: 28 }}>
            <Text style={{ flex: 1, fontSize: 11, fontWeight: "600", letterSpacing: 0.4, color: theme.dark ? "rgba(247,245,255,0.6)" : "rgba(0,0,0,0.6)" }}>
              RECENT DOWNLOADS
            </Text>
            {downloads.some((d) => d.state !== "downloading") && <TextButton title="Clear" onPress={() => useBrowser.getState().clearDownloads(windowId)} />}
          </View>
          {downloads.length === 0 ? (
            <Text style={{ paddingHorizontal: 14, paddingVertical: 12, fontSize: 13, color: theme.textTertiary }}>No downloads yet</Text>
          ) : (
            <ScrollView style={{ maxHeight: 8 * 52 }} contentContainerStyle={{ paddingHorizontal: 6 }}>
              {downloads.map((d) => (
                <DownloadRow key={d.id} d={d} windowId={windowId} />
              ))}
            </ScrollView>
          )}
          <View style={{ height: 0.5, marginHorizontal: 12, marginTop: 6, marginBottom: 4, backgroundColor: theme.dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)" }} />
          <FooterButton
            title="View all downloads"
            onPress={() => {
              setOpen(false);
              openInternalPage("downloads", windowId);
            }}
          />
        </Surface>
      </Animated.View>
    </View>
  );
}

function TextButton({ title, onPress }: { title: string; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress}>
        <View style={{ height: 22, paddingHorizontal: 7, borderRadius: 6, justifyContent: "center", backgroundColor: hovered ? theme.toolbarHover : undefined }}>
          <Text style={{ fontSize: 12, color: theme.textSecondary }}>{title}</Text>
        </View>
      </Pressable>
    </View>
  );
}

function FooterButton({ title, onPress }: { title: string; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} style={{ paddingHorizontal: 6 }}>
      <Pressable onPress={onPress}>
        <View style={{ height: 30, paddingHorizontal: 8, borderRadius: 8, flexDirection: "row", alignItems: "center", backgroundColor: hovered ? theme.rowHover : undefined }}>
          <Text style={{ flex: 1, fontSize: 13, color: hovered ? theme.textPrimary : theme.textSecondary }}>{title}</Text>
          <Symbol name="chevron.right" size={9} weight="semibold" color={theme.textTertiary} style={{ width: 12, height: 12 }} />
        </View>
      </Pressable>
    </View>
  );
}

function DownloadRow({ d, windowId }: { d: Download; windowId: string }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const exists = d.state !== "finished" || fileExists(d.path);
  const progress = d.total > 0 ? d.received / d.total : 0;
  const done = d.state === "finished" && exists;
  return (
    <View {...hoverProps}>
      <MouseArea path={done ? d.path : null}>
        <ContextMenuArea onContextMenu={() => void downloadMenu(d, windowId)}>
          <Pressable onPress={() => done && void openFile(d.path)}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingHorizontal: 8,
                height: 52,
                borderRadius: 10,
                backgroundColor: hovered ? theme.rowHover : undefined,
              }}
            >
              <View style={{ opacity: exists ? 1 : 0.45 }}>
                <FileIcon path={d.path || d.filename} size={30} />
              </View>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ fontSize: 13, color: exists ? theme.textPrimary : theme.textSecondary, textDecorationLine: exists ? "none" : "line-through" }}>
                  {d.filename || "Preparing…"}
                </Text>
                {d.state === "downloading" ? (
                  <View style={{ height: 3, borderRadius: 1.5, marginTop: 5, backgroundColor: progressTrack(theme.dark) }}>
                    <View
                      style={{ width: `${Math.max(progress, 0.03) * 100}%`, height: 3, borderRadius: 1.5, backgroundColor: d.paused ? theme.textTertiary : theme.accent }}
                    />
                  </View>
                ) : null}
                <Text numberOfLines={1} style={{ fontSize: 11, marginTop: 3, color: theme.dark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.7)" }}>
                  {downloadStatus(d, exists)}
                </Text>
              </View>
              {d.state === "downloading" ? (
                <View style={{ flexDirection: "row" }}>
                  <IconButton
                    icon={d.paused ? "play.circle.fill" : "pause.circle.fill"}
                    size={15}
                    box={26}
                    radius={7}
                    onPress={() => void (d.paused ? resumeDownload(d.id) : pauseDownload(d.id))}
                    tooltip={d.paused ? "Resume" : "Pause"}
                  />
                  <IconButton icon="xmark.circle.fill" size={15} box={26} radius={7} onPress={() => void cancelDownload(d.id)} tooltip="Cancel" />
                </View>
              ) : done && hovered ? (
                <IconButton icon="magnifyingglass.circle.fill" size={15} box={26} radius={7} onPress={() => void revealFile(d.path)} tooltip="Show in Finder" />
              ) : null}
            </View>
          </Pressable>
        </ContextMenuArea>
      </MouseArea>
    </View>
  );
}

// MARK: Magnet

/**
 * Dia's "magnet": a new download's icon flies from the page into the sidebar's
 * downloads button. Runs in the window that was focused when it started.
 */
export function DownloadMagnet() {
  const windowId = useWindowId();
  const sidebarOpen = useSidebarOpen();
  const sidebarWidth = useSidebarWidth(windowId);
  const topStrip = useTabLayout() === "top";
  const addressBar = useAddressBarInSidebar();
  const [flight, setFlight] = useState<{ id: string; path: string } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const t = useRef(new Animated.Value(0)).current;
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    seen.current = new Set(useBrowser.getState().downloads.map((d) => d.id));
    return useBrowser.subscribe((s, prev) => {
      if (s.downloads === prev.downloads) return;
      const fresh = s.downloads.find((d) => !seen.current!.has(d.id));
      s.downloads.forEach((d) => seen.current!.add(d.id));
      if (!fresh || s.ui.focusedWindowId !== windowId || !downloadVisibleIn(fresh, s.windows[windowId])) return;
      t.setValue(0);
      setFlight({ id: fresh.id, path: fresh.path || fresh.filename });
      Animated.timing(t, { toValue: 1, duration: 700, easing: Easing.bezier(0.45, 0, 0.2, 1), useNativeDriver: false }).start(() => setFlight(null));
    });
  }, [windowId]);

  // The downloads button: right end of the sidebar header (34pt button, 7 in), or of the top
  // strip (8 in); the top-left corner while the sidebar is auto-hidden. With the address bar in
  // the sidebar it's at the end of the URL field row.
  const sidebar = !topStrip && sidebarOpen ? sidebarWidth : 0;
  const field = { x: sidebarWidth - 7 - SIDEBAR_FIELD.height / 2, y: SIDEBAR_FIELD.top + SIDEBAR_FIELD.height / 2 };
  const target = topStrip ? { x: size.width - 25, y: 27 } : addressBar ? field : sidebarOpen ? { x: sidebarWidth - 24, y: 27 } : { x: 24, y: 24 };
  const start = { x: sidebar + (size.width - sidebar) / 2, y: size.height * 0.45 };
  const icon = 44;
  const steps = [0, 0.25, 0.5, 0.75, 1];
  // A shallow arc: rises a little before dropping into the button.
  const x = t.interpolate({ inputRange: steps, outputRange: steps.map((p) => start.x + (target.x - start.x) * p - icon / 2) });
  const y = t.interpolate({ inputRange: steps, outputRange: steps.map((p) => start.y + (target.y - start.y) * p - Math.sin(Math.PI * p) * 90 - icon / 2) });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={(e) => setSize(e.nativeEvent.layout)}>
      {flight && (
        <Animated.View
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: icon,
            height: icon,
            opacity: t.interpolate({ inputRange: [0, 0.1, 0.8, 1], outputRange: [0, 1, 1, 0] }),
            transform: [{ translateX: x }, { translateY: y }, { scale: t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.6, 1.1, 0.3] }) }],
          }}
        >
          <FileIcon path={flight.path} size={icon} />
        </Animated.View>
      )}
    </View>
  );
}
