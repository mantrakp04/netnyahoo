export type ActionCandidate = { id: string; title: string; keywords?: readonly string[] };

export type ActionMatch<T extends ActionCandidate> = {
  action: T;
  score: number;
  exact: boolean;
};

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function isSubsequence(needle: string, haystack: string): boolean {
  let from = 0;
  for (let i = 0; i < needle.length; i++) {
    const at = haystack.indexOf(needle[i]!, from);
    if (at < 0) return false;
    from = at + 1;
  }
  return true;
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

// What a name needs for scoring that doesn't depend on the query: lowercased, its words, which letters (a-z) and digits it has
// (a name that lacks one the query uses can't match by prefix, inclusion or subsequence), and, when asked for, its letters and
// digits in a row.
type Name = { lower: string; words: string[]; letters: number; digits: number; plain?: string };

function nameOf(text: string): Name {
  const lower = text.toLowerCase();
  let letters = 0;
  let digits = 0;
  for (let i = 0; i < lower.length; i++) {
    const c = lower.charCodeAt(i);
    if (c >= 97 && c <= 122) letters |= 1 << (c - 97);
    else if (c >= 48 && c <= 57) digits |= 1 << (c - 48);
  }
  return { lower, words: words(lower), letters, digits };
}

// Kept for one array of actions while its rows, titles and keyword lists are the same (the bar's list is made again when its
// inputs change; the names of an action edited in place are made again).
type Prepared = { action: ActionCandidate; title: string; keywords: readonly string[] | undefined; names: Name[] };
const prepared = new WeakMap<readonly ActionCandidate[], Prepared[]>();

function preparedNames(actions: readonly ActionCandidate[]): Prepared[] {
  let list = prepared.get(actions);
  if (!list) prepared.set(actions, (list = []));
  for (let a = 0; a < actions.length; a++) {
    const action = actions[a]!;
    let p = list[a];
    if (!p || p.action !== action || p.title !== action.title || p.keywords !== action.keywords) {
      p = list[a] = { action, title: action.title, keywords: action.keywords, names: [action.title, ...(action.keywords ?? [])].map(nameOf) };
    }
  }
  list.length = actions.length;
  return list;
}

// fuzzyScore(q, name) for a q that is already trimmed and lowercase, `tokens` being its words.
function scoreName(q: string, tokens: readonly string[], n: Name, letters: number, digits: number): number {
  const t = n.lower;
  if (t === q) return 1000;
  if ((n.letters & letters) !== letters || (n.digits & digits) !== digits) return 0;
  const tw = n.words;
  let score = t.startsWith(q) ? 200 : 0;
  for (const token of tokens) {
    let i = 0;
    while (i < tw.length && !tw[i]!.startsWith(token)) i++;
    if (i < tw.length) score += 60 + token.length * 4 - i * 2;
    else if (token.length >= 3 && t.includes(token)) score += 25 + token.length;
    else if (token.length >= 2 && isSubsequence(token, (n.plain ??= t.replace(/[^a-z0-9]/g, "")))) score += 8;
    else return 0;
  }
  return score - tw.length;
}

export function matchActions<T extends ActionCandidate>(query: string, actions: readonly T[], limit = 3): ActionMatch<T>[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (q.length < 2) return [];
  const tokens = words(q);
  let letters = 0;
  let digits = 0;
  for (const token of tokens) {
    for (let i = 0; i < token.length; i++) {
      const c = token.charCodeAt(i);
      if (c >= 97) letters |= 1 << (c - 97);
      else digits |= 1 << (c - 48);
    }
  }
  const names = preparedNames(actions);
  const hits: ActionMatch<T>[] = [];
  for (let a = 0; a < actions.length; a++) {
    const list = names[a]!.names;
    let score = -Infinity;
    let exact = false;
    for (let i = 0; i < list.length; i++) {
      const n = list[i]!;
      if (n.lower === q) exact = true;
      const s = scoreName(q, tokens, n, letters, digits) - (i > 0 ? 5 : 0);
      if (s > score) score = s;
    }
    if (score > 0) hits.push({ action: actions[a]!, score, exact });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
