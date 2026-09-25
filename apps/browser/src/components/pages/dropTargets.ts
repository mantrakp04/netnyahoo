import type { View } from "react-native";

export type Rect = { x: number; y: number; width: number; height: number };

/**
 * Drop targets for drags built on PanResponder: views register themselves, the
 * drag measures them all (window coordinates) when it starts, then hit-tests
 * the pointer (PanResponder's moveX/moveY are window coordinates too).
 */
export class DropTargets<T> {
  private views = new Map<string, { view: View; data: T }>();
  private rects = new Map<string, { rect: Rect; data: T }>();

  /** A ref callback registering `key` with `data`. */
  ref(key: string, data: T) {
    return (view: View | null) => {
      if (view) this.views.set(key, { view, data });
      else if (this.views.get(key)?.data === data) this.views.delete(key);
    };
  }

  measure() {
    this.rects.clear();
    for (const [key, { view, data }] of this.views) {
      view.measureInWindow((x, y, width, height) => {
        if (width > 0 && height > 0) this.rects.set(key, { rect: { x, y, width, height }, data });
      });
    }
  }

  /** The target under a point, with the point's position inside it (0…1 vertically). */
  hit(x: number, y: number): { key: string; data: T; rect: Rect; fraction: number } | null {
    for (const [key, { rect, data }] of this.rects) {
      if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) {
        return { key, data, rect, fraction: (y - rect.y) / rect.height };
      }
    }
    return null;
  }
}
