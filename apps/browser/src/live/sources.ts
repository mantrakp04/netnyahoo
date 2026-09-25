import { CONFLUENCE_CQL, DRIVE_QUERY, mapBitbucket, mapConfluence, mapDrive, mapNotion, NOTION_SEARCH_BODY, type BitbucketPR, type BitbucketStatuses, type ConfluenceSearch, type DriveFiles, type NotionSearch, type NotionUsers } from "./documents";
import { GITHUB_QUERY, GITHUB_STATE_QUERY, GITHUB_VARIABLES, mapGithub, VIEWER_QUERY, type GithubResponse } from "./github";
import { basic, deleteSecret, endpoints, form, getSecret, request, setSecret } from "./net";
import { live, setAccount, updateConfig } from "./store";
import { LiveError, type CompletionState, type LiveAccount, type LiveFolder, type LiveItem, type LiveSourceId } from "./types";

/**
 * Where live items come from. Each source signs in with credentials the user
 * supplies (Netnyahoo has no OAuth apps of its own): a GitHub token or the
 * device flow with the user's OAuth app, a Bitbucket API token, a Notion
 * internal integration token, a Confluence API token, or a Google OAuth client.
 */
export type LiveSource = {
  id: LiveSourceId;
  name: string;
  kind: LiveFolder["kind"];
  /** The site whose favicon stands for the source. */
  site: string;
  fetch(folder: LiveFolder): Promise<LiveItem[]>;
  /** For items that left the results: merged / closed / reviewed (missing = just gone). */
  resolveGone?(items: LiveItem[]): Promise<Record<string, CompletionState>>;
};

async function secret(source: LiveSourceId): Promise<string> {
  const value = await getSecret(source);
  if (!value) throw new LiveError(live().accounts[source] ? "signedOut" : "notConfigured", "Not signed in");
  return value;
}

// MARK: GitHub

async function githubGraphql<T>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const json = await request<T & { errors?: { type?: string; message: string }[] }>(endpoints.githubGraphql, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const error = json.errors?.[0];
  if (error && !(json as { data?: unknown }).data) throw new LiveError(error.type === "RATE_LIMITED" ? "rateLimited" : "other", error.message);
  return json;
}

const github: LiveSource = {
  id: "github",
  name: "GitHub",
  kind: "pullRequests",
  site: "https://github.com",
  async fetch(folder) {
    const json = await githubGraphql<GithubResponse>(await secret("github"), GITHUB_QUERY, GITHUB_VARIABLES);
    return mapGithub(json, folder.filters);
  },
  async resolveGone(items) {
    const prs = items.filter((it) => it.source === "github");
    if (!prs.length) return {};
    const token = await secret("github");
    const ids = prs.map((it) => it.id.slice("github:".length));
    const json = await githubGraphql<{ data?: { nodes: ({ id: string; state: string } | null)[] } }>(token, GITHUB_STATE_QUERY, { ids });
    const out: Record<string, CompletionState> = {};
    for (const n of json.data?.nodes ?? []) {
      if (!n) continue;
      const item = prs.find((it) => it.id === `github:${n.id}`);
      if (!item) continue;
      if (n.state === "MERGED") out[item.id] = "merged";
      else if (n.state === "CLOSED") out[item.id] = "closed";
      // Still open but no longer awaiting you: you finished your review.
      else if (item.section === "review" || item.section === "team") out[item.id] = "reviewed";
    }
    return out;
  },
};

// MARK: Bitbucket Cloud

const bitbucketAuth = async () => basic(live().config.bitbucketUser, await secret("bitbucket"));

const bitbucket: LiveSource = {
  id: "bitbucket",
  name: "Bitbucket",
  kind: "pullRequests",
  site: "https://bitbucket.org",
  async fetch(folder) {
    // Bitbucket has no "review requested from me" search across repositories, so only your PRs are listed.
    if (!folder.filters.authored) return [];
    const auth = await bitbucketAuth();
    const me = live().accounts.bitbucket;
    if (!me) throw new LiveError("signedOut", "Not signed in");
    const page = await request<{ values: BitbucketPR[] }>(`${endpoints.bitbucket}/pullrequests/${encodeURIComponent(me.login)}?state=OPEN&pagelen=50`, {
      headers: { Authorization: auth },
    });
    return Promise.all(
      page.values.map(async (pr) => {
        const repo = pr.destination.repository.full_name;
        const statuses = await request<BitbucketStatuses>(`${endpoints.bitbucket}/repositories/${repo}/pullrequests/${pr.id}/statuses?pagelen=50`, {
          headers: { Authorization: auth },
        }).catch(() => null);
        return mapBitbucket(pr, statuses);
      }),
    );
  },
};

