
// Dia: 72→82pt capsule, 14pt inset, 38pt rows.
export const SWIPE_UNIT = 75;
export const CAPSULE_SIZE = 72;
export const CAPSULE_SIZE_CONFIRMED = 82;
export const CAPSULE_INSET = 14;
export const RUBBER_COEFFICIENT = 0.15;

export function rubberBand(value: number, limit: number, dimension: number, c = RUBBER_COEFFICIENT) {
  if (value <= limit) return value;
  return limit + (1 - 1 / (((value - limit) * c) / dimension + 1)) * dimension;
}

export const swipeProgress = (distance: number) => Math.max(0, distance / SWIPE_UNIT);

export function capsuleOffset(progress: number, width: number) {
  const limit = width + CAPSULE_INSET;
  return rubberBand(progress * limit, limit, limit) - width;
}

export function springParams(response: number, dampingRatio: number) {
  return { stiffness: (2 * Math.PI / response) ** 2, damping: (4 * Math.PI * dampingRatio) / response, mass: 1 };
}

export const LIST_ROW = 38;

export function listSelection(dySinceShown: number, count: number) {
  const rows = dySinceShown / SWIPE_UNIT;
  const index = Math.max(0, Math.min(count - 1, Math.round(rows)));
  const past = rows < 0 ? rows : rows > count - 1 ? rows - (count - 1) : 0;
  const overshoot = Math.abs(past) * SWIPE_UNIT;
  const nudge = past ? Math.sign(past) * LIST_ROW * (1 - 1 / (0.1 * overshoot + 1)) * 0.5 : 0;
  return { index, nudge };
}

// MARK: Profile paging (sidebar, tab strip)

// Dia: 0.5× paging, 255pt rubber band, 5pt/s flick, 0.25s settle.
export const PAGING_TRACKING_SCALE = 0.5;
export const PAGING_RUBBER_DIMENSION = 255;
export const PAGING_FLICK_VELOCITY = 5;
export const PAGING_SETTLE_RESPONSE = 0.25;

export function pagingPosition(start: number, distance: number, direction: "back" | "forward", pageWidth: number, lo: number, hi: number) {
  const raw = start + ((direction === "back" ? -1 : 1) * distance * PAGING_TRACKING_SCALE) / pageWidth;
  if (raw > hi) return hi + rubberBand((raw - hi) * pageWidth, 0, PAGING_RUBBER_DIMENSION) / pageWidth;
  if (raw < lo) return lo - rubberBand((lo - raw) * pageWidth, 0, PAGING_RUBBER_DIMENSION) / pageWidth;
  return raw;
}

export function pagingTarget(position: number, velocity: number, pageWidth: number, lo: number, hi: number, home: number) {
  const flick = Math.abs(velocity * pageWidth) >= PAGING_FLICK_VELOCITY;
  const target = !flick ? Math.round(position) : velocity > 0 ? Math.floor(position) + 1 : Math.ceil(position) - 1;
  return Math.max(lo, home - 1, Math.min(hi, home + 1, target));
}
