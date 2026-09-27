// Fails "Pour"'s render when the edit breaks its own rules (src/pour/timeline.ts): every picture change, line,
// subtitle and super on the beat grid; nothing on screen for under 12 frames (supers and subtitles at least
// 1.5 s); each line's voice finished before the next line starts; the camera never past 1.45x the 2x capture.
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BEAT, CAMERA, EV, FOCUS, focusClipStart, LINES, PLATES, SUPERS, TOTAL, at } from "../src/pour/timeline.ts";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const errors = [];
const onBeat = (f) => f % BEAT === 0;

PLATES.forEach((p, i) => {
  if (!onBeat(p.from)) errors.push(`plate ${p.id} completes off the beat at ${p.from}`);
  const next = PLATES[i + 1];
  if (next && next.from - next.fade - p.from < 12) errors.push(`plate ${p.id} is fully on screen for ${next.from - next.fade - p.from} frames`);
});
if (focusClipStart() + FOCUS.rest !== at(4)) errors.push("the Focus slide doesn't start on bar 4's downbeat");

const seconds = (file) => Number(execFileSync("/opt/homebrew/bin/ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", join(root, "assets/sound", file)], { encoding: "utf8" }));
LINES.forEach((l, i) => {
  if (!onBeat(l.at) || !onBeat(l.until)) errors.push(`"${l.text}" is off the beat (${l.at}–${l.until})`);
  if (l.until - l.at < 45) errors.push(`"${l.text}" is on screen ${l.until - l.at} frames (< 1.5 s)`);
  const end = l.at + Math.ceil(seconds(`pour-vo-${l.id}.mp3`) * 30);
  const next = LINES[i + 1];
  if (next && end > next.at) errors.push(`"${l.text}" is still speaking at frame ${end}, after the next line starts (${next.at})`);
  if (next && l.until > next.at) errors.push(`"${l.text}" is still on screen when "${next.text}" starts`);
});
for (const s of SUPERS) {
  if (!onBeat(s.from) || !onBeat(s.to)) errors.push(`"${s.text}" is off the beat (${s.from}–${s.to})`);
  if (s.to - s.from < 45) errors.push(`"${s.text}" is on screen ${s.to - s.from} frames (< 1.5 s)`);
}
for (const [k, v] of Object.entries(EV)) if (!onBeat(v)) errors.push(`${k} at ${v} is off the beat`);
CAMERA.forEach((k, i) => {
  if (i && k.f <= CAMERA[i - 1].f) errors.push(`camera key ${i} (${k.f}) out of order`);
  if (k.s > 1.45) errors.push(`camera key at ${k.f} magnifies the capture ${k.s}x`);
});
if (TOTAL % (4 * BEAT)) errors.push(`length ${TOTAL} isn't whole bars`);
if (errors.length) {
  console.error("pour edit check failed:\n  " + errors.join("\n  "));
  process.exit(1);
}
console.log(`pour edit check: ${PLATES.length} pictures, ${LINES.length} lines, ${SUPERS.length} supers, all on the grid; ${TOTAL} frames`);
