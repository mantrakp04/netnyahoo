// Synthesizes the sound design into public/sound/track.wav, timed to src/timeline.ts:
// pledge thuds, a power-down, the game's clock, a pop for Big Yahu, a stab and a stamp for the
// call to action. No samples, no music.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { B, FPS, PLEDGE_LEN, TOTAL } from "../src/timeline.ts";

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

function pop(frame) {
  add(at(frame), SR * 0.35, (t) => Math.sin(2 * Math.PI * (220 + 520 * Math.min(1, t * 9)) * t) * 0.4 * Math.exp(-t * 9));
}
function powerDown(frame) {
  add(at(frame), SR * 0.7, (t) => Math.sin(2 * Math.PI * (660 * Math.exp(-t * 3.5)) * t) * 0.3 * Math.exp(-t * 3));
}

// A thud and a small bell for each pledge "kept"; the Wi-Fi powering down; the game's clock
// ticking; a pop when Big Yahu comes up; a stab and the stamp for "Impeach Chrome."
stab(B.poster.from + 1);
for (let i = 0; i < 6; i++) {
  thud(B.pledges.from + i * PLEDGE_LEN, 0.8);
  add(at(B.pledges.from + i * PLEDGE_LEN + 3), SR * 0.6, (t) => Math.sin(2 * Math.PI * 1568 * t) * 0.12 * Math.exp(-t * 7));
}
powerDown(B.offline.from);
thud(B.offline.from + 2, 0.7);
whoosh(B.offline.from + 10, 0.8);
whoosh(B.find.from, 0.5);
for (let i = 0; i < 54; i += 10) tick(B.find.from + i);
pop(B.cta.from + 1);
thud(B.cta.from + 8, 1);
stab(B.cta.from + 26);
thud(B.cta.from + 26, 1.3);
whoosh(B.bridge.from + 1, 0.8, true);

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
