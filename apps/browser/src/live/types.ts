export type LiveSourceId = "github" | "bitbucket" | "notion" | "confluence" | "gdrive";
export type LiveFolderKind = "pullRequests" | "documents";

export type LiveFolder = {
  id: string;
  profileId: string;
  kind: LiveFolderKind;
  name: string;
  icon: string | null;
  collapsed: boolean;
  sources: LiveSourceId[];
  filters: { authored: boolean; reviewRequests: boolean };
  createdAt: number;
};

export type PullRequestSection = "authored" | "review" | "team";

export type CheckState = "success" | "failure" | "pending" | "queued" | "neutral";

export type PullRequestCheck = { name: string; state: CheckState; url: string | null };

export type PullRequestInfo = {
  number: number;
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
  stack?: { id: string; position: number; size: number };
};

export type DocumentInfo = {
  kind: string;
  editedBy: string | null;
  place: string | null;
};

export type LiveItem = {
  id: string;
  source: LiveSourceId;
  url: string;
  title: string;
  subtitle: string;
  icon: string | null;
  updatedAt: number;
  section?: PullRequestSection;
  pr?: PullRequestInfo;
  doc?: DocumentInfo;
};

export type CompletedItem = { item: LiveItem; state: CompletionState; at: number };

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

export type LiveAccount = { login: string; name: string | null; avatar: string | null; connectedAt: number };
