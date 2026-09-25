import { parseSuggestions, suggestRequestUrl, type SearchEngine } from "./engines.ts";

type FetchResponse = { ok: boolean; text(): Promise<string> };
export type FetchLike = (url: string, init: { signal: AbortSignal }) => Promise<FetchResponse>;

export type SuggestFetcher = {
  /**
   * Asks for `engine`'s suggestions for `query`. Only the latest request answers: each call
   * cancels the previous one (its timer, or its in-flight fetch). Cached answers come back on
   * the next microtask, without waiting for the debounce.
   */
  request(engine: SearchEngine, query: string, onResult: (suggestions: string[]) => void): void;
  cancel(): void;
};

/**
 * Debounced, cancellable fetching of search suggestions, with a small LRU cache so typing
 * back over the same prefix doesn't refetch. Failures (offline, bad JSON) answer nothing.
 */
export function createSuggestFetcher({
  fetch,
  delay = 120,
  cacheSize = 64,
}: {
  fetch: FetchLike;
  delay?: number;
  cacheSize?: number;
}): SuggestFetcher {
  const cache = new Map<string, string[]>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: AbortController | undefined;
  let generation = 0;

  const cancel = () => {
    generation++;
    clearTimeout(timer);
    timer = undefined;
    inFlight?.abort();
    inFlight = undefined;
  };

  const remember = (url: string, suggestions: string[]) => {
    cache.delete(url);
    cache.set(url, suggestions);
    if (cache.size > cacheSize) cache.delete(cache.keys().next().value!);
  };

  return {
    cancel,
    request(engine, query, onResult) {
      cancel();
      const url = suggestRequestUrl(engine, query);
      if (!url) return;
      const current = generation;
      const cached = cache.get(url);
      if (cached) {
        void Promise.resolve().then(() => current === generation && onResult(cached));
        return;
      }
      timer = setTimeout(() => {
        timer = undefined;
        const controller = new AbortController();
        inFlight = controller;
        fetch(url, { signal: controller.signal })
          .then(async (res) => {
            if (!res.ok) return [];
            try {
              return parseSuggestions(JSON.parse(await res.text()));
            } catch {
              return [];
            }
          })
          .then(
            (suggestions) => {
              if (controller.signal.aborted) return;
              remember(url, suggestions);
              if (current === generation) {
                inFlight = undefined;
                onResult(suggestions);
              }
            },
            () => {},
          );
      }, delay);
    },
  };
}
