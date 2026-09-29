export type HLC = string;

const WALL_DIGITS = 9;
const COUNTER_DIGITS = 4;

export const formatHLC = (wall: number, counter: number, device: string): HLC =>
  `${Math.max(0, Math.floor(wall)).toString(36).padStart(WALL_DIGITS, "0")}.${counter.toString(36).padStart(COUNTER_DIGITS, "0")}.${device}`;

export function parseHLC(h: HLC): { wall: number; counter: number; device: string } {
  const [wall = "0", counter = "0", ...device] = h.split(".");
  return { wall: parseInt(wall, 36), counter: parseInt(counter, 36), device: device.join(".") };
}

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

  at(time: number): HLC {
    return formatHLC(Math.min(time, this.now()), 0, this.device);
  }

  observe(h: HLC) {
    const { wall, counter } = parseHLC(h);
    if (wall > this.wall || (wall === this.wall && counter > this.counter)) {
      this.wall = wall;
      this.counter = counter;
    }
  }

  get last(): HLC {
    return formatHLC(this.wall, this.counter, this.device);
  }
}
