
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
