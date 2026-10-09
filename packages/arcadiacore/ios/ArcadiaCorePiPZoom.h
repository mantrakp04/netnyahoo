// ⌘-scroll and pinch on a Picture in Picture window: the size math, kept free of AppKit so
// packages/arcadiacore/tests/pip-zoom-test.mm can check it. Rects are AppKit screen points (origin bottom left).
#pragma once

#include <algorithm>
#include <cmath>

namespace arcadiacore_pip_zoom {

struct Rect {
  double x, y, w, h;
  double maxX() const { return x + w; }
  double maxY() const { return y + h; }
};
struct Size {
  double w, h;
};
struct Point {
  double x, y;
};

// How much one unit of scroll grows the window, as a factor e^(k·delta): a trackpad's precise deltas are points
// (a 150 pt swipe ≈ 1.8×), a wheel's are lines (one notch ≈ 8 %). The event's own direction, so it follows the
// user's natural scrolling setting: AppKit's "scroll up" (scrollingDeltaY > 0) grows it, as zoom does in Maps.
constexpr double kPerPoint = 0.004, kPerLine = 0.08;
// Within this of a screen edge the window is docked there: it grows and shrinks away from that edge, keeping its gap.
constexpr double kDockSlop = 64;

inline double ScrollFactor(double deltaY, bool precise) {
  return std::exp((precise ? kPerPoint : kPerLine) * deltaY);
}

// A pinch's incremental magnification (NSEvent.magnification).
inline double MagnifyFactor(double magnification) {
  return std::max(0.05, 1 + magnification);
}

// The widths the window may take at `aspect` (w / h): Chrome's own limits (the window's minimum and maximum
// content size, 284 × 160 and 80 % of the work area for a video), and never wider or taller than `visible`.
inline void WidthLimits(double aspect, Size minSize, Size maxSize, Rect visible, double *low, double *high) {
  *low = std::max({minSize.w, minSize.h * aspect, 1.0});
  *high = std::min({maxSize.w, maxSize.h * aspect, visible.w, visible.h * aspect});
  if (*low > *high) *low = *high;
}

// One axis: the new origin for a span growing from `size` to `next` around the docked edge, or the pointer.
inline double Anchor(double origin, double size, double next, double pointer, double low, double high) {
  double before = origin - low, after = high - (origin + size);
  if (std::min(before, after) <= kDockSlop) return before <= after ? origin : origin + size - next;
  double fraction = std::clamp((pointer - origin) / size, 0.0, 1.0);
  return pointer - fraction * next;
}

struct Result {
  Rect frame;    // whole points, fully inside `visible`
  double width;  // the exact width, for the next step (so slow, sub-point scrolls still add up)
};

// `frame` is the window now, `width` its exact width from the last step (or frame.w), `aspect` the width / height
// to keep. The window stays docked to the edges it's within kDockSlop of, else grows around the pointer.
inline Result Zoom(Rect frame, double width, double aspect, double factor, Point pointer, Rect visible, Size minSize,
                   Size maxSize) {
  double low, high;
  WidthLimits(aspect, minSize, maxSize, visible, &low, &high);
  double w = std::clamp(width * factor, low, high);
  // Whole points, still inside the limits; the height from the rounded width, so the aspect stays within half a point.
  double rw = std::clamp(std::round(w), std::ceil(low), std::max(std::ceil(low), std::floor(high)));
  double rh = std::round(rw / aspect);
  double x = Anchor(frame.x, frame.w, rw, pointer.x, visible.x, visible.maxX());
  double y = Anchor(frame.y, frame.h, rh, pointer.y, visible.y, visible.maxY());
  x = std::clamp(x, visible.x, visible.maxX() - rw);
  y = std::clamp(y, visible.y, visible.maxY() - rh);
  return {{std::round(x), std::round(y), rw, rh}, w};
}

}  // namespace arcadiacore_pip_zoom
