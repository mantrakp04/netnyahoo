// The ⌘-scroll / pinch size math of the Picture in Picture window (ios/ArcadiaCorePiPZoom.h). `pnpm -C packages/arcadiacore test`.
#include "../ios/ArcadiaCorePiPZoom.h"

#include <cstdio>
#include <cstdlib>

using namespace arcadiacore_pip_zoom;

static int failures = 0;
#define CHECK(cond)                                                \
  do {                                                             \
    if (!(cond)) {                                                 \
      std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);  \
      failures++;                                                  \
    }                                                              \
  } while (0)
static bool Near(double a, double b, double eps = 0.51) { return std::fabs(a - b) <= eps; }

int main() {
  // A 1512 × 945 work area with the menu bar, Chrome's limits for a 16:9 video.
  const Rect visible{0, 0, 1512, 945};
  const Size minSize{284, 160}, maxSize{1512 * 0.8, 945 * 0.8};
  const double aspect = 16.0 / 9;

  // Direction and scale: AppKit's scroll up grows, down shrinks, and they cancel out.
  CHECK(ScrollFactor(10, true) > 1 && ScrollFactor(-10, true) < 1);
  CHECK(Near(ScrollFactor(25, true) * ScrollFactor(-25, true), 1, 1e-12));
  CHECK(Near(ScrollFactor(150, true), 1.82, 0.01));  // one trackpad swipe
  CHECK(Near(ScrollFactor(1, false), 1.083, 0.001));  // one wheel notch
  CHECK(ScrollFactor(0, true) == 1);
  CHECK(MagnifyFactor(0.1) > 1 && MagnifyFactor(-0.1) < 1 && MagnifyFactor(-5) > 0);

  // Docked bottom right (Chrome's default place, 16 pt in): grows up and left, keeping both gaps.
  {
    Rect frame{1512 - 16 - 480, 16, 480, 270};
    Result r = Zoom(frame, 480, aspect, 1.25, {1300, 100}, visible, minSize, maxSize);
    CHECK(r.frame.w == 600 && Near(r.frame.h, 337.5));
    CHECK(Near(r.frame.maxX(), 1512 - 16) && r.frame.y == 16);
    CHECK(Near(r.frame.w / r.frame.h, aspect, 0.01));
  }
  // Docked top left: grows down and right.
  {
    Rect frame{20, 945 - 20 - 270, 480, 270};
    Result r = Zoom(frame, 480, aspect, 0.8, {100, 800}, visible, minSize, maxSize);
    CHECK(r.frame.x == 20 && Near(r.frame.maxY(), 945 - 20) && r.frame.w == 384);
  }
  // Free-floating in the middle: the point under the pointer stays under it.
  {
    Rect frame{500, 300, 480, 270};
    Point pointer{500 + 480 * 0.25, 300 + 270 * 0.75};
    Result r = Zoom(frame, 480, aspect, 1.5, pointer, visible, minSize, maxSize);
    CHECK(Near((pointer.x - r.frame.x) / r.frame.w, 0.25, 0.01));
    CHECK(Near((pointer.y - r.frame.y) / r.frame.h, 0.75, 0.01));
  }
  // Docked on one axis only (left edge, mid height): x stays, y follows the pointer.
  {
    Rect frame{10, 300, 480, 270};
    Result r = Zoom(frame, 480, aspect, 1.2, {200, 435}, visible, minSize, maxSize);
    CHECK(r.frame.x == 10 && Near(r.frame.y + r.frame.h / 2, 435, 1));
  }
  // Limits: no smaller than Chrome's minimum, no bigger than its maximum, and stopping there without drift.
  {
    Rect frame{1000, 16, 480, 270};
    Result small = Zoom(frame, 480, aspect, 0.01, {1200, 100}, visible, minSize, maxSize);
    CHECK(small.frame.w == 285 && small.frame.h == 160 && Near(small.width, 160 * aspect, 1e-9));
    Result again = Zoom(small.frame, small.width, aspect, 0.5, {1200, 100}, visible, minSize, maxSize);
    CHECK(again.frame.w == small.frame.w && again.frame.x == small.frame.x && again.frame.y == small.frame.y);
    Result big = Zoom(frame, 480, aspect, 100, {1200, 100}, visible, minSize, maxSize);
    CHECK(big.frame.w == 1209 && big.frame.h <= 945 * 0.8 + 0.5);
    // Past the limit, zooming back out answers at once (no dead zone to scroll back through).
    Result more = Zoom(big.frame, big.width, aspect, 3, {1200, 100}, visible, minSize, maxSize);
    Result back = Zoom(more.frame, more.width, aspect, ScrollFactor(-5, true), {1200, 100}, visible, minSize, maxSize);
    CHECK(more.frame.w == big.frame.w && back.frame.w < big.frame.w);
    CHECK(big.frame.x >= 0 && big.frame.maxX() <= 1512 && big.frame.y >= 0 && big.frame.maxY() <= 945);
  }
  // A tall video: the height limit decides the maximum width.
  {
    const double tall = 9.0 / 16;
    double low, high;
    WidthLimits(tall, minSize, maxSize, visible, &low, &high);
    CHECK(Near(high, 945 * 0.8 * tall, 1e-9) && Near(low, 284, 1e-9));
  }
  // Fully on screen, even when the pointer anchor would push it off (pointer at the window's right edge, near the
  // screen's right, not docked).
  {
    Rect frame{900, 300, 480, 270};
    Result r = Zoom(frame, 480, aspect, 2, {1380, 435}, visible, minSize, maxSize);
    CHECK(r.frame.x >= 0 && r.frame.maxX() <= 1512 && r.frame.y >= 0 && r.frame.maxY() <= 945);
  }
  // On a second screen with its own origin: docked and clamped against that screen.
  {
    Rect second{1512, -200, 1920, 1055};
    Rect frame{1512 + 1920 - 16 - 480, -200 + 16, 480, 270};
    Result r = Zoom(frame, 480, aspect, 1.5, {3200, -100}, second, minSize, {1920 * 0.8, 1055 * 0.8});
    CHECK(Near(r.frame.maxX(), 1512 + 1920 - 16) && r.frame.y == -200 + 16 && r.frame.w == 720);
  }
  // Slow trackpad scrolls of a fraction of a point add up through the exact width.
  {
    Rect frame{1000, 16, 480, 270};
    double width = 480;
    for (int i = 0; i < 100; i++) {
      Result r = Zoom(frame, width, aspect, ScrollFactor(0.5, true), {1200, 100}, visible, minSize, maxSize);
      frame = r.frame, width = r.width;
    }
    CHECK(Near(width, 480 * std::exp(0.004 * 50), 1e-6) && Near(frame.w, width));
  }
  // Aspect stays the video's (not drifting with rounding) over a long zoom in and out.
  {
    Rect frame{1000, 16, 480, 270};
    double width = 480;
    for (int i = 0; i < 400; i++) {
      double f = ScrollFactor(i < 200 ? 0.5 : -0.5, true);
      Result r = Zoom(frame, width, aspect, f, {1200, 100}, visible, minSize, maxSize);
      frame = r.frame, width = r.width;
      CHECK(Near(frame.h, frame.w / aspect));
    }
    CHECK(Near(width, 480, 1e-6) && frame.w == 480 && frame.h == 270 && Near(frame.maxX(), 1480) && frame.y == 16);
  }
  if (failures) return std::printf("%d failed\n", failures), 1;
  std::printf("pip-zoom: all passed\n");
  return 0;
}
