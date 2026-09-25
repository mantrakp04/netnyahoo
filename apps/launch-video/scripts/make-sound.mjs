// Synthesizes the sound design into public/sound/track.wav, timed to src/timeline.ts:
// clock ticks while you search, a bell and a till on a find, a buzzer at time's up, thuds on
// headline slams, a whoosh for the pull-back, a stab for the end card. No samples, no music.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { B, FPS, R1_CLICK, R2_CLICK, TOTAL } from "../src/timeline.ts";

const SR = 44100;
const out = new Float32Array(Math.ceil((TOTAL / FPS) * SR));
const at = (frame) => Math.round((frame / FPS) * SR);
let seed = 7;
const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const add = (start, len, fn) => {
  for (let i = 0; i < len && start + i < out.length; i++) if (start + i >= 0) out[start + i] += fn(i / SR, i);
};

function tick(frame, hi = false) {
  const f = hi ? 2600 : 1900;
  add(at(frame), SR * 0.05, (t) => (Math.sin(2 * Math.PI * f * t) * 0.35 + noise() * 0.25) * Math.exp(-t * 140));
  add(at(frame), SR * 0.03, (t) => Math.sin(2 * Math.PI * 180 * t) * 0.3 * Math.exp(-t * 90));
}
function bell(frame) {
  const f0 = 1046.5;
  add(at(frame), SR * 1.6, (t) =>
    (Math.sin(2 * Math.PI * f0 * t) * 0.35 + Math.sin(2 * Math.PI * f0 * 2.76 * t) * 0.12 + Math.sin(2 * Math.PI * f0 * 5.4 * t) * 0.05) * Math.exp(-t * 3.2),
  );
  // the till: a bright noise "cha" and a second, higher bell
  add(at(frame + 2), SR * 0.12, (t) => noise() * 0.28 * Math.exp(-t * 35));
  add(at(frame + 5), SR * 1.2, (t) => Math.sin(2 * Math.PI * 1568 * t) * 0.22 * Math.exp(-t * 4));
}
function buzzer(frame) {
  add(at(frame), SR * 0.55, (t) => {
    let v = 0;
    for (let h = 1; h < 12; h += 2) v += Math.sin(2 * Math.PI * 98 * h * t) / h;
    const env = Math.min(1, t * 80) * (t < 0.45 ? 1 : Math.max(0, 1 - (t - 0.45) * 10));
    return v * 0.28 * env;
  });
}
function thud(frame, gain = 1) {
  add(at(frame), SR * 0.25, (t) => Math.sin(2 * Math.PI * (48 + 60 * Math.exp(-t * 30)) * t) * 0.55 * gain * Math.exp(-t * 14));
  add(at(frame), SR * 0.02, (t) => noise() * 0.15 * gain * Math.exp(-t * 200));
}
function whoosh(frame, secs, reverse = false) {
  let lp = 0;
  const n = Math.round(SR * secs);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / n;
    const shape = Math.sin(Math.PI * x) ** 2;
    const k = 0.02 + 0.25 * shape;
    lp += k * (noise() - lp);
    buf[i] = lp * shape * 0.9;
  }
  add(at(frame), n, (_, i) => buf[reverse ? n - 1 - i : i]);
}
function stab(frame) {
  const notes = [261.63, 329.63, 392.0, 523.25];
  add(at(frame), SR * 1.4, (t) => {
    let v = 0;
    for (const f of notes) for (let h = 1; h <= 4; h++) v += Math.sin(2 * Math.PI * f * h * t) / (h * h);
    return v * 0.09 * Math.exp(-t * 2.6) * Math.min(1, t * 200);
  });
  thud(frame, 1.2);
}

// Round 1 and 2: a tick every 10 frames until the find. Round 3: faster in the last second.
for (let i = 0; i < R1_CLICK; i += 10) tick(B.r1.from + i);
bell(B.r1.from + R1_CLICK);
thud(B.r2.from);
for (let i = 0; i < R2_CLICK; i += 10) tick(B.r2.from + i);
bell(B.r2.from + R2_CLICK);
thud(B.r3.from);
for (let i = 0; i < B.r3.dur; i += i < 60 ? 10 : 5) tick(B.r3.from + i, i >= 60);
buzzer(B.timeUp.from);
whoosh(B.twist.from + 2, 1.0);
thud(B.twist.from + 4, 0.8);
for (let j = 0; j < 4; j++) thud(B.receipts.from + j * 37, 0.9);
stab(B.end.from);
whoosh(B.bridge.from + 2, 0.9, true);

let peak = 0;
for (const v of out) peak = Math.max(peak, Math.abs(v));
const gain = 0.7 / peak;
const pcm = Buffer.alloc(44 + out.length * 2);
pcm.write("RIFF", 0);
pcm.writeUInt32LE(36 + out.length * 2, 4);
pcm.write("WAVEfmt ", 8);
pcm.writeUInt32LE(16, 16);
pcm.writeUInt16LE(1, 20);
pcm.writeUInt16LE(1, 22);
pcm.writeUInt32LE(SR, 24);
pcm.writeUInt32LE(SR * 2, 28);
pcm.writeUInt16LE(2, 32);
pcm.writeUInt16LE(16, 34);
pcm.write("data", 36);
pcm.writeUInt32LE(out.length * 2, 40);
out.forEach((v, i) => pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * gain)) * 32767), 44 + i * 2));
const dir = join(fileURLToPath(new URL(".", import.meta.url)), "../public/sound");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "track.wav"), pcm);
console.log("sound:", (out.length / SR).toFixed(2), "s");
