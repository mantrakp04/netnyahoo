/**
 * Links to a quote on a page (text fragments, `#:~:text=`): Dia's quote link and
 * Chrome's "Copy Link to Highlight". The page supplies the selection and its
 * surroundings; this picks the shortest directive that still finds it.
 */

export type TextFragment = { prefix?: string; start: string; end?: string; suffix?: string };

export type SelectionContext = {
  /** The selected text as rendered (line breaks between blocks). */
  selected: string;
  /** The text before / after the selection within its block, for context. */
  before: string;
  after: string;
  /** The page's visible text, to check the quote isn't ambiguous. */
  pageText: string;
};

/** Selections longer than this link to their first and last words (textStart,textEnd). */
const MAX_EXACT_WORDS = 10;
const RANGE_WORDS = 3;
const MAX_CONTEXT_WORDS = 5;

const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
const wordsOf = (s: string) => normalize(s).split(" ").filter(Boolean);

function occurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + 1)) count++;
  return count;
}

const WORD_END = /[\p{L}\p{N}_]+$/u;
const WORD_START = /^[\p{L}\p{N}_]+/u;

/**
 * Text fragments only match whole words, so a selection that starts or ends inside
 * a word takes the rest of it (like Chrome's link generator).
 */
function toWordBoundaries({ selected, before, after, pageText }: SelectionContext): SelectionContext {
  const head = WORD_START.test(selected) ? (WORD_END.exec(before)?.[0] ?? "") : "";
  const tail = WORD_END.test(selected) ? (WORD_START.exec(after)?.[0] ?? "") : "";
  return {
    selected: head + selected + tail,
    before: before.slice(0, before.length - head.length),
    after: after.slice(tail.length),
    pageText,
  };
}

/** The directive for a selection, or null when nothing (only whitespace) is selected. */
export function chooseTextFragment(context: SelectionContext): TextFragment | null {
  const { selected, before, after, pageText } = toWordBoundaries(context);
  const blocks = selected.split(/\s*\n\s*/).map(normalize).filter(Boolean);
  if (!blocks.length) return null;
  const page = normalize(pageText).toLowerCase();
  const count = (text: string) => occurrences(page, text.toLowerCase());
  const all = blocks.flatMap(wordsOf);
  const beforeWords = wordsOf(before);
  const afterWords = wordsOf(after);

  // Matching is case-insensitive and can't span blocks, so a multi-block or long selection
  // links to a few words at each end instead.
  if (blocks.length === 1 && all.length <= MAX_EXACT_WORDS) {
    const start = all.join(" ");
    if (count(start) <= 1) return { start };
    // Grow the context on both sides until the quote is unique (or there's no more).
    for (let n = 1; ; n++) {
      const prefix = beforeWords.slice(-n).join(" ");
      const suffix = afterWords.slice(0, n).join(" ");
      const exhausted = n >= MAX_CONTEXT_WORDS || n >= Math.max(beforeWords.length, afterWords.length);
      if (exhausted || count([prefix, start, suffix].filter(Boolean).join(" ")) <= 1)
        return { ...(prefix && { prefix }), start, ...(suffix && { suffix }) };
    }
  }
  const first = wordsOf(blocks[0]!);
  const last = wordsOf(blocks[blocks.length - 1]!);
  // In a single block the two ends mustn't overlap.
  const most = blocks.length === 1 ? Math.floor(all.length / 2) : Math.min(first.length, last.length);
  let n = Math.min(RANGE_WORDS, most);
  while (n < most && count(first.slice(0, n).join(" ")) > 1) n++;
  const start = first.slice(0, n).join(" ");
  const end = last.slice(-n).join(" ");
  if (count(start) <= 1 || !beforeWords.length) return { start, end };
  return { prefix: beforeWords.slice(-RANGE_WORDS).join(" "), start, end };
}

// Percent-encodes a directive term: `-`, `,` and `&` are syntax there.
const encodeTerm = (s: string) => encodeURIComponent(s).replace(/-/g, "%2D");

/** `text=[prefix-,]start[,end][,-suffix]` */
export function textDirective({ prefix, start, end, suffix }: TextFragment): string {
  const parts = [prefix && `${encodeTerm(prefix)}-`, encodeTerm(start), end && encodeTerm(end), suffix && `-${encodeTerm(suffix)}`];
  return `text=${parts.filter(Boolean).join(",")}`;
}

/** `url` pointing at the quote; the page's own #fragment is kept, an older directive replaced. */
export function withTextFragment(url: string, fragment: TextFragment): string {
  const hash = url.indexOf("#");
  const base = hash === -1 ? url : url.slice(0, hash);
  let ref = hash === -1 ? "" : url.slice(hash + 1);
  const directive = ref.indexOf(":~:");
  if (directive !== -1) ref = ref.slice(0, directive);
  return `${base}#${ref}:~:${textDirective(fragment)}`;
}
