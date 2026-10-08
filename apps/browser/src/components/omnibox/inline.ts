
export type Inline = { typed: string; completion: string };

export type PendingInline = Inline & { orphaned?: boolean };

export type FieldChange =
  | {
      echo: false;
      typed: string;
      suppress: boolean;
    }
  | {
      echo: true;
      settled: number;
      inline: Inline;
      stale: boolean;
    };

export function fieldChange(typed: string, shown: string, next: string, pending: readonly PendingInline[]): FieldChange {
  const i = pending.findIndex((p) => next === p.typed + p.completion && (p.orphaned || p.typed === typed));
  if (i >= 0) {
    const { typed: t, completion, orphaned } = pending[i]!;
    return { echo: true, settled: i + 1, inline: { typed: t, completion }, stale: !!orphaned };
  }
  // Chrome's just_deleted_text: the user only took text out (Backspace, Delete, ⌥⌫, ⌘⌫, cut, deleting the selected
  // completion), anywhere in the field. Typing over a selection inserts text, so it isn't one.
  // A longer field that still starts with `typed` is typing over the selected completion ("git" over "gi" + "thub.com").
  const typing = next.length > typed.length && next.startsWith(typed);
  return { echo: false, typed: next, suppress: !typing && onlyRemoved(typed + shown, next) };
}

export function completionToWrite(typed: string, wanted: string, shown: string, pending: readonly PendingInline[]): Inline | null {
  const last = pending[pending.length - 1];
  const showing = last && !last.orphaned && last.typed === typed ? last.completion : shown;
  return wanted === showing ? null : { typed, completion: wanted };
}

export function withoutFirst(pending: readonly PendingInline[], inline: Inline): PendingInline[] {
  const i = pending.findIndex((p) => p.typed === inline.typed && p.completion === inline.completion);
  return i < 0 ? [...pending] : [...pending.slice(0, i), ...pending.slice(i + 1)];
}

// `next` is `from` with one run of characters cut out and nothing put in.
function onlyRemoved(from: string, next: string): boolean {
  if (next.length >= from.length) return false;
  let head = 0;
  while (head < next.length && next[head] === from[head]) head++;
  let tail = 0;
  while (tail < next.length - head && next[next.length - 1 - tail] === from[from.length - 1 - tail]) tail++;
  return head + tail >= next.length;
}
