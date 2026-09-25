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

// MARK: Profile paging (sidebar)

/** The tab list follows at half the fingers' speed. */
export const PAGING_TRACKING_SCALE = 0.5;
export const PAGING_RUBBER_DIMENSION = 255;
/** How far the release speed carries the page when deciding where it settles (s). */
export const PAGING_PROJECTION = 0.2;

/**
 * Signed offset of the sidebar's list for a profile swipe: 1:1 up to a page, then rubber
 * band; toward a missing profile (the first / last) it rubber-bands from the start.
 */
export function pagingOffset(distance: number, direction: "back" | "forward", available: boolean, pageWidth: number) {
  const travel = Math.max(0, distance) * PAGING_TRACKING_SCALE;
  const along = rubberBand(travel, available ? pageWidth : 0, PAGING_RUBBER_DIMENSION);
  return direction === "back" ? along : -along;
}

/** Whether a released profile swipe moves to the next page. */
export function pagingCommits(offset: number, velocity: number, available: boolean, pageWidth: number) {
  if (!available) return false;
  return Math.abs(offset) + Math.max(0, velocity) * PAGING_TRACKING_SCALE * PAGING_PROJECTION > pageWidth / 2;
}
