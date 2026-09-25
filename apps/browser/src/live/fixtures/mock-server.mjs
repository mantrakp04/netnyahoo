// Fixture server for live folders (DEV). Run: node src/live/fixtures/mock-server.mjs [port]
// then launch a DEV build with NETNYAHOO_LIVE_MOCK=http://127.0.0.1:<port>.
// Tokens it accepts: GitHub "mock-token", Notion "mock-notion", anything for Basic auth.
// Test hooks: GET /mock/merge?id=PR_101, /mock/close?id=…, /mock/review?id=PR_88 (review done),
// /mock/add (a new review request), /mock/reset, /mock/log (requests seen).
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 9411);
const dir = new URL(".", import.meta.url);
const load = (name) => JSON.parse(readFileSync(new URL(name, dir), "utf8"));

let github;
let state;
let approved;
const log = [];
function reset() {
  github = load("github.json");
  state = {};
  approved = false;
}
reset();

const send = (res, status, body, type = "application/json") => {
  res.writeHead(status, { "Content-Type": type });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};
const bodyOf = (req) => new Promise((resolve) => {
  let data = "";
  req.on("data", (c) => (data += c));
  req.on("end", () => resolve(data));
});
const nodes = (key) => github.data[key].nodes;
const drop = (id) => {
  for (const key of ["authored", "review", "direct"]) github.data[key].nodes = nodes(key).filter((n) => n.id !== id);
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const auth = req.headers.authorization ?? "";
  const body = await bodyOf(req);
  log.push(`${req.method} ${url.pathname}`);
  const p = url.pathname;

  // Test hooks
  if (p === "/mock/reset") return reset(), send(res, 200, { ok: true });
  if (p === "/mock/log") return send(res, 200, log.slice(-100));
  if (p === "/mock/merge" || p === "/mock/close") {
    const id = url.searchParams.get("id");
    drop(id);
    state[id] = p === "/mock/merge" ? "MERGED" : "CLOSED";
    return send(res, 200, { ok: true });
  }
  if (p === "/mock/review") {
    const id = url.searchParams.get("id");
    drop(id);
    state[id] = "OPEN";
    return send(res, 200, { ok: true });
  }
  if (p === "/mock/add") {
    const template = structuredClone(nodes("review")[0] ?? load("github.json").data.review.nodes[0]);
    const n = 500 + nodes("review").length;
    Object.assign(template, { id: `PR_${n}`, number: n, title: `New review request #${n}`, url: `https://github.com/acme/browser/pull/${n}`, updatedAt: new Date().toISOString() });
    github.data.review.nodes.unshift(template);
    github.data.direct.nodes.push({ id: template.id });
    return send(res, 200, { ok: true, id: template.id });
  }

  // GitHub
  if (p === "/github/login/device/code") return send(res, 200, { device_code: "mock-device", user_code: "WDJB-MJHT", verification_uri: `http://127.0.0.1:${port}/github/login/device`, expires_in: 900, interval: 1 });
  if (p === "/github/login/device") {
    if (url.searchParams.get("approve")) approved = true;
    return send(res, 200, `<!doctype html><title>Device Activation</title><body style="font:15px -apple-system;padding:40px"><h2>Mock GitHub device activation</h2><p>Code WDJB-MJHT</p>${approved ? "<p id=done>Authorized. You can close this tab.</p>" : `<a id=approve href="?approve=1">Authorize Netnyahoo</a>`}</body>`, "text/html");
  }
  if (p === "/github/login/oauth/access_token") return send(res, 200, approved ? { access_token: "mock-token", token_type: "bearer" } : { error: "authorization_pending" });
  if (p === "/github/graphql") {
    if (auth !== "Bearer mock-token") return send(res, 401, { message: "Bad credentials" });
    const { query, variables } = JSON.parse(body || "{}");
    if (query.includes("LiveFolderGone")) return send(res, 200, { data: { nodes: variables.ids.map((id) => ({ id, state: state[id] ?? "OPEN" })) } });
    if (!query.includes("search(")) return send(res, 200, { data: { viewer: github.data.viewer } });
    return send(res, 200, github);
  }

  // Notion
  if (p.startsWith("/notion/")) {
    if (auth !== "Bearer mock-notion") return send(res, 401, { object: "error", code: "unauthorized" });
    if (p === "/notion/v1/users/me") return send(res, 200, load("notion-me.json"));
    if (p === "/notion/v1/users") return send(res, 200, load("notion-users.json"));
    if (p === "/notion/v1/search") return send(res, 200, load("notion-search.json"));
  }

  // Confluence
  if (p.startsWith("/confluence/")) {
    if (!auth.startsWith("Basic ")) return send(res, 401, {});
    if (p === "/confluence/wiki/rest/api/user/current") return send(res, 200, { accountId: "acc-1", displayName: "Octo Dev" });
    if (p === "/confluence/wiki/rest/api/content/search") return send(res, 200, load("confluence-search.json"));
  }

  // Bitbucket
  if (p.startsWith("/bitbucket/")) {
    if (!auth.startsWith("Basic ")) return send(res, 401, {});
    if (p === "/bitbucket/2.0/user") return send(res, 200, { account_id: "bb-1", display_name: "Octo Dev" });
    if (p.startsWith("/bitbucket/2.0/pullrequests/")) {
      return send(res, 200, { values: [{ id: 7, title: "Bitbucket: tidy pipelines", updated_on: "2026-09-25T06:00:00Z", comment_count: 2, author: { display_name: "Octo Dev" }, source: { branch: { name: "tidy" } }, destination: { branch: { name: "main" }, repository: { full_name: "acme/pipelines" } }, links: { html: { href: "https://bitbucket.org/acme/pipelines/pull-requests/7" } }, participants: [{ role: "REVIEWER", state: "approved" }] }] });
    }
    if (p.endsWith("/statuses")) return send(res, 200, { values: [{ state: "SUCCESSFUL", name: "Pipeline #12", url: "https://bitbucket.org/acme/pipelines/pipelines/12" }] });
  }

  // Google
  if (p === "/google/auth") {
    const redirect = `${url.searchParams.get("redirect_uri")}?code=mock-google-code&state=${encodeURIComponent(url.searchParams.get("state"))}`;
    return send(res, 200, `<!doctype html><title>Sign in - Google Accounts</title><body style="font:15px -apple-system;padding:40px"><h2>Mock Google consent</h2><a id=allow href="${redirect}">Allow</a></body>`, "text/html");
  }
  if (p === "/google/token") return send(res, 200, { access_token: "mock-google-access", refresh_token: "mock-google-refresh", expires_in: 3600 });
  if (p === "/google/drive/v3/about") return send(res, 200, { user: { displayName: "Octo Dev", emailAddress: "octo@acme.com" } });
  if (p === "/google/drive/v3/files") return auth === "Bearer mock-google-access" ? send(res, 200, load("drive-files.json")) : send(res, 401, {});

  send(res, 404, { message: `No fixture for ${req.method} ${p}` });
}).listen(port, "127.0.0.1", () => console.log(`live mock on http://127.0.0.1:${port}`));
