import type { LiveItem } from "./types";

/**
 * Response mappers for the Documents live folder (Notion, Confluence, Google
 * Drive) and Bitbucket pull requests. Pure, like ./github; ./sources fetches.
 */

// MARK: Notion (POST /v1/search, GET /v1/users)

type NotionRichText = { plain_text: string }[];
type NotionPage = {
  object: "page" | "database";
  id: string;
  url: string;
  archived?: boolean;
  in_trash?: boolean;
  last_edited_time: string;
  last_edited_by?: { id: string };
  icon?: { type: "emoji"; emoji: string } | { type: "external"; external: { url: string } } | { type: "file"; file: { url: string } } | null;
  title?: NotionRichText;
  properties?: Record<string, { type: string; title?: NotionRichText }>;
};

export type NotionSearch = { results: NotionPage[] };
export type NotionUsers = { results: { id: string; name: string | null }[] };

export const NOTION_SEARCH_BODY = {
  sort: { direction: "descending", timestamp: "last_edited_time" },
  page_size: 30,
};

function notionTitle(p: NotionPage): string {
  const title = p.title ?? Object.values(p.properties ?? {}).find((v) => v.type === "title")?.title ?? [];
  return title.map((t) => t.plain_text).join("").trim() || "Untitled";
}

export function mapNotion(json: NotionSearch, users: NotionUsers | null, workspace: string | null): LiveItem[] {
  const names = new Map((users?.results ?? []).map((u) => [u.id, u.name]));
  return json.results
    .filter((p) => !p.archived && !p.in_trash)
    .map((p) => ({
      id: `notion:${p.id}`,
      source: "notion" as const,
      url: p.url,
      title: notionTitle(p),
      subtitle: workspace ?? "Notion",
      icon: p.icon?.type === "emoji" ? p.icon.emoji : p.icon?.type === "external" ? p.icon.external.url : p.icon?.type === "file" ? p.icon.file.url : null,
      updatedAt: Date.parse(p.last_edited_time) || 0,
      doc: { kind: p.object === "database" ? "Database" : "Page", editedBy: (p.last_edited_by && names.get(p.last_edited_by.id)) ?? null, place: workspace },
    }));
}

// MARK: Confluence (GET /wiki/rest/api/content/search)

export type ConfluenceSearch = {
  results: {
    id: string;
    type: string;
    title: string;
    space?: { key: string; name: string };
    history?: { lastUpdated?: { when: string; by?: { displayName: string } } };
    _links: { webui: string };
  }[];
  _links?: { base?: string };
};

/** Pages you created, edited or watch, most recently changed first. */
export const CONFLUENCE_CQL = "type=page AND (contributor=currentUser() OR creator=currentUser() OR watcher=currentUser()) ORDER BY lastmodified DESC";

export function mapConfluence(json: ConfluenceSearch, site: string): LiveItem[] {
  const base = json._links?.base ?? `${site.replace(/\/$/, "")}/wiki`;
  return json.results.map((r) => ({
    id: `confluence:${r.id}`,
    source: "confluence" as const,
    url: base + r._links.webui,
    title: r.title || "Untitled",
    subtitle: r.space?.name ?? "Confluence",
    icon: null,
    updatedAt: Date.parse(r.history?.lastUpdated?.when ?? "") || 0,
    doc: { kind: "Page", editedBy: r.history?.lastUpdated?.by?.displayName ?? null, place: r.space?.name ?? null },
  }));
}

// MARK: Google Drive (GET /drive/v3/files)

export type DriveFiles = {
  files: {
    id: string;
    name: string;
    mimeType: string;
    webViewLink: string;
    iconLink?: string;
    modifiedTime: string;
    lastModifyingUser?: { displayName: string };
  }[];
};

export const DRIVE_QUERY = {
  q: "trashed = false and mimeType != 'application/vnd.google-apps.folder' and (viewedByMeTime > '1970-01-01T00:00:00Z' or 'me' in owners)",
  orderBy: "modifiedTime desc",
  pageSize: "30",
  fields: "files(id,name,mimeType,webViewLink,iconLink,modifiedTime,lastModifyingUser(displayName))",
};

const DRIVE_KINDS: Record<string, string> = {
  "application/vnd.google-apps.document": "Document",
  "application/vnd.google-apps.spreadsheet": "Spreadsheet",
  "application/vnd.google-apps.presentation": "Presentation",
  "application/vnd.google-apps.form": "Form",
  "application/vnd.google-apps.drawing": "Drawing",
  "application/pdf": "PDF",
};

export function mapDrive(json: DriveFiles): LiveItem[] {
  return json.files.map((f) => ({
    id: `gdrive:${f.id}`,
    source: "gdrive" as const,
    url: f.webViewLink,
    title: f.name || "Untitled",
    subtitle: DRIVE_KINDS[f.mimeType] ?? "Google Drive",
    icon: null,
    updatedAt: Date.parse(f.modifiedTime) || 0,
    doc: { kind: DRIVE_KINDS[f.mimeType] ?? "File", editedBy: f.lastModifyingUser?.displayName ?? null, place: null },
  }));
}

// MARK: Bitbucket Cloud (GET /2.0/pullrequests/{user}, …/statuses)

export type BitbucketPR = {
  id: number;
  title: string;
  draft?: boolean;
  updated_on: string;
  comment_count: number;
  author: { display_name: string; links?: { avatar?: { href: string } } };
  source: { branch: { name: string } };
  destination: { branch: { name: string }; repository: { full_name: string } };
  links: { html: { href: string } };
  participants?: { role: string; state: "approved" | "changes_requested" | null }[];
};

export type BitbucketStatuses = { values: { state: "SUCCESSFUL" | "FAILED" | "INPROGRESS" | "STOPPED"; name: string; url: string }[] };

export function mapBitbucket(pr: BitbucketPR, statuses: BitbucketStatuses | null): LiveItem {
  const reviewers = (pr.participants ?? []).filter((p) => p.role === "REVIEWER");
  const repo = pr.destination.repository.full_name;
  return {
    id: `bitbucket:${repo}#${pr.id}`,
    source: "bitbucket",
    url: pr.links.html.href,
    title: pr.title,
    subtitle: `${repo} #${pr.id}`,
    icon: null,
    updatedAt: Date.parse(pr.updated_on) || 0,
    section: "authored",
    pr: {
      number: pr.id,
      repo,
      author: pr.author.display_name,
      authorAvatar: pr.author.links?.avatar?.href ?? null,
      draft: !!pr.draft,
      headRef: pr.source.branch.name,
      baseRef: pr.destination.branch.name,
      review: reviewers.some((p) => p.state === "changes_requested") ? "changesRequested" : reviewers.some((p) => p.state === "approved") ? "approved" : reviewers.length ? "required" : null,
      // Bitbucket's API doesn't report conflicts without fetching the diff.
      mergeable: "unknown",
      checks: (statuses?.values ?? []).map((s) => ({
        name: s.name,
        state: s.state === "SUCCESSFUL" ? "success" : s.state === "FAILED" ? "failure" : s.state === "STOPPED" ? "neutral" : "pending",
        url: s.url,
      })),
      comments: pr.comment_count,
      unresolvedThreads: 0,
      additions: 0,
      deletions: 0,
      changedFiles: 0,
    },
  };
}
