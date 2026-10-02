import type { CheckState, LiveItem, PullRequestCheck, PullRequestInfo, PullRequestSection } from "./types";

const PR_FIELDS = `
  ... on PullRequest {
    id number title url isDraft updatedAt createdAt
    headRefName baseRefName mergeable reviewDecision
    additions deletions changedFiles
    repository { nameWithOwner }
    author { login avatarUrl(size: 64) }
    comments { totalCount }
    reviewThreads(first: 50) { nodes { isResolved } }
    commits(last: 1) {
      nodes { commit { statusCheckRollup { state contexts(first: 60) { nodes {
        __typename
        ... on CheckRun { name status conclusion detailsUrl }
        ... on StatusContext { context state targetUrl }
      } } } } }
    }
  }`;

// One query for every PR's details timed out on GitHub's side (a 502 after ~10 s) for an account with ~60 authored PRs
// and ~130 review requests: one 50-PR search with these fields took 7-10 s alone. The searches ask only for ids, and
// the details come in pages of DETAILS_PAGE (~2.5 s each), fetched in parallel (sources.ts).
export const GITHUB_QUERY = `query LiveFolder($authored: String!, $review: String!, $direct: String!) {
  viewer { login name avatarUrl(size: 64) }
  authored: search(query: $authored, type: ISSUE, first: 50) { nodes { ... on PullRequest { id } } }
  review: search(query: $review, type: ISSUE, first: 50) { nodes { ... on PullRequest { id } } }
  direct: search(query: $direct, type: ISSUE, first: 50) { nodes { ... on PullRequest { id } } }
}`;

// `state`: a PR can close or merge between the searches (is:open) and this query; withDetails drops it.
export const GITHUB_DETAILS_QUERY = `query LiveFolderDetails($ids: [ID!]!) { nodes(ids: $ids) { ${PR_FIELDS} ... on PullRequest { state } } }`;

export const DETAILS_PAGE = 10;

export const GITHUB_VARIABLES = {
  authored: "is:pr is:open author:@me archived:false sort:updated-desc",
  review: "is:pr is:open review-requested:@me archived:false sort:updated-desc",
  direct: "is:pr is:open user-review-requested:@me archived:false",
};

export const GITHUB_STATE_QUERY = `query LiveFolderGone($ids: [ID!]!) {
  nodes(ids: $ids) { ... on PullRequest { id state } }
}`;

export const VIEWER_QUERY = `query { viewer { login name avatarUrl(size: 64) } }`;

type RawCheck =
  | { __typename: "CheckRun"; name: string; status: string; conclusion: string | null; detailsUrl: string | null }
  | { __typename: "StatusContext"; context: string; state: string; targetUrl: string | null };

export type RawPR = {
  id: string;
  state?: "OPEN" | "CLOSED" | "MERGED";
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  updatedAt: string;
  headRefName: string;
  baseRefName: string;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  repository: { nameWithOwner: string };
  author: { login: string; avatarUrl: string } | null;
  comments: { totalCount: number };
  reviewThreads?: { nodes: { isResolved: boolean }[] };
  commits: { nodes: { commit: { statusCheckRollup: { state: string; contexts: { nodes: RawCheck[] } } | null } }[] };
};

export type GithubResponse = {
  data?: {
    viewer: { login: string; name: string | null; avatarUrl: string };
    authored: { nodes: (RawPR | { id: string } | Record<string, never>)[] };
    review: { nodes: (RawPR | { id: string } | Record<string, never>)[] };
    direct: { nodes: ({ id: string } | Record<string, never>)[] };
  };
  errors?: { type?: string; message: string }[];
};

export function checkState(c: RawCheck): CheckState {
  if (c.__typename === "StatusContext") {
    if (c.state === "SUCCESS") return "success";
    if (c.state === "FAILURE" || c.state === "ERROR") return "failure";
    return "pending";
  }
  if (c.status !== "COMPLETED") return c.status === "IN_PROGRESS" ? "pending" : "queued";
  switch (c.conclusion) {
    case "SUCCESS":
      return "success";
    case "NEUTRAL":
    case "SKIPPED":
    case "STALE":
      return "neutral";
    default:
      return "failure";
  }
}

function mapPR(raw: RawPR, section: PullRequestSection): LiveItem {
  const rollup = raw.commits.nodes[0]?.commit.statusCheckRollup;
  const checks: PullRequestCheck[] = (rollup?.contexts.nodes ?? []).map((c) => ({
    name: c.__typename === "CheckRun" ? c.name : c.context,
    state: checkState(c),
    url: c.__typename === "CheckRun" ? c.detailsUrl : c.targetUrl,
  }));
  const pr: PullRequestInfo = {
    number: raw.number,
    repo: raw.repository.nameWithOwner,
    author: raw.author?.login ?? "ghost",
    authorAvatar: raw.author?.avatarUrl ?? null,
    draft: raw.isDraft,
    headRef: raw.headRefName,
    baseRef: raw.baseRefName,
    review: raw.reviewDecision === "APPROVED" ? "approved" : raw.reviewDecision === "CHANGES_REQUESTED" ? "changesRequested" : raw.reviewDecision === "REVIEW_REQUIRED" ? "required" : null,
    mergeable: raw.mergeable === "CONFLICTING" ? "conflicting" : raw.mergeable === "MERGEABLE" ? "mergeable" : "unknown",
    checks,
    comments: raw.comments.totalCount,
    unresolvedThreads: (raw.reviewThreads?.nodes ?? []).filter((t) => !t.isResolved).length,
    additions: raw.additions,
    deletions: raw.deletions,
    changedFiles: raw.changedFiles,
  };
  return {
    id: `github:${raw.id}`,
    source: "github",
    url: raw.url,
    title: raw.title,
    subtitle: `${raw.repository.nameWithOwner} #${raw.number}`,
    icon: null,
    updatedAt: Date.parse(raw.updatedAt) || 0,
    section,
    pr,
  };
}

