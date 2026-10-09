import { keychainDelete, keychainGet, keychainSet, launchEnvironment } from "@arcadia/shell";
import { LiveError, type LiveSourceId } from "./types";

const mock = (() => {
  try {
    return (typeof __DEV__ !== "undefined" && __DEV__ && launchEnvironment("ARCADIA_LIVE_MOCK")) || null;
  } catch {
    return null;
  }
})();

export const isMocked = !!mock;

export const endpoints = {
  githubGraphql: mock ? `${mock}/github/graphql` : "https://api.github.com/graphql",
  githubWeb: mock ? `${mock}/github` : "https://github.com",
  bitbucket: mock ? `${mock}/bitbucket/2.0` : "https://api.bitbucket.org/2.0",
  notion: mock ? `${mock}/notion/v1` : "https://api.notion.com/v1",
  confluence: (site: string) => (mock ? `${mock}/confluence` : site.replace(/\/$/, "")),
  googleAuth: mock ? `${mock}/google/auth` : "https://accounts.google.com/o/oauth2/v2/auth",
  googleToken: mock ? `${mock}/google/token` : "https://oauth2.googleapis.com/token",
  drive: mock ? `${mock}/google/drive/v3` : "https://www.googleapis.com/drive/v3",
};

export async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { Accept: "application/json", ...init.headers } });
  } catch {
    throw new LiveError("network", "Couldn't connect");
  }
  if (res.status === 401) throw new LiveError("signedOut", "Signed out");
  if (res.status === 403 && res.headers.get("x-github-sso")) throw new LiveError("sso", "Needs Single Sign-On");
  if (res.status === 429 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")) throw new LiveError("rateLimited", "Rate Limit Exceeded");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new LiveError(res.status === 403 ? "signedOut" : "other", `${res.status} ${text.slice(0, 200)}`.trim());
  }
  return (await res.json()) as T;
}

export const form = (fields: Record<string, string>) =>
  Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64(text: string): string {
  const bytes = [...new TextEncoder().encode(text)];
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b = 0, c = 0] = [bytes[i]!, bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (i + 1 < bytes.length ? B64[(n >> 6) & 63]! : "=") + (i + 2 < bytes.length ? B64[n & 63]! : "=");
  }
  return out;
}

export const basic = (user: string, secret: string) => `Basic ${base64(`${user}:${secret}`)}`;

const account = (source: LiveSourceId) => (mock ? `mock:${source}` : source);
export const getSecret = (source: LiveSourceId) => keychainGet(account(source));
export const setSecret = (source: LiveSourceId, secret: string) => keychainSet(account(source), secret);
export const deleteSecret = (source: LiveSourceId) => keychainDelete(account(source));
