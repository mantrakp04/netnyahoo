import { useRef, useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";

export type RecycledItem = { key: string; kind: string; offset: number; height: number };

type Slot = { id: string; kind: string; item: RecycledItem };

/**
 * A scrolling list of items whose offsets and heights are known, made of a fixed set of row views ("slots"): an item
 * scrolling in takes the slot of one that scrolled out, so React updates that row's props instead of making new views.
 * FlatList made each new row's views as it scrolled into its window (on macOS a row of the History page is a dozen
 * NSViews plus an NSTextView per Text), which held the main thread for up to ~90 ms at a time while scrolling.
 *
 * It renders a viewport above and two below what's visible, and moves that window once the scroll has gone half a
 * viewport from where it was last placed: each move hands about a dozen slots new items.
 */
export function RecycledList<T extends RecycledItem>({
  items,
  renderItem,
  paddingBottom = 0,
}: {
  items: T[];
  renderItem: (item: T) => ReactNode;
  paddingBottom?: number;
}) {
  const [viewport, setViewport] = useState(1000);
  const [anchor, setAnchor] = useState(0);
  const slots = useRef<Slot[]>([]);
  const last = items.at(-1);
  const total = last ? last.offset + last.height : 0;
  const at = Math.max(0, Math.min(anchor, total - viewport));
  // Always three viewports tall (at the top, all of it below), so every slot is made when the list opens and none on
  // the first scroll.
  const top = Math.max(0, at - viewport);
  const bottom = top + 3 * viewport;

  // The items in the window, found by binary search (items are in offset order).
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid]!.offset + items[mid]!.height <= top) lo = mid + 1;
    else hi = mid;
  }
  const shown: T[] = [];
  for (let i = lo; i < items.length && items[i]!.offset < bottom; i++) shown.push(items[i]!);

  // Items keep their slot while shown; a slot whose item left takes a new one of the same kind. Slots never reorder
  // (moving native children costs), and one with nothing to show keeps its last item, out of sight.
  const keys = new Set(shown.map((i) => i.key));
  const held = new Map<string, Slot>();
  const free = new Map<string, Slot[]>();
  for (const slot of slots.current) {
    if (keys.has(slot.item.key) && !held.has(slot.item.key)) held.set(slot.item.key, slot);
    else if (free.has(slot.kind)) free.get(slot.kind)!.push(slot);
    else free.set(slot.kind, [slot]);
  }
  const showing = new Set<Slot>();
  for (const item of shown) {
    let slot = held.get(item.key) ?? free.get(item.kind)?.shift();
    if (!slot) {
      slot = { id: `${item.kind}${slots.current.length}`, kind: item.kind, item };
      slots.current.push(slot);
    }
    slot.item = item;
    showing.add(slot);
  }

  return (
    <ScrollView
      style={{ flex: 1 }}
      scrollEventThrottle={16}
      onLayout={(e) => setViewport(Math.max(1, e.nativeEvent.layout.height))}
      onScroll={(e) => {
        const y = e.nativeEvent.contentOffset.y;
        if (Math.abs(y - at) > viewport / 2) setAnchor(y);
      }}
    >
      <View style={{ height: total + paddingBottom }}>
        {slots.current.map((slot) => {
          const visible = showing.has(slot);
          return (
            <View
              key={slot.id}
              pointerEvents={visible ? "auto" : "none"}
              style={{ position: "absolute", left: 0, right: 0, top: visible ? slot.item.offset : -10_000, height: slot.item.height, alignItems: "center" }}
            >
              {renderItem(slot.item as T)}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}
