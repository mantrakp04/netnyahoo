import { resolveInput } from "@netnyahoo/core";
import { Surface } from "@netnyahoo/shell";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { hex, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useWindowId } from "../../store/hooks";
import { searchUrlPrefix } from "../../store/settings";
import { Button, TextField, useFormColors } from "../settings/controls";
import { useBookmarkEditor, type EditorState } from "./edit";
import { FolderTree } from "./FolderTree";

/** Chrome's Edit bookmark / Add page / Rename folder sheet, over the window. */
export function EditBookmarkDialog() {
  const windowId = useWindowId();
  const open = useBookmarkEditor((e) => (e.open?.windowId === windowId ? e.open : null));
  if (!open) return null;
  return <Sheet key={`${open.bookmarkId}:${open.folder}`} state={open} />;
}

function Sheet({ state }: { state: EditorState }) {
  const theme = useTheme();
  const colors = useFormColors();
  const node = useBrowser.getState().bookmarks.nodes[state.bookmarkId ?? ""];
  const [title, setTitle] = useState(node?.title ?? "");
  const [url, setUrl] = useState(node?.kind === "url" ? node.url : "");
  const [parentId, setParentId] = useState<string | null>(
    node?.parentId ?? state.parentId ?? useBrowser.getState().bookmarks.roots[state.profileId]?.bar ?? null,
  );
  const close = () => useBookmarkEditor.getState().set(null);
  const resolvedUrl = url.trim() ? resolveInput(url, searchUrlPrefix(useBrowser.getState().settings)) : "";
  const valid = state.folder ? !!title.trim() : !!resolvedUrl;

  const save = () => {
    if (!valid) return;
    const s = useBrowser.getState();
    if (node) {
      s.updateBookmark(node.id, state.folder ? { title: title.trim() } : { title: title.trim(), url: resolvedUrl });
      if (parentId && parentId !== node.parentId) s.moveBookmark(node.id, parentId);
    } else if (state.folder) {
      s.addBookmarkFolder({ profileId: state.profileId, title: title.trim(), parentId: parentId ?? undefined, index: state.index });
    } else {
      s.addBookmark({ profileId: state.profileId, url: resolvedUrl, title: title.trim() || resolvedUrl, parentId: parentId ?? undefined, index: state.index });
    }
    close();
  };

  const heading = state.folder ? (node ? "Rename Folder" : "New Folder") : node ? "Edit Bookmark" : "Add Bookmark";

  return (
    <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: theme.dark ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.15)" }]} onPress={close} />
      <Surface
        fill={hex(theme.panel)}
        cornerRadius={14}
        borderColor={hex(theme.panelBorder)}
        borderWidth={0.5}
        shadowColor="#000000"
        shadowOpacity={theme.panelShadowOpacity}
        shadowRadius={30}
        shadowOffset={[0, 12]}
        style={{ width: 420, padding: 18 }}
      >
        <Text style={{ fontSize: 15, fontWeight: "600", color: theme.textPrimary }}>{heading}</Text>
        <Label text="Name" />
        <TextField value={title} onChangeText={setTitle} autoFocus selectOnFocus onSubmit={save} onEscape={close} />
        {!state.folder && (
          <>
            <Label text="URL" />
            <TextField value={url} onChangeText={setUrl} placeholder="https://" onSubmit={save} onEscape={close} />
          </>
        )}
        {(!state.folder || !node) && (
          <>
            <Label text="Folder" />
            <View
              style={{ height: 180, borderRadius: 7, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.fieldBorder, backgroundColor: colors.field }}
            >
              <ScrollView contentContainerStyle={{ padding: 4 }}>
                <FolderTree profileId={state.profileId} selectedId={parentId} onSelect={setParentId} rowHeight={24} />
              </ScrollView>
            </View>
          </>
        )}
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <Button title="Cancel" onPress={close} />
          <Button title="Save" kind="primary" disabled={!valid} onPress={save} />
        </View>
      </Surface>
    </View>
  );
}

function Label({ text }: { text: string }) {
  const theme = useTheme();
  return <Text style={{ fontSize: 11.5, marginTop: 12, marginBottom: 5, color: theme.textSecondary }}>{text}</Text>;
}
