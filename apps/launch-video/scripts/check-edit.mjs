// Fails the render when the edit breaks its own rules (src/timeline.ts): every clip boundary and super on the
// beat grid, no clip or super shorter than 12 frames (no flash frames), supers on screen at least 1.5 s,
// and camera breaks only where the frame is a flat colour (listed by hand in CAMERA_BREAKS).
import { BEAT, CAMERA, CAMERA_BREAKS, CLIPS, EV, SUPERS, TOTAL } from "../src/timeline.ts";

const errors = [];
const onBeat = (f) => f % BEAT === 0;
let prev = 0;
for (const c of CLIPS) {
  if (c.from !== prev) errors.push(`${c.src} starts at ${c.from}, the previous clip ended at ${prev}`);
  if (c.to - c.from < 12) errors.push(`${c.src} is ${c.to - c.from} frames`);
  // a clip may start off the beat only inside a zoom-through (a camera break)
  if (!onBeat(c.from) && !CAMERA_BREAKS.includes(c.from)) errors.push(`${c.src} starts off the beat at ${c.from}`);
  prev = c.to;
}
for (const s of SUPERS) {
  if (!onBeat(s.from)) errors.push(`"${s.text}" starts off the beat at ${s.from}`);
  if (s.to - s.from < 45) errors.push(`"${s.text}" is on screen ${s.to - s.from} frames (< 1.5 s)`);
}
for (const [k, v] of Object.entries({ addrOpen: EV.addrOpen, split: EV.split, storePress: EV.storePress, storeDone: EV.storeDone, repoClick: EV.repoClick }))
  if (!onBeat(v)) errors.push(`${k} at ${v} is off the beat`);
if (CAMERA.some((k, i) => i && k.f < CAMERA[i - 1].f)) errors.push("camera keys out of order");
if (TOTAL % (4 * BEAT)) errors.push(`length ${TOTAL} isn't whole bars`);
if (errors.length) {
  console.error("edit check failed:\n  " + errors.join("\n  "));
  process.exit(1);
}
console.log(`edit check: ${CLIPS.length} clips, ${SUPERS.length} supers, all on the grid; ${TOTAL} frames`);
