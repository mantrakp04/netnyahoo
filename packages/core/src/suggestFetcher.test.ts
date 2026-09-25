import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { BUILT_IN_ENGINES, engineById } from "./engines.ts";
import { createSuggestFetcher, type FetchLike } from "./suggestFetcher.ts";

const google = engineById(BUILT_IN_ENGINES, "google");
const flush = () => new Promise((r) => setImmediate(r));

function fakeFetch(respond: (url: string) => unknown = (url) => [decodeURIComponent(url.split("q=").at(-1)!), ["a", "b"]]) {
  const calls: { url: string; signal: AbortSignal }[] = [];
  const fetch: FetchLike = (url, { signal }) => {
    calls.push({ url, signal });
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")));
      queueMicrotask(() => resolve({ ok: true, text: async () => JSON.stringify(respond(url)) }));
    });
  };
  return { fetch, calls };
}

test("debounces: only the last query within the delay is fetched", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { fetch, calls } = fakeFetch();
    const results: string[][] = [];
    const fetcher = createSuggestFetcher({ fetch, delay: 100 });
    fetcher.request(google, "c", (s) => results.push(s));
    mock.timers.tick(50);
    fetcher.request(google, "ca", (s) => results.push(s));
    mock.timers.tick(50);
    fetcher.request(google, "cat", (s) => results.push(s));
    assert.equal(calls.length, 0);
    mock.timers.tick(100);
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, /q=cat$/);
    await flush();
    assert.deepEqual(results, [["a", "b"]]);
  } finally {
    mock.timers.reset();
  }
});

test("a newer request aborts the one in flight, which never answers", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { fetch, calls } = fakeFetch();
    const results: string[] = [];
    const fetcher = createSuggestFetcher({ fetch, delay: 10 });
    fetcher.request(google, "old", () => results.push("old"));
    mock.timers.tick(10);
    assert.equal(calls.length, 1);
    fetcher.request(google, "new", () => results.push("new"));
    assert.equal(calls[0]!.signal.aborted, true);
    mock.timers.tick(10);
    await flush();
    assert.deepEqual(results, ["new"]);
  } finally {
    mock.timers.reset();
  }
});

test("cached answers skip the network; cancel() silences everything", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { fetch, calls } = fakeFetch();
    const results: string[][] = [];
    const fetcher = createSuggestFetcher({ fetch, delay: 10 });
    fetcher.request(google, "dog", (s) => results.push(s));
    mock.timers.tick(10);
    await flush();
    fetcher.request(google, "dog", (s) => results.push(s));
    await flush();
    assert.equal(calls.length, 1);
    assert.equal(results.length, 2);

    fetcher.request(google, "dogs", (s) => results.push(s));
    fetcher.cancel();
    mock.timers.tick(10);
    await flush();
    assert.equal(calls.length, 1);
    assert.equal(results.length, 2);
  } finally {
    mock.timers.reset();
  }
});

test("engines without suggestions, HTTP errors and bad JSON answer nothing", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const results: string[][] = [];
    const bad = createSuggestFetcher({ fetch: async () => ({ ok: true, text: async () => "<html>" }), delay: 1 });
    bad.request(google, "x", (s) => results.push(s));
    mock.timers.tick(1);
    await flush();
    const failing = createSuggestFetcher({ fetch: async () => ({ ok: false, text: async () => "" }), delay: 1 });
    failing.request(google, "y", (s) => results.push(s));
    mock.timers.tick(1);
    await flush();
    assert.deepEqual([...results], [[], []]);

    const { fetch, calls } = fakeFetch();
    createSuggestFetcher({ fetch, delay: 1 }).request(engineById(BUILT_IN_ENGINES, "perplexity"), "x", (s) => results.push(s));
    mock.timers.tick(1);
    assert.equal(calls.length, 0);
  } finally {
    mock.timers.reset();
  }
});
