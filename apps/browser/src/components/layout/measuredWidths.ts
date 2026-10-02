import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

// Widths only a layout pass can tell (a text's), kept for the session: a view mounting again draws at the right size
// on its first frame instead of guessing and correcting itself a frame later.
const useWidths = create<Record<string, number>>()(() => ({}));

export const useMeasuredWidth = (key: string): number | undefined => useWidths((w) => w[key]);
export const useMeasuredWidths = (keys: string[]): (number | undefined)[] => useWidths(useShallow((w) => keys.map((k) => w[k])));

export function setMeasuredWidth(key: string, width: number) {
  if (useWidths.getState()[key] !== width) useWidths.setState({ [key]: width });
}
