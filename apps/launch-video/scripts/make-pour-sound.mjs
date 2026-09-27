// Builds public/sound/pour.wav for "Pour": the score (Eleven Music v2.5, instrumental; assets/sound/pour-music.mp3)
// stretched from its measured 66.43 BPM onto the film's 66.67 BPM grid, and the whispered lines (eleven_v3,
// assets/sound/pour-vo-*.mp3), each placed so its first sound lands on its frame (src/pour/timeline.ts).
// No sound effects: the subtractive pass took out everything that wasn't the score or the voice.
// The score dips under each line; master: a static gain to -14 LUFS integrated, then a 4x-oversampled limiter.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FPS, LINES, TOTAL } from "../src/pour/timeline.ts";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const parts = join(root, "assets/sound");
const dir = join(root, "public/sound");
const work = join(dir, "work");
mkdirSync(work, { recursive: true });
const FFMPEG = "/opt/homebrew/bin/ffmpeg";
const ffmpeg = (...args) => execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], { maxBuffer: 1 << 30 });
const SR = 48000;
const TAIL = 0; // the film ends on the score's ringing chord; the loop restarts on frame 0
const N = Math.round((TOTAL / FPS + TAIL) * SR);
const db = (x) => Math.pow(10, x / 20);
const sec = (frame) => frame / FPS;

function load(name, filter) {
  const raw = ffmpeg("-i", join(parts, name), ...(filter ? ["-af", filter] : []), "-f", "f32le", "-ac", "2", "-ar", String(SR), "pipe:1");
  const f = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const l = new Float32Array(f.length / 2), r = new Float32Array(f.length / 2);
  for (let i = 0; i < l.length; i++) { l[i] = f[2 * i]; r[i] = f[2 * i + 1]; }
  return [l, r];
}
const mix = [new Float32Array(N), new Float32Array(N)];
function place(src, at, gain = 1, { fadeIn = 0.003, fadeOut = 0.003, env } = {}) {
  const start = Math.round(at * SR), n = src[0].length;
  for (let i = 0; i < n; i++) {
    const j = start + i;
    if (j < 0 || j >= N) continue;
    const t = i / SR;
    const g = gain * Math.min(1, t / fadeIn, (n / SR - t) / fadeOut) * (env ? env[j] : 1);
    mix[0][j] += src[0][i] * g; mix[1][j] += src[1][i] * g;
  }
}

// ---- The voice: each line gently compressed and brought to the same speech level; its onset (first sample
// within 30 dB of its peak) is what lands on the frame.
const LINE_RMS_DB = -20;
const voice = LINES.map((line) => {
  // a high-pass for the breath's rumble, a little air, then 4:1 so the whisper sits forward of the score
  const src = load(`pour-vo-${line.id}.mp3`, "highpass=f=75,equalizer=f=9000:t=q:w=1:g=2,acompressor=threshold=-26dB:ratio=4:attack=8:release=120:makeup=1");
  const mono = src[0];
  const hop = 48, win = 480;
  let peak = 0;
  const env = [];
  for (let i = 0; i + win < mono.length; i += hop) {
    let s = 0; for (let k = 0; k < win; k++) s += mono[i + k] ** 2;
    const v = Math.sqrt(s / win); env.push(v); peak = Math.max(peak, v);
  }
  const onset = (env.findIndex((v) => v > peak * db(-30)) * hop) / SR;
  const end = ((env.length - [...env].reverse().findIndex((v) => v > peak * db(-35))) * hop) / SR;
  let s = 0, n = 0;
  for (let i = Math.round(onset * SR); i < Math.round(end * SR); i++) { s += mono[i] ** 2; n++; }
  const rms = 20 * Math.log10(Math.sqrt(s / n));
  return { ...line, src, onset, end, gain: db(LINE_RMS_DB - rms) };
});

// ---- The score: stretched onto the grid; its bar 1 downbeat (0.034 s into the take, 66.43 BPM) lands on frame 0.
const STRETCH = 66.6667 / 66.43;
const score = load("pour-music.mp3", `atempo=${STRETCH.toFixed(6)}`);
// under each line the score dips 4 dB (150 ms ramps), so the whisper never has to be loud
const duck = new Float32Array(N).fill(1);
for (const v of voice) {
  const a = sec(v.at) - 0.15, b = sec(v.at) + (v.end - v.onset) + 0.25;
  for (let j = Math.max(0, Math.round((a - 0.15) * SR)); j < Math.min(N, Math.round((b + 0.15) * SR)); j++) {
    const t = j / SR;
    const k = t < a ? (t - (a - 0.15)) / 0.15 : t > b ? 1 - (t - b) / 0.15 : 1;
    duck[j] = Math.min(duck[j], 1 - (1 - db(-4)) * Math.max(0, Math.min(1, k)));
  }
}
place(score, -0.034 / STRETCH, db(-4), { fadeIn: 0.001, fadeOut: 0.05, env: duck });
for (const v of voice) place(v.src, sec(v.at) - v.onset, v.gain, { fadeIn: 0.002, fadeOut: 0.02 });

// ---- write, master, measure
writeFileSync(join(work, "pour-mix.wav"), wav(mix));
const loud = (file) => {
  const o = spawnSync(FFMPEG, ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const tail = o.slice(o.lastIndexOf("Summary:"));
  return { I: Number(tail.match(/I:\s+(-?[\d.]+) LUFS/)[1]), TP: Number(tail.match(/Peak:\s+(-?[\d.]+) dBFS/)[1]) };
};
const out = join(dir, "pour.wav");
const master = (g) =>
  ffmpeg("-i", join(work, "pour-mix.wav"), "-af", `volume=${g.toFixed(2)}dB,aresample=192000,alimiter=limit=-1.6dB:attack=0.5:release=40:level=false,aresample=48000`, "-c:a", "pcm_s24le", out);
const pre = loud(join(work, "pour-mix.wav"));
let gain = -14 - pre.I;
master(gain);
gain += -14 - loud(out).I;
master(gain);
console.log("pour.wav", { pre, gain: +gain.toFixed(2), final: loud(out), lines: voice.map((v) => ({ id: v.id, frame: v.at, onset: +v.onset.toFixed(3), gain: +(20 * Math.log10(v.gain)).toFixed(1) })) });

function wav([l, r]) {
  const buf = Buffer.alloc(44 + N * 8);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + N * 8, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(3, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 8, 28); buf.writeUInt16LE(8, 32); buf.writeUInt16LE(32, 34);
  buf.write("data", 36); buf.writeUInt32LE(N * 8, 40);
  for (let i = 0; i < N; i++) { buf.writeFloatLE(l[i], 44 + i * 8); buf.writeFloatLE(r[i], 48 + i * 8); }
  return buf;
}
