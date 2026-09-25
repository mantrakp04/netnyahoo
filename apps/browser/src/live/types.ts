/**
 * Live folders (Dia's "Live Tab Groups"): sidebar folders whose items come from
 * a connected service and refresh by themselves. Items open as tabs that stay
 * inside the folder (a tab's `liveItem` links it back).
 */
export type LiveSourceId = "github" | "bitbucket" | "notion" | "confluence" | "gdrive";
export type LiveFolderKind = "pullRequests" | "documents";

export type LiveFolder = {
  id: string;
  /** Folders belong to a profile and show in each of its windows. */
  profileId: string;
  kind: LiveFolderKind;
  name: string;
  /** An emoji, or null for the source's icon. */
  icon: string | null;
  collapsed: boolean;
  /** Where items come from (Dia's source toggles). */
  sources: LiveSourceId[];
  /** Pull Requests: "created by me" and "awaiting my review" toggles. */
  filters: { authored: boolean; reviewRequests: boolean };
  createdAt: number;
};

/** Where an item sits in a Pull Requests folder. */
export type PullRequestSection = "authored" | "review" | "team";

export type CheckState = "success" | "failure" | "pending" | "queued" | "neutral";

export type PullRequestCheck = { name: string; state: CheckState; url: string | null };

export type PullRequestInfo = {
  number: number;
  /** "owner/name". */
  repo: string;
  author: string;
  authorAvatar: string | null;
  draft: boolean;
  headRef: string;
  baseRef: string;
  review: "approved" | "changesRequested" | "required" | null;
  mergeable: "mergeable" | "conflicting" | "unknown";
  checks: PullRequestCheck[];
  comments: number;
  unresolvedThreads: number;
  additions: number;
  deletions: number;
  changedFiles: number;
  /** Stacked PRs (each based on the previous one's branch). Position is 1-based from the bottom. */
  stack?: { id: string; position: number; size: number };
};

export type DocumentInfo = {
  /** "Page", "Document", "Spreadsheet"… */
  kind: string;
  /** Who edited it last. */
  editedBy: string | null;
  /** Notion workspace, Confluence space, Drive folder. */
  place: string | null;
};

export type LiveItem = {
  /** Stable across fetches: "<source>:<id>". */
  id: string;
  source: LiveSourceId;
  url: string;
  title: string;
  /** "owner/repo #12", a Confluence space… */
  subtitle: string;
  /** An emoji or an image URL; null = the site's favicon. */
  icon: string | null;
  /** ms since the epoch. */
  updatedAt: number;
  section?: PullRequestSection;
  pr?: PullRequestInfo;
  doc?: DocumentInfo;
};

/** A PR that left the folder because it was merged or closed (Dia 1.23's completion moment). */
export type CompletedItem = { item: LiveItem; state: CompletionState; at: number };

/** Why a PR left: merged, closed, or (review requests) you finished your review. */
export type CompletionState = "merged" | "closed" | "reviewed";

export type LiveErrorKind = "signedOut" | "sso" | "rateLimited" | "network" | "notConfigured" | "other";

export type FolderStatus = {
  state: "initializing" | "idle" | "updating" | "error";
  lastFetch: number | null;
  error: { kind: LiveErrorKind; message: string; source: LiveSourceId } | null;
};

export class LiveError extends Error {
  kind: LiveErrorKind;
  constructor(kind: LiveErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

/** A signed-in account (the secret itself lives in the keychain). */
export type LiveAccount = { login: string; name: string | null; avatar: string | null; connectedAt: number };
