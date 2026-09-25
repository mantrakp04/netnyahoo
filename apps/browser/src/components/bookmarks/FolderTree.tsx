import { Symbol } from "@netnyahoo/shell";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "../../lib/theme";
import { bookmarkAncestors, folderChildren } from "../../store/bookmarks";
import { useBrowser } from "../../store/browser";
import { useHover } from "../primitives";
import { useFormColors } from "../settings/controls";

type FolderRow = { id: string; title: string; depth: number; hasChildren: boolean };

/** A profile's folders in display order (Bookmarks Bar, Other Bookmarks, then nested), skipping collapsed ones. */
function useFolderRows(profileId: string, expanded: Set<string>): FolderRow[] {
  // Selected as one string so the store subscription compares by value.
  const key = useBrowser((s) => {
    const roots = s.bookmarks.roots[profileId];
    if (!roots) return "";
    const lines: string[] = [];
    const walk = (id: string, depth: number) => {
      const node = s.bookmarks.nodes[id];
      if (node?.kind !== "folder") return;
      const sub = folderChildren(s.bookmarks, id).filter((c) => c.kind === "folder");
      lines.push(JSON.stringify([id, node.title, depth, sub.length > 0]));
      if (expanded.has(id)) sub.forEach((c) => walk(c.id, depth + 1));
    };
    walk(roots.bar, 0);
    walk(roots.other, 0);
    return lines.join("\n");
  });
  return useMemo(
    () =>
      key
        ? key.split("\n").map((line) => {
            const [id, title, depth, hasChildren] = JSON.parse(line) as [string, string, number, boolean];
            return { id, title, depth, hasChildren };
          })
        : [],
    [key],
  );
}

/**
 * The folder tree used by the bookmark save dialog and the Bookmarks manager.
 * Roots start expanded, and so does the path to the selected folder.
 */
export function FolderTree({
  profileId,
  selectedId,
  onSelect,
  rowHeight = 26,
  wrapRow,
}: {
  profileId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  rowHeight?: number;
  /** Lets the manager make rows drop targets. */
  wrapRow?: (id: string, row: ReactNode) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(() => {
    const s = useBrowser.getState();
    const roots = s.bookmarks.roots[profileId];
    const open = new Set<string>(roots ? [roots.bar, roots.other] : []);
    if (selectedId) for (const a of bookmarkAncestors(s.bookmarks, selectedId)) open.add(a.id);
    return open;
  });
  // A folder selected from elsewhere (just created, picked in the list) is revealed.
  useEffect(() => {
    if (!selectedId) return;
    const hidden = bookmarkAncestors(useBrowser.getState().bookmarks, selectedId).filter((a) => !expanded.has(a.id));
    if (hidden.length) setExpanded((prev) => new Set([...prev, ...hidden.map((a) => a.id)]));
  }, [selectedId]);
  const rows = useFolderRows(profileId, expanded);
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <View>
      {rows.map((row) => {
        const content = (
          <FolderTreeRow
            key={row.id}
            row={row}
            height={rowHeight}
            selected={row.id === selectedId}
            expanded={expanded.has(row.id)}
            onToggle={() => toggle(row.id)}
            onSelect={() => onSelect(row.id)}
          />
        );
        return wrapRow ? <View key={row.id}>{wrapRow(row.id, content)}</View> : content;
      })}
    </View>
  );
}

function FolderTreeRow({
  row,
  height,
  selected,
  expanded,
  onToggle,
  onSelect,
}: {
  row: FolderRow;
  height: number;
  selected: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const theme = useTheme();
  const colors = useFormColors();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={onSelect}>
        <View
          style={{
            height,
            borderRadius: 6,
            flexDirection: "row",
            alignItems: "center",
            paddingLeft: 4 + row.depth * 16,
            paddingRight: 8,
            backgroundColor: selected ? colors.accent : hovered ? colors.selected : undefined,
          }}
        >
          <Pressable onPress={onToggle} disabled={!row.hasChildren} style={{ width: 16, height, alignItems: "center", justifyContent: "center" }}>
            {row.hasChildren ? (
              <Symbol
                name={expanded ? "chevron.down" : "chevron.right"}
                size={9}
                weight="semibold"
                color={selected ? "#FFFFFFCC" : theme.textSecondary}
                style={{ width: 16, height: 16 }}
              />
            ) : null}
          </Pressable>
          <Symbol name="folder" size={13} color={selected ? "#FFFFFF" : theme.icon} style={{ width: 18, height: 18 }} />
          <Text numberOfLines={1} style={{ flex: 1, marginLeft: 6, fontSize: 13, color: selected ? "#FFFFFF" : theme.textPrimary }}>
            {row.title}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}