// MARK: Notion

const notionHeaders = (token: string) => ({ Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" });

const notion: LiveSource = {
  id: "notion",
  name: "Notion",
  kind: "documents",
  site: "https://www.notion.so",
  async fetch() {
    const token = await secret("notion");
    const [pages, users] = await Promise.all([
      request<NotionSearch>(`${endpoints.notion}/search`, { method: "POST", headers: notionHeaders(token), body: JSON.stringify(NOTION_SEARCH_BODY) }),
      // Needs the integration's "Read user information" capability; names are optional.
      request<NotionUsers>(`${endpoints.notion}/users?page_size=100`, { headers: notionHeaders(token) }).catch(() => null),
    ]);
    return mapNotion(pages, users, live().accounts.notion?.name ?? null);
  },
};

// MARK: Confluence

const confluence: LiveSource = {
  id: "confluence",
  name: "Confluence",
  kind: "documents",
  site: "https://www.atlassian.com",
  async fetch() {
    const { confluenceSite, confluenceEmail } = live().config;
    if (!confluenceSite) throw new LiveError("notConfigured", "No Confluence site");
    const auth = basic(confluenceEmail, await secret("confluence"));
    const url = `${endpoints.confluence(confluenceSite)}/wiki/rest/api/content/search?limit=30&expand=space,history.lastUpdated&cql=${encodeURIComponent(CONFLUENCE_CQL)}`;
    return mapConfluence(await request<ConfluenceSearch>(url, { headers: { Authorization: auth } }), confluenceSite);
  },
};

// MARK: Google Drive

type GoogleTokens = { access_token: string; refresh_token: string; expires_at: number; client_secret: string };

async function googleAccessToken(): Promise<string> {
  const stored = JSON.parse(await secret("gdrive")) as GoogleTokens;
  if (stored.expires_at > Date.now() + 60_000) return stored.access_token;
  const json = await request<{ access_token: string; expires_in: number }>(endpoints.googleToken, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ client_id: live().config.googleClientId, client_secret: stored.client_secret, refresh_token: stored.refresh_token, grant_type: "refresh_token" }),
  });
  await setSecret("gdrive", JSON.stringify({ ...stored, access_token: json.access_token, expires_at: Date.now() + json.expires_in * 1000 }));
  return json.access_token;
}

const gdrive: LiveSource = {
  id: "gdrive",
  name: "Google Drive",
  kind: "documents",
  site: "https://drive.google.com",
  async fetch() {
    const token = await googleAccessToken();
    const query = Object.entries(DRIVE_QUERY)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
    return mapDrive(await request<DriveFiles>(`${endpoints.drive}/files?${query}`, { headers: { Authorization: `Bearer ${token}` } }));
  },
};

export const SOURCES: Record<LiveSourceId, LiveSource> = { github, bitbucket, notion, confluence, gdrive };

// MARK: Connecting accounts

const account = (login: string, name: string | null, avatar: string | null): LiveAccount => ({ login, name, avatar, connectedAt: Date.now() });

/** Checks a GitHub token (personal access token or one from the device flow) and saves it. */
export async function connectGithub(token: string) {
  const json = await githubGraphql<{ data?: { viewer: { login: string; name: string | null; avatarUrl: string } } }>(token.trim(), VIEWER_QUERY);
  const viewer = json.data?.viewer;
  if (!viewer) throw new LiveError("signedOut", "GitHub didn't accept the token");
  await setSecret("github", token.trim());
  setAccount("github", account(viewer.login, viewer.name, viewer.avatarUrl));
}

export type DeviceFlow = { userCode: string; verificationUri: string; expiresAt: number; done: Promise<void>; cancel(): void };

/**
 * GitHub's OAuth device flow with the user's own OAuth app (Device Flow
 * enabled): show `userCode`, open `verificationUri`, and `done` resolves once
 * they approve it.
 */
