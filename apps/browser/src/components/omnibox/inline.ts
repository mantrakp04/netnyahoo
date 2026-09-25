/**
 * Inline autocompletion in the command bar's field ("m" → "m[ail.google.com]", the completion
 * selected so the next key replaces it), kept straight while JS runs a round trip behind the keyboard.
 *
 * The field owns the text. JS hears each change (`onChange`), computes a completion for it and asks
 * the field to show it (`completeInline`). The field does, in one step, only if it still shows the
 * text the completion was computed for; otherwise the user has typed on and the request is dropped.
 * A completion written to the field comes back as an `onChange` of its own: the echo.
 */

/** A completion for `typed`: the field shows `typed + completion`, the completion selected. */
export type Inline = { typed: string; completion: string };

/**
 * A completion asked of the field, not heard back about. `orphaned` once JS has put other text in
 * the bar itself (Esc, a scope, a reset): its echo, if it lands, is then overwritten.
 */
export type PendingInline = Inline & { orphaned?: boolean };

/** What the bar makes of the field's text changing. */
export type FieldChange =
  | {
      echo: false;
      typed: string;
      /** Don't complete `typed`: it was reached by deleting. */
      suppress: boolean;
    }
  | {
      /** A completion JS asked for: `pending[settled - 1]` (earlier requests were overtaken). */
      echo: true;
      settled: number;
      inline: Inline;
      /**
       * JS has put other text in the field since asking (Esc, a scope, a reset): keep that; the
       * TextInput writes it back over the echo.
       */
      stale: boolean;
    };

/**
 * The field's text is now `next`. `typed` / `shown` are what JS last knew it to show and
 * `pending` the completions it asked for and hasn't heard back about, oldest first.
 */
export function fieldChange(typed: string, shown: string, next: string, pending: readonly PendingInline[]): FieldChange {
  // Every prefix of a host completes to the same text, so the echo is the request made for what JS
  // has heard the field show (events arrive in order, so that's what the field showed when the
  // request landed). Requests for older text are refused, and a key that happens to produce the
  // same text as one of them is typing.
  const i = pending.findIndex((p) => next === p.typed + p.completion && (p.orphaned || p.typed === typed));
  if (i >= 0) {
    const { typed: t, completion, orphaned } = pending[i]!;
    return { echo: true, settled: i + 1, inline: { typed: t, completion }, stale: !!orphaned };
  }
  // Deleting (the selected completion, or back from the end) means "don't complete this", as in
  // Chrome: ⌫ over a completion removes just the completion. Typing over a selection does complete.
  const deletedCompletion = !!shown && next === typed;
  const deleting = next.length < typed.length && typed.startsWith(next);
  return { echo: false, typed: next, suppress: deletedCompletion || deleting };
}

/**
 * The completion to ask the field for, when what it shows for `typed` (`shown`, or the last
 * request on its way) isn't `wanted`.
 */
export function completionToWrite(typed: string, wanted: string, shown: string, pending: readonly PendingInline[]): Inline | null {
  const last = pending[pending.length - 1];
  const showing = last && !last.orphaned && last.typed === typed ? last.completion : shown;
  return wanted === showing ? null : { typed, completion: wanted };
}

/** `pending` without its first request for `inline` (one that was refused, or already showing). */
export function withoutFirst(pending: readonly PendingInline[], inline: Inline): PendingInline[] {
  const i = pending.findIndex((p) => p.typed === inline.typed && p.completion === inline.completion);
  return i < 0 ? [...pending] : [...pending.slice(0, i), ...pending.slice(i + 1)];
}
