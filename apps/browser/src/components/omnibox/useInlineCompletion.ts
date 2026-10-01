import { completeInline } from "@netnyahoo/shell";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { findNodeHandle, type TextInput } from "react-native";
import { completionToWrite, fieldChange, withoutFirst, type FieldChange, type Inline, type PendingInline } from "./inline";

export function useInlineCompletion(input: RefObject<TextInput | null>, typed: string, wanted: string) {
  const [inline, setInline] = useState<Inline | null>(null);
  const pending = useRef<PendingInline[]>([]);
  const heard = useRef(typed);
  const shown = inline?.typed === typed ? inline.completion : "";

  useLayoutEffect(() => {
    if (typed !== heard.current) {
      heard.current = typed;
      pending.current = pending.current.map((p) => ({ ...p, orphaned: true }));
    }
    const write = completionToWrite(typed, wanted, shown, pending.current);
    const tag = write && findNodeHandle(input.current);
    if (!write || tag == null) return;
    pending.current = [...pending.current, write];
    const settle = (result: number) => {
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
