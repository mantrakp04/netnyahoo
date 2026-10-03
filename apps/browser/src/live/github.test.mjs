// GitHub live folders' details pages (live/github.ts): which errors beside data fail the refresh, and which only
// drop what they touch. A PR missing from a successful fetch reads as merged or reviewed, so getting this wrong
// either completes PRs that are still open or stops every refresh.
import assert from "node:assert/strict";
import { test } from "node:test";
import { detailIds, detailNodes, mapGithub, withDetails } from "./github.ts";
import { LiveError } from "./types.ts";

const fixture = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(new URL("./fixtures/github.json", import.meta.url), "utf8")));
const all = [...fixture.data.authored.nodes, ...fixture.data.review.nodes];
const pr = (id) => ({ ...all.find((n) => n.id === id), state: "OPEN" });
const filters = { authored: true, reviewRequests: true };
const kind = (fn) => {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof LiveError);
    return error.kind;
  }
  return "ok";
};

test("a page without errors returns every PR", () => {
  const ids = all.slice(0, 3).map((n) => n.id);
  assert.deepEqual(detailNodes(ids, { data: { nodes: ids.map(pr) } }).map((n) => n.id), ids);
});

test("a field error keeps the PR, with that field empty", () => {
  const ids = all.slice(0, 2).map((n) => n.id);
  const nodes = ids.map(pr);
  nodes[1] = { ...nodes[1], commits: { nodes: [{ commit: { statusCheckRollup: null } }] } };
  const errors = [{ type: "FORBIDDEN", message: "no checks", path: ["nodes", 1, "commits", "nodes", 0, "commit", "statusCheckRollup"] }];
  const kept = detailNodes(ids, { data: { nodes }, errors });
  assert.deepEqual(kept.map((n) => n.id), ids);
  const items = mapGithub(withDetails({ data: { ...fixture.data, authored: { nodes: ids.map((id) => ({ id })) }, review: { nodes: [] } } }, kept), filters);
  assert.deepEqual(items.find((it) => it.id === `github:${ids[1]}`).pr.checks, []);
});

test("a PR GitHub can't find or won't show drops out; the rest stay", () => {
  const ids = all.slice(0, 3).map((n) => n.id);
  for (const type of ["NOT_FOUND", "FORBIDDEN"]) {
    const nodes = ids.map(pr);
    nodes[1] = null;
    const kept = detailNodes(ids, { data: { nodes }, errors: [{ type, message: type, path: ["nodes", 1] }] });
    assert.deepEqual(kept.map((n) => n.id), [ids[0], ids[2]]);
  }
});

test("a PR lost to anything else fails the page, and a rate limit says so", () => {
  const ids = all.slice(0, 2).map((n) => n.id);
  const lost = [pr(ids[0]), null];
  assert.equal(kind(() => detailNodes(ids, { data: { nodes: lost }, errors: [{ type: "SERVICE_UNAVAILABLE", message: "timeout", path: ["nodes", 1] }] })), "other");
  assert.equal(kind(() => detailNodes(ids, { data: { nodes: lost }, errors: [{ message: "Something went wrong" }] })), "other");
  assert.equal(kind(() => detailNodes(ids, { data: { nodes: lost } })), "other");
  assert.equal(kind(() => detailNodes(ids, { data: { nodes: [pr(ids[0])] } })), "other");
  assert.equal(kind(() => detailNodes(ids, { data: null })), "other");
  assert.equal(kind(() => detailNodes(ids, { data: { nodes: ids.map(pr) }, errors: [{ type: "RATE_LIMITED", message: "slow down" }] })), "rateLimited");
});

test("details keep the search's order and sections, and drop PRs that closed in between", () => {
  const ids = detailIds(fixture, filters);
  assert.equal(new Set(ids).size, ids.length);
  const details = ids.map(pr).reverse();
  details[0] = { ...details[0], state: "MERGED" };
  const items = mapGithub(withDetails({ data: { ...fixture.data, authored: { nodes: fixture.data.authored.nodes.map(({ id }) => ({ id })) }, review: { nodes: fixture.data.review.nodes.map(({ id }) => ({ id })) } } }, details), filters);
  const before = mapGithub(fixture, filters).filter((it) => it.id !== `github:${details[0].id}`);
  assert.deepEqual(items.map((it) => [it.id, it.section]), before.map((it) => [it.id, it.section]));
});
