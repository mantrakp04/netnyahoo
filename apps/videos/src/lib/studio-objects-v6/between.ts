import {
  geometryBetween as between,
  type PoseFields as Fields,
  type BetweenMotion as Motion,
} from "../studio-objects-v5/between";

export type BetweenMotion = Motion;
export type PoseFields = Fields;
export const geometryBetween = between;
