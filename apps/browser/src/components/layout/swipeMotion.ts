/**
 * The swipe gestures' motion, recovered from Dia's GesturalNavigation and ARCUI
 * PageSwipeController (numbers from its binary). Pure, so it's unit-tested.
 */

/** Points of scroll per unit of progress (Dia's native-page and Magic Mouse drivers). */
export const SWIPE_UNIT = 75;
export const CAPSULE_SIZE = 72;
export const CAPSULE_SIZE_CONFIRMED = 82;
/** Where the capsule sits, in from the pane's edge, at the threshold. */
export const CAPSULE_INSET = 14;
export const RUBBER_COEFFICIENT = 0.15;

/** Apple's rubber band (UIScrollView): past `limit`, the overshoot approaches `dimension`. */
export function rubberBand(value: number, limit: number, dimension: number, c = RUBBER_COEFFICIENT) {
  if (value <= limit) return value;
  return limit + (1 - 1 / (((value - limit) * c) / dimension + 1)) * dimension;
}

/** Progress of a navigation swipe: 1 at the threshold, where letting go navigates. */
export const swipeProgress = (distance: number) => Math.max(0, distance / SWIPE_UNIT);

/**
 * The capsule's offset from the pane's edge (its near side): fully hidden at 0, `CAPSULE_INSET`
 * at the threshold, rubber-banding past it. `width` is the capsule's (72, 82 or the list's).
 */
export function capsuleOffset(progress: number, width: number) {
  const limit = width + CAPSULE_INSET;
  return rubberBand(progress * limit, limit, limit) - width;
}

/** Stiffness and damping (mass 1) for a spring given as response (s) and damping ratio. */
export function springParams(response: number, dampingRatio: number) {
  return { stiffness: (2 * Math.PI / response) ** 2, damping: (4 * Math.PI * dampingRatio) / response, mass: 1 };
}

/** Destination list: rows of 38 pt, one row per `SWIPE_UNIT` of vertical scroll. */
export const LIST_ROW = 38;

/** The picked row, and how far the list follows past either end (rubber band, points). */
export function listSelection(dySinceShown: number, count: number) {
  const rows = dySinceShown / SWIPE_UNIT;
  const index = Math.max(0, Math.min(count - 1, Math.round(rows)));
  const past = rows < 0 ? rows : rows > count - 1 ? rows - (count - 1) : 0;
  const overshoot = Math.abs(past) * SWIPE_UNIT;
  const nudge = past ? Math.sign(past) * LIST_ROW * (1 - 1 / (0.1 * overshoot + 1)) * 0.5 : 0;
  return { index, nudge };
}

// MARK: Profile paging (sidebar, tab strip)
//
// ARCUI's PageSwipeController (Dia 1.50.1). Positions are in pages ("slots"): page k sits at
// (k − position) × page width. Its trackpad loop adds −0.5 × scrollingDeltaX per event to the
// position in points (0x100597ba0), rubber-bands past the first and last page (255 pt, c = 0.15),
// and on release picks the page with the position's velocity (0x100599610): at 5 pt/s or more
// the next page that way (one at most from where the swipe began), slower the nearest one.

/** Points of page travel per point of scroll (PageSwipeController: `delta × −0.5`). */
export const PAGING_TRACKING_SCALE = 0.5;
export const PAGING_RUBBER_DIMENSION = 255;
/** Release speed (page points per second) at which the swipe goes the way it was moving. */
export const PAGING_FLICK_VELOCITY = 5;
/** The settle: a critically damped spring, 0.25 s (`sidebar-space-swipe-animations`; 0.4 s before 1.50). */
export const PAGING_SETTLE_RESPONSE = 0.25;

/**
 * The position for a swipe that began at `start` and has travelled `distance` points of scroll
 * toward `direction` ("back" shows the page before): half speed, rubber band outside [lo, hi].
 */
export function pagingPosition(start: number, distance: number, direction: "back" | "forward", pageWidth: number, lo: number, hi: number) {
  const raw = start + ((direction === "back" ? -1 : 1) * distance * PAGING_TRACKING_SCALE) / pageWidth;
  if (raw > hi) return hi + rubberBand((raw - hi) * pageWidth, 0, PAGING_RUBBER_DIMENSION) / pageWidth;
  if (raw < lo) return lo - rubberBand((lo - raw) * pageWidth, 0, PAGING_RUBBER_DIMENSION) / pageWidth;
  return raw;
}

/**
 * Where a released swipe settles: `velocity` in pages per second. Within [lo, hi] and one page
 * of `home` (the page the swipe started from).
 */
export function pagingTarget(position: number, velocity: number, pageWidth: number, lo: number, hi: number, home: number) {
  const flick = Math.abs(velocity * pageWidth) >= PAGING_FLICK_VELOCITY;
  const target = !flick ? Math.round(position) : velocity > 0 ? Math.floor(position) + 1 : Math.ceil(position) - 1;
  return Math.max(lo, home - 1, Math.min(hi, home + 1, target));
}
