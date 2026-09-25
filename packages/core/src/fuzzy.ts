/**
 * Fuzzy matching for the command bar's browser actions ("close tab", "pin", "dl" → Downloads).
 * Every query word has to match a word of the title or a keyword: as a prefix (best), inside
 * a word, or as an in-order subsequence of the whole title ("nwin" → New Window).
 */
export type ActionCandidate = { id: string; title: string; keywords?: readonly string[] };

export type ActionMatch<T extends ActionCandidate> = {
  action: T;
  score: number;
  /** The query is the action's name (or one of its keywords): it can be the top hit. */
  exact: boolean;
};

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const ch of haystack) if (ch === needle[i]) i++;
  return i === needle.length;
}

/** 0 when `query` doesn't match `text`; higher is better. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  if (t === q) return 1000;
  const tw = words(t);
  let score = t.startsWith(q) ? 200 : 0;
  for (const token of words(q)) {
    const i = tw.findIndex((w) => w.startsWith(token));
    if (i >= 0) score += 60 + token.length * 4 - i * 2;
    else if (token.length >= 3 && t.includes(token)) score += 25 + token.length;
    else if (token.length >= 2 && isSubsequence(token, t.replace(/[^a-z0-9]/g, ""))) score += 8;
    else return 0;
  }
  // Shorter titles win ties ("Pin Tab" over "Pin Tab to Group").
  return score - tw.length;
}

/** Actions matching `query`, best first. Queries shorter than two characters match nothing. */
export function matchActions<T extends ActionCandidate>(query: string, actions: readonly T[], limit = 3): ActionMatch<T>[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (q.length < 2) return [];
  return actions
    .map((action) => {
      const names = [action.title, ...(action.keywords ?? [])];
      const exact = names.some((n) => n.toLowerCase() === q);
      const score = Math.max(...names.map((n, i) => fuzzyScore(q, n) - (i > 0 ? 5 : 0)));
      return { action, score, exact };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
