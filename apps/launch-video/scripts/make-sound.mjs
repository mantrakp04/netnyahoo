// Builds public/sound/track.wav for the film: the score (Eleven Music v2.5, instrumental, 72 BPM; assets/sound/
// music-film.mp3) under sparse foley on the real interactions (ElevenLabs sound effects), timed to src/timeline.ts.
// No narrator. Master: a static gain to -14 LUFS integrated, then a 4x-oversampled limiter under -1 dBTP.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EV, FPS, TOTAL } from "../src/timeline.ts";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const parts = join(root, "assets/sound");
const dir = join(root, "public/sound");
const work = join(dir, "work");
mkdirSync(work, { recursive: true });
const ffmpeg = (...args) => execFileSync("/opt/homebrew/bin/ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { maxBuffer: 1 << 30 });
const SR = 48000;
const N = Math.round((TOTAL / FPS) * SR);
const db = (x) => Math.pow(10, x / 20);

function load(name, filter) {
  const raw = ffmpeg("-i", join(parts, name), ...(filter ? ["-af", filter] : []), "-f", "f32le", "-ac", "2", "-ar", String(SR), "pipe:1");
  const f = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const l = new Float32Array(f.length / 2), r = new Float32Array(f.length / 2);
  for (let i = 0; i < l.length; i++) { l[i] = f[2 * i]; r[i] = f[2 * i + 1]; }
  return [l, r];
}
const slice = ([l, r], a, b) => [l.subarray(Math.round(a * SR), Math.round(b * SR)), r.subarray(Math.round(a * SR), Math.round(b * SR))];
const mix = [new Float32Array(N), new Float32Array(N)];
function place(src, at, gain = 1, { fadeIn = 0.003, fadeOut = 0.003 } = {}) {
  const start = Math.round(at * SR), n = src[0].length;
  for (let i = 0; i < n; i++) {
    const j = start + i;
    if (j < 0 || j >= N) continue;
    const t = i / SR;
    const g = gain * Math.min(1, t / fadeIn, (n / SR - t) / fadeOut);
    mix[0][j] += src[0][i] * g; mix[1][j] += src[1][i] * g;
  }
}
const sec = (frame) => frame / FPS;

// The score: its bar hits sound 30 ms after the bar line; placed 30 ms early so they land on the frames.
place(load("music-film.mp3"), -0.03, 1, { fadeIn: 0.001, fadeOut: 0.05 });

// Foley, quiet, only where something is touched.
const keysAll = load("sfx-keys.mp3");
const KEY_ONSETS = [0.17, 0.369, 0.429, 0.708, 0.778, 1.242, 1.522, 1.776, 1.886];
const click = load("sfx-click.mp3");
const swipe = load("sfx-swipe.mp3");
place(click, sec(EV.addrOpen) - 0.07, db(-12));
EV.addrLetters.forEach((f, i) => place(slice(keysAll, KEY_ONSETS[i] - 0.005, KEY_ONSETS[i] + 0.055), sec(f) - 0.005, db(-10 - (i % 2) * 2)));
place(swipe, sec(EV.swipeStart) - 0.046, db(-8));
place(click, sec(EV.storePress) - 0.07, db(-9));
place(click, sec(EV.repoClick) - 0.07, db(-12));

// write, master, measure
writeFileSync(join(work, "mix.wav"), wav(mix));
const loud = (file) => {
  const o = spawnSync("/opt/homebrew/bin/ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const tail = o.slice(o.lastIndexOf("Summary:"));
  return { I: Number(tail.match(/I:\s+(-?[\d.]+) LUFS/)[1]), TP: Number(tail.match(/Peak:\s+(-?[\d.]+) dBFS/)[1]) };
};
const master = (g) =>
  ffmpeg("-i", join(work, "mix.wav"), "-af", `volume=${g.toFixed(2)}dB,aresample=192000,alimiter=limit=-1.6dB:attack=0.5:release=40:level=false,aresample=48000`, "-c:a", "pcm_s24le", join(dir, "track.wav"));
const pre = loud(join(work, "mix.wav"));
let gain = -14 - pre.I;
master(gain);
gain += -14 - loud(join(dir, "track.wav")).I;
master(gain);
console.log("track.wav", { pre, gain: +gain.toFixed(2), final: loud(join(dir, "track.wav")) });

function wav([l, r]) {
  const buf = Buffer.alloc(44 + N * 8);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + N * 8, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(3, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 8, 28); buf.writeUInt16LE(8, 32); buf.writeUInt16LE(32, 34);
  buf.write("data", 36); buf.writeUInt32LE(N * 8, 40);
  for (let i = 0; i < N; i++) { buf.writeFloatLE(l[i], 44 + i * 8); buf.writeFloatLE(r[i], 48 + i * 8); }
  return buf;
}
