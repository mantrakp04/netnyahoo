// The spec for fuzzy.ts: matchActions as it was before the keystroke hill-climb (commit 8def9b0). fuzzy.property.test.ts runs this and the
// live one side by side. Not imported by the app.
export type ActionCandidate = { id: string; title: string; keywords?: readonly string[] };

export type ActionMatch<T extends ActionCandidate> = {
  action: T;
  score: number;
  exact: boolean;
};

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const ch of haystack) if (ch === needle[i]) i++;
  return i === needle.length;
}

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
  return score - tw.length;
}

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
