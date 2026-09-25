import { cancelDownload, pauseDownload, resumeDownload, type Download } from "@netnyahoo/cef";
import { fileExists, MouseArea, openFile, revealFile, Symbol } from "@netnyahoo/shell";
import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { downloadsIn } from "../../store/ui";
import { openUrl } from "../bookmarks/actions";
import { downloadMenu, downloadStatus, FileIcon } from "../Downloads";
import { IconButton, useHover } from "../primitives";
import { Button, useFormColors } from "../settings/controls";
import { EmptyState, hostLabel, matchesQuery, PAGE_WIDTH, PageHeader } from "./PageLayout";

/** Every download (Chrome's chrome://downloads): search, open, show in Finder, drag out, clear. */
export function DownloadsPage({ tabId }: { tabId: string }) {
  const theme = useTheme();
  const windowId = useBrowser((s) => s.tabs[tabId]?.windowId ?? "");
  const downloads = useBrowser(useShallow((s) => downloadsIn(s, windowId)));
  const [query, setQuery] = useState("");
  const shown = downloads.filter((d) => matchesQuery(query, d.filename, d.url));

  return (
    <View style={{ flex: 1 }}>
      <PageHeader
        title="Downloads"
        query={query}
        onQuery={setQuery}
        placeholder="Search downloads"
        actions={downloads.some((d) => d.state !== "downloading") ? <Button title="Clear All" onPress={() => useBrowser.getState().clearDownloads(windowId)} /> : null}
      />
      {shown.length === 0 ? (
        <EmptyState
          icon={<Symbol name="arrow.down.circle" size={30} color={theme.textTertiary} style={{ width: 40, height: 40 }} />}
          title={query ? "No search results found" : "Files you download appear here"}
        />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(d) => d.id}
          contentContainerStyle={{ alignItems: "center", paddingTop: 8, paddingBottom: 40, gap: 8 }}
          renderItem={({ item }) => <DownloadCard d={item} windowId={windowId} />}
        />
      )}
    </View>
  );
}

function DownloadCard({ d, windowId }: { d: Download; windowId: string }) {
  const theme = useTheme();
  const colors = useFormColors();
  const { hovered, hoverProps } = useHover();
  const exists = d.state !== "finished" || fileExists(d.path);
  const done = d.state === "finished" && exists;
  const progress = d.total > 0 ? d.received / d.total : 0;
  return (
    <View {...hoverProps} style={{ width: PAGE_WIDTH - 32, maxWidth: "100%" }}>
      <MouseArea path={done ? d.path : null}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 14,
            padding: 14,
            borderRadius: 12,
            backgroundColor: hovered ? theme.rowHover : colors.group,
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: colors.groupBorder,
          }}
        >
          <View style={{ opacity: exists ? 1 : 0.45 }}>
            <FileIcon path={d.path || d.filename} size={36} />
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Pressable disabled={!done} onPress={() => void openFile(d.path)}>
              <Text
                numberOfLines={1}
                style={{ fontSize: 13.5, fontWeight: "500", color: exists ? theme.textPrimary : theme.textSecondary, textDecorationLine: exists ? "none" : "line-through" }}
              >
                {d.filename || "Preparing…"}
              </Text>
            </Pressable>
            <Pressable onPress={() => openUrl(d.url, windowId, "foreground")}>
              <Text numberOfLines={1} style={{ fontSize: 12, color: theme.textTertiary }}>
                {hostLabel(d.url)}
              </Text>
            </Pressable>
            {d.state === "downloading" && (
              <View style={{ height: 3, borderRadius: 1.5, marginTop: 3, backgroundColor: theme.rowHover }}>
                <View style={{ width: `${Math.max(progress, 0.03) * 100}%`, height: 3, borderRadius: 1.5, backgroundColor: d.paused ? theme.textTertiary : theme.accent }} />
              </View>
            )}
            <Text numberOfLines={1} style={{ fontSize: 12, color: theme.textSecondary }}>
              {downloadStatus(d, exists)}
            </Text>
          </View>
          {d.state === "downloading" ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button title={d.paused ? "Resume" : "Pause"} onPress={() => void (d.paused ? resumeDownload(d.id) : pauseDownload(d.id))} />
              <Button title="Cancel" onPress={() => void cancelDownload(d.id)} />
            </View>
          ) : done ? (
            <Button title="Show in Finder" onPress={() => void revealFile(d.path)} />
          ) : null}
          <IconButton icon="ellipsis" size={13} box={26} radius={6} onPress={() => void downloadMenu(d, windowId)} tooltip="More actions" />
          {d.state !== "downloading" && (
            <IconButton icon="xmark" size={11} box={26} radius={6} onPress={() => useBrowser.getState().removeDownload(d.id)} tooltip="Remove from List" />
          )}
        </View>
      </MouseArea>
    </View>
  );
}
