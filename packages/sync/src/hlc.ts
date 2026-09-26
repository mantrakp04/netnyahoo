/**
 * Hybrid logical clocks. A timestamp is `wall.counter.device`: wall time in ms (base 36, 9
 * digits), a counter (base 36, 4 digits) and the device id, fixed width, so comparing the
 * strings compares the clocks. The newest timestamp wins a conflict (last writer wins), the
 * device id breaks exact ties, and every device resolves the same way.
 *
 * Clock skew: a device's clock never goes back below the newest timestamp it has seen, so an
 * edit made after seeing another device's edit is newer than it even if this Mac's clock is
 * behind. Only truly concurrent edits (neither device saw the other's) are ordered by the
 * (possibly skewed) wall clocks.
 */
export type HLC = string;

const WALL_DIGITS = 9;
const COUNTER_DIGITS = 4;

export const formatHLC = (wall: number, counter: number, device: string): HLC =>
  `${Math.max(0, Math.floor(wall)).toString(36).padStart(WALL_DIGITS, "0")}.${counter.toString(36).padStart(COUNTER_DIGITS, "0")}.${device}`;

export function parseHLC(h: HLC): { wall: number; counter: number; device: string } {
  const [wall = "0", counter = "0", ...device] = h.split(".");
  return { wall: parseInt(wall, 36), counter: parseInt(counter, 36), device: device.join(".") };
}

/** The wall time (ms) of a timestamp. */
export const hlcWall = (h: HLC) => parseInt(h.slice(0, WALL_DIGITS), 36);

export class Clock {
  private wall = 0;
  private counter = 0;
  readonly device: string;
  private readonly now: () => number;

  constructor(device: string, last?: HLC | null, now: () => number = Date.now) {
    this.device = device;
    this.now = now;
    if (last) this.observe(last);
  }

  /** A timestamp for an edit made now, newer than everything this clock has issued or seen. */
  tick(): HLC {
    const t = this.now();
    if (t > this.wall) {
      this.wall = t;
      this.counter = 0;
    } else {
      this.counter++;
    }
    return formatHLC(this.wall, this.counter, this.device);
  }

  /**
   * A timestamp for something first published now that was made earlier (a password saved
   * last month, before sync was on), so it doesn't beat a later edit on another Mac.
   * It doesn't move the clock.
   */
  at(time: number): HLC {
    return formatHLC(Math.min(time, this.now()), 0, this.device);
  }

  /** Folds in a timestamp from another device. */
  observe(h: HLC) {
    const { wall, counter } = parseHLC(h);
    if (wall > this.wall || (wall === this.wall && counter > this.counter)) {
      this.wall = wall;
      this.counter = counter;
    }
  }

  /** The newest timestamp issued or seen, to persist. */
  get last(): HLC {
    return formatHLC(this.wall, this.counter, this.device);
  }
}
