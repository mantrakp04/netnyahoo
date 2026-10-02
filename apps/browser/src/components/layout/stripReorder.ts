import { Animated } from "react-native";
import { dragGeometry, type DragGeometry } from "./stripGroups";

// Dragging along the top strip, as Dia does it: once the dragged item's leading edge passes a neighbour's centre,
// that neighbour slides into the place it leaves, while the drag goes on; let go, the item settles into its place.
// Measured from the owner's recording of Dia (2026-10-02, 60 fps): a neighbour covers 91 % of its way in 43 ms,
// 97 % in 60 and all of it by 76: a critically damped spring of ~0.07 s (ω ≈ 90 rad/s). The dragged tab, opaque,
// keeps its place under the pointer.
// JS driver: the drop moves the slots in the store and zeroes their offsets in the same bridge batch as the React
// commit that lays them out there, so no frame shows both.
// It comes to rest within a quarter point, so a settle that has nowhere to go ends at once.
export const SLIDE = { stiffness: 8100, damping: 180, mass: 1, restDisplacementThreshold: 0.25, restSpeedThreshold: 2, useNativeDriver: false } as const;

// Every item of every strip that can trade places: its row (`geometry`, the object its strip rendered it with), its
// index there, and the offset it slides by.
type Slot = { geometry: () => DragGeometry; index: () => number; shift: Animated.Value; to: number };
const slots = new Set<Slot>();

export function registerSlot(geometry: () => DragGeometry, index: () => number, shift: Animated.Value): () => void {
  const slot: Slot = { geometry, index, shift, to: 0 };
  slots.add(slot);
  return () => void slots.delete(slot);
}

/** Each slot's move once slot `from` lands at `to` (dropIndex): from where it is to where the new order puts it. */
export function reorderOffsets({ slots: row, lefts }: DragGeometry, from: number, to: number): number[] {
  // The row's gap, as dragGeometry laid it out.
  const gap = row.length > 1 ? lefts[1]! - lefts[0]! - row[0]!.width - (row[0]!.marginRight ?? 0) - (row[1]!.marginLeft ?? 0) : 0;
  const order = row.map((_, i) => i).filter((i) => i !== from);
  order.splice(to, 0, from);
  const moved = dragGeometry(order.map((i) => row[i]!), gap);
  const out: number[] = [];
  order.forEach((i, k) => (out[i] = moved.lefts[k]! - lefts[i]!));
  return out;
}

/** The dragged slot is over place `to` (`from`: back home): the others in its row slide where that puts them. */
export function makeRoom(geometry: DragGeometry, from: number, to: number) {
  const offsets = reorderOffsets(geometry, from, to);
  for (const slot of slots) {
    const i = slot.index();
    if (slot.geometry() !== geometry || i === from || i < 0) continue;
    const target = offsets[i] ?? 0;
    if (slot.to === target) continue;
    slot.to = target;
    Animated.spring(slot.shift, { toValue: target, ...SLIDE }).start();
  }
}

/** The store moved the row's slots where they slid: they stand there with no offset. */
export function settleRoom(geometry: DragGeometry) {
  for (const slot of slots) {
    if (slot.geometry() !== geometry) continue;
    slot.shift.stopAnimation();
    slot.shift.setValue(0);
    slot.to = 0;
  }
}