export async function startGithubDeviceFlow(clientId: string): Promise<DeviceFlow> {
  const code = await request<{ device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number }>(
    `${endpoints.githubWeb}/login/device/code`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ client_id: clientId, scope: "repo read:org" }) },
  );
  let cancelled = false;
  let interval = Math.max(code.interval, 1) * 1000;
  const expiresAt = Date.now() + code.expires_in * 1000;
  const done = (async () => {
    while (!cancelled && Date.now() < expiresAt) {
      await new Promise((r) => setTimeout(r, interval));
      if (cancelled) break;
      const json = await request<{ access_token?: string; error?: string; interval?: number }>(`${endpoints.githubWeb}/login/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form({ client_id: clientId, device_code: code.device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }),
      });
      if (json.access_token) return connectGithub(json.access_token);
      if (json.error === "slow_down") interval = (json.interval ?? interval / 1000 + 5) * 1000;
      else if (json.error && json.error !== "authorization_pending") throw new LiveError("signedOut", json.error === "access_denied" ? "Access was denied" : json.error);
    }
    throw new LiveError("signedOut", cancelled ? "Cancelled" : "The code expired");
  })();
  return { userCode: code.user_code, verificationUri: code.verification_uri, expiresAt, done, cancel: () => (cancelled = true) };
}

/** Bitbucket Cloud: account email (or username) + API token / app password. */
export async function connectBitbucket(user: string, token: string) {
  const me = await request<{ account_id: string; display_name: string; links?: { avatar?: { href: string } } }>(`${endpoints.bitbucket}/user`, {
    headers: { Authorization: basic(user.trim(), token.trim()) },
  });
  await setSecret("bitbucket", token.trim());
  updateConfig({ bitbucketUser: user.trim() });
  setAccount("bitbucket", account(me.account_id, me.display_name, me.links?.avatar?.href ?? null));
}

/** A Notion internal integration token ("secret_…" / "ntn_…"); pages must be shared with the integration. */
export async function connectNotion(token: string) {
  const me = await request<{ name?: string; bot?: { workspace_name?: string } }>(`${endpoints.notion}/users/me`, { headers: notionHeaders(token.trim()) });
  await setSecret("notion", token.trim());
  setAccount("notion", account(me.bot?.workspace_name ?? me.name ?? "Notion", me.bot?.workspace_name ?? null, null));
}

/** Confluence Cloud: site URL + account email + API token. */
export async function connectConfluence(site: string, email: string, token: string) {
  const base = site.trim().replace(/\/+$/, "").replace(/^(?!https?:\/\/)/, "https://");
  const me = await request<{ accountId: string; displayName: string }>(`${endpoints.confluence(base)}/wiki/rest/api/user/current`, {
    headers: { Authorization: basic(email.trim(), token.trim()) },
  });
  await setSecret("confluence", token.trim());
  updateConfig({ confluenceSite: base, confluenceEmail: email.trim() });
  setAccount("confluence", account(me.accountId, me.displayName, null));
}

/** Google: exchanges the code from the consent page's loopback redirect (see ./googleAuth). */
export async function connectGoogle(clientId: string, clientSecret: string, code: string, verifier: string, redirectUri: string) {
  const json = await request<{ access_token: string; refresh_token?: string; expires_in: number }>(endpoints.googleToken, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirectUri }),
  });
  if (!json.refresh_token) throw new LiveError("signedOut", "Google didn't return a refresh token");
  const tokens: GoogleTokens = { access_token: json.access_token, refresh_token: json.refresh_token, expires_at: Date.now() + json.expires_in * 1000, client_secret: clientSecret };
  await setSecret("gdrive", JSON.stringify(tokens));
  const about = await request<{ user?: { displayName: string; emailAddress: string; photoLink?: string } }>(`${endpoints.drive}/about?fields=user`, {
    headers: { Authorization: `Bearer ${json.access_token}` },
  }).catch(() => null);
  updateConfig({ googleClientId: clientId });
  setAccount("gdrive", account(about?.user?.emailAddress ?? "Google Drive", about?.user?.displayName ?? null, about?.user?.photoLink ?? null));
}

export async function disconnect(source: LiveSourceId) {
  await deleteSecret(source);
  setAccount(source, null);
}
