
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
  const deletedCompletion = !!shown && next === typed;
  const deleting = next.length < typed.length && typed.startsWith(next);
  return { echo: false, typed: next, suppress: deletedCompletion || deleting };
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