const isPR = (n: object): n is RawPR => "number" in n;

// The ids whose details the folder shows (GITHUB_DETAILS_QUERY), each once.
export function detailIds(json: GithubResponse, filters: { authored: boolean; reviewRequests: boolean }): string[] {
  const data = json.data;
  if (!data) return [];
  const sections = [filters.authored && data.authored, filters.reviewRequests && data.review].filter((x) => !!x);
  return [...new Set(sections.flatMap((section) => section.nodes.map((n) => ("id" in n ? n.id : "")).filter(Boolean)))];
}

// The search response with each id replaced by its details; an id without open details (closed, merged or deleted
// between the two queries) drops out.
export function withDetails(json: GithubResponse, details: (RawPR | null)[]): GithubResponse {
  const data = json.data;
  if (!data) return json;
  const byId = new Map(details.filter((d): d is RawPR => !!d && isPR(d) && d.state === "OPEN").map((d) => [d.id, d]));
  const fill = (nodes: (RawPR | { id: string } | Record<string, never>)[]) =>
    nodes.flatMap((n) => ("id" in n && byId.has(n.id) ? [byId.get(n.id)!] : []));
  return { ...json, data: { ...data, authored: { nodes: fill(data.authored.nodes) }, review: { nodes: fill(data.review.nodes) } } };
}

export function mapGithub(json: GithubResponse, filters: { authored: boolean; reviewRequests: boolean }): LiveItem[] {
  const data = json.data;
  if (!data) return [];
  const direct = new Set(data.direct.nodes.map((n) => ("id" in n ? n.id : "")));
  const out: LiveItem[] = [];
  const seen = new Set<string>();
  if (filters.authored) {
    for (const n of data.authored.nodes) if (isPR(n) && !seen.has(n.id)) (seen.add(n.id), out.push(mapPR(n, "authored")));
  }
  if (filters.reviewRequests) {
    for (const n of data.review.nodes) if (isPR(n) && !seen.has(n.id)) (seen.add(n.id), out.push(mapPR(n, direct.has(n.id) ? "review" : "team")));
  }
  return withStacks(out);
}

export function withStacks(items: LiveItem[]): LiveItem[] {
  const byHead = new Map<string, LiveItem>();
  for (const it of items) if (it.pr) byHead.set(`${it.pr.repo}:${it.pr.headRef}`, it);
  const parent = (it: LiveItem) => (it.pr ? byHead.get(`${it.pr.repo}:${it.pr.baseRef}`) : undefined);
  const bottomOf = (it: LiveItem) => {
    let cur = it;
    const visited = new Set<string>();
    for (let p = parent(cur); p && !visited.has(p.id); p = parent(cur)) {
      visited.add(cur.id);
      cur = p;
    }
    return cur;
  };
  const stacks = new Map<string, LiveItem[]>();
  for (const it of items) {
    if (!it.pr) continue;
    const bottom = bottomOf(it);
    stacks.set(bottom.id, [...(stacks.get(bottom.id) ?? []), it]);
  }
  const info = new Map<string, PullRequestInfo["stack"]>();
  for (const [bottomId, members] of stacks) {
    if (members.length < 2) continue;
    const depth = (it: LiveItem) => {
      let d = 1;
      for (let p = parent(it); p && d <= members.length; p = parent(p)) d++;
      return d;
    };
    const ordered = [...members].sort((a, b) => depth(a) - depth(b) || a.pr!.number - b.pr!.number);
    ordered.forEach((it, i) => info.set(it.id, { id: `stack:${bottomId}`, position: i + 1, size: ordered.length }));
  }
  return items.map((it) => (info.has(it.id) && it.pr ? { ...it, pr: { ...it.pr, stack: info.get(it.id) } } : it));
}

export type CheckSummary = {
  text: string;
  tone: "success" | "failure" | "pending" | "neutral";
  counts: { success: number; failure: number; pending: number };
};

export function summarizeChecks(checks: PullRequestCheck[]): CheckSummary | null {
  if (!checks.length) return null;
  const failure = checks.filter((c) => c.state === "failure").length;
  const pending = checks.filter((c) => c.state === "pending" || c.state === "queued").length;
  const queued = checks.filter((c) => c.state === "queued").length;
  const success = checks.length - failure - pending;
  const counts = { success, failure, pending };
  if (failure) return { text: failure === 1 ? "1 check is failing" : `${failure} checks are failing`, tone: "failure", counts };
  if (queued && queued === pending && !checks.some((c) => c.state === "success")) return { text: "Checks are queued", tone: "pending", counts };
  if (pending) return { text: "Some checks haven't completed yet", tone: "pending", counts };
  return { text: "All checks have passed", tone: "success", counts };
}

export function prBadge(pr: PullRequestInfo): "conflict" | "failing" | "changesRequested" | "pending" | "approved" | "passed" | null {
  if (pr.mergeable === "conflicting") return "conflict";
  const summary = summarizeChecks(pr.checks);
  if (summary?.tone === "failure") return "failing";
  if (pr.review === "changesRequested") return "changesRequested";
  if (summary?.tone === "pending") return "pending";
  if (pr.review === "approved") return "approved";
  if (summary?.tone === "success") return "passed";
  return null;
}
