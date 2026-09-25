import { completeInline } from "@netnyahoo/shell";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { findNodeHandle, type TextInput } from "react-native";
import { completionToWrite, fieldChange, withoutFirst, type FieldChange, type Inline, type PendingInline } from "./inline";

/**
 * The completion `wanted` for `typed`, shown selected in the field (see inline.ts). Returns the
 * completion the field shows now and `read`, which turns the field's `onChangeText` into typing
 * or the echo of a completion.
 *
 * Builds from before the native side put the completion in the field's value and select it
 * afterwards, which can still lose a key typed in between.
 */
export function useInlineCompletion(input: RefObject<TextInput | null>, typed: string, wanted: string) {
  const [inline, setInline] = useState<Inline | null>(null);
  /** Completions asked of the field that haven't come back yet, oldest first. */
  const pending = useRef<PendingInline[]>([]);
  /** The text the field last reported; `typed` differs when the bar set its text itself. */
  const heard = useRef(typed);
  const shown = !completeInline ? wanted : inline?.typed === typed ? inline.completion : "";

  useLayoutEffect(() => {
    if (!completeInline) {
      if (shown) input.current?.setSelection(typed.length, typed.length + shown.length);
      return;
    }
    if (typed !== heard.current) {
      heard.current = typed;
      pending.current = pending.current.map((p) => ({ ...p, orphaned: true }));
    }
    const write = completionToWrite(typed, wanted, shown, pending.current);
    const tag = write && findNodeHandle(input.current);
    if (!write || tag == null) return;
    pending.current = [...pending.current, write];
    const settle = (result: number) => {
      // 2: the echo settles it. 0: refused, the field has moved on (its change computes a new
      // completion). 1: the field already showed it.
      if (result === 2) return;
      pending.current = withoutFirst(pending.current, write);
      if (result === 1) setInline(write);
    };
    completeInline(tag, write.typed, write.completion).then(settle, () => settle(0));
  }, [input, typed, wanted, shown]);

  const read = (next: string): FieldChange => {
    const change = fieldChange(typed, shown, next, pending.current);
    if (change.echo) {
      pending.current = pending.current.slice(change.settled);
      if (!change.stale) setInline(change.inline);
    } else {
      heard.current = change.typed;
      setInline(null);
    }
    return change;
  };

  return { shown, read };
}
