import type { LiveFolder, LiveItem, PullRequestSection } from "./types";

/**
 * What a live folder shows, in order: your PRs (stacks as one collapsible
 * entry), then "Review Requests" and "Team Review Requests"; documents in one
 * list. Long sections end in "Show N More" (Dia's reveal-more cell).
 */
export type FolderRow =
  | { kind: "item"; key: string; item: LiveItem }
  | { kind: "stack"; key: string; id: string; repo: string; items: LiveItem[] }
  | { kind: "header"; key: string; title: string }
  | { kind: "more"; key: string; section: string; count: number };

export const SECTION_TITLES: Record<PullRequestSection, string | null> = {
  authored: null,
  review: "Review Requests",
  team: "Team Review Requests",
};

export const PAGE_SIZE = 8;

export function folderRows(folder: Pick<LiveFolder, "id" | "kind">, items: LiveItem[], showAll: Record<string, boolean>, page = PAGE_SIZE): FolderRow[] {
  const sections: [string, LiveItem[]][] =
    folder.kind === "pullRequests"
      ? (["authored", "review", "team"] as const).map((s) => [s, items.filter((it) => (it.section ?? "authored") === s)])
      : [["documents", items]];
  const rows: FolderRow[] = [];
  for (const [section, members] of sections) {
    if (!members.length) continue;
    const title = SECTION_TITLES[section as PullRequestSection];
    if (title) rows.push({ kind: "header", key: `h:${section}`, title });
    const entries: FolderRow[] = [];
    const stacked = new Set<string>();
    for (const it of members) {
      const stack = it.pr?.stack;
      if (!stack) {
        entries.push({ kind: "item", key: it.id, item: it });
        continue;
      }
      if (stacked.has(stack.id)) continue;
      stacked.add(stack.id);
      const inStack = members.filter((m) => m.pr?.stack?.id === stack.id).sort((a, b) => a.pr!.stack!.position - b.pr!.stack!.position);
      entries.push({ kind: "stack", key: stack.id, id: stack.id, repo: it.pr!.repo, items: inStack });
    }
    const all = showAll[`${folder.id}:${section}`];
    rows.push(...(all ? entries : entries.slice(0, page)));
    if (!all && entries.length > page) rows.push({ kind: "more", key: `m:${section}`, section, count: entries.length - page });
  }
  return rows;
}
