// Builds public/sound/track.wav, the spot's soundtrack, from the parts in assets/sound (all ElevenLabs:
// the designed narrator voice on eleven_v3, Eleven Music v2.5 cues, text-to-sound-effects foley; see README
// "Sound"), timed to src/timeline.ts.
//  1. Each part is decoded to 48 kHz stereo float; the narrator is cleaned up (high-pass, 4:1 compression,
//     a little presence).
//  2. The mix happens here, sample by sample: the score ducks under the voice (an envelope follower on the
//     voice), drops out under "cleared of all charges" and comes back on the portrait's chord; the foley lands
//     on the frames its actions complete on.
//  3. Master: a static gain to -14 LUFS integrated, then a 4x-oversampled limiter under -1 dBTP.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CUES, FPS, SHOTS, TOTAL } from "../src/timeline.ts";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const parts = join(root, "assets/sound");
const dir = join(root, "public/sound");
const work = join(dir, "work");
mkdirSync(work, { recursive: true });
const ffmpeg = (...args) => execFileSync("/opt/homebrew/bin/ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { maxBuffer: 1 << 30 });
const SR = 48000;
const N = Math.round((TOTAL / FPS) * SR);
const db = (x) => Math.pow(10, x / 20);

/** A part as [left, right] Float32Arrays at 48 kHz (optionally through an ffmpeg filter). */
function load(name, filter) {
  const raw = ffmpeg("-i", join(parts, name), ...(filter ? ["-af", filter] : []), "-f", "f32le", "-ac", "2", "-ar", String(SR), "pipe:1");
  const f = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const l = new Float32Array(f.length / 2), r = new Float32Array(f.length / 2);
  for (let i = 0; i < l.length; i++) { l[i] = f[2 * i]; r[i] = f[2 * i + 1]; }
  return [l, r];
}
const slice = ([l, r], from, to) => [l.subarray(Math.round(from * SR), Math.round(to * SR)), r.subarray(Math.round(from * SR), Math.round(to * SR))];

const bus = () => [new Float32Array(N), new Float32Array(N)];
/** Adds `src` into `dst` at `at` seconds, times `gain` (a number or a function of the output time). */
function place(dst, src, at, gain = 1, { fadeIn = 0.004, fadeOut = 0.004 } = {}) {
  const start = Math.round(at * SR);
  const n = src[0].length;
  for (let i = 0; i < n; i++) {
    const j = start + i;
    if (j < 0 || j >= N) continue;
    const t = i / SR;
    const env = Math.min(1, t / fadeIn, (n / SR - t) / fadeOut);
    const g = (typeof gain === "function" ? gain(j / SR) : gain) * env;
    dst[0][j] += src[0][i] * g;
    dst[1][j] += src[1][i] * g;
  }
}

// ---- parts
const VO_FILTER = "highpass=f=75,equalizer=f=220:t=q:w=1:g=-1.5,equalizer=f=3200:t=q:w=1.2:g=2,acompressor=threshold=-24dB:ratio=4:attack=6:release=90:makeup=2";
// The disclaimer is read fast, like every real one.
const vo = Object.fromEntries(Object.keys(CUES.vo).map((k) => [k, load(`vo-${k}.mp3`, k === "disclaimer" ? `atempo=1.12,${VO_FILTER}` : VO_FILTER)]));
// The attack cue opens on one hard hit and then sits very low: compressed so the drone stays present.
const attack = load("music-attack.mp3", "acompressor=threshold=-36dB:ratio=4:attack=30:release=400:makeup=8");
const morning = load("music-morning.mp3");
const projector = load("sfx-projector.mp3");
const room = load("sfx-room.mp3");
const tally = slice(load("sfx-tally.mp3"), 0, 0.07);
const stamp = load("sfx-stamp.mp3");
const click = load("sfx-click.mp3");
const swipe = load("sfx-swipe.mp3");
const keysAll = load("sfx-keys.mp3");
const KEY_ONSETS = [0.17, 0.369, 0.429, 0.708, 0.778, 1.242, 1.522, 1.776, 1.886];
const keys = KEY_ONSETS.map((t) => slice(keysAll, t - 0.005, t + 0.055));

// ---- voice bus, and the envelope the score ducks under
const voice = bus();
for (const [k, at] of Object.entries(CUES.vo)) place(voice, vo[k], at, db(4.5));
const env = new Float32Array(N);
{
  const att = Math.exp(-1 / (0.03 * SR)), rel = Math.exp(-1 / (0.35 * SR));
  let e = 0;
  for (let i = 0; i < N; i++) {
    const x = Math.max(Math.abs(voice[0][i]), Math.abs(voice[1][i]));
    e = x > e ? att * e + (1 - att) * x : rel * e + (1 - rel) * x;
    env[i] = e;
  }
}
const duck = (t, depth) => {
  const e = env[Math.min(N - 1, Math.max(0, Math.round(t * SR)))];
  return db(-depth * Math.min(1, e / 0.08));
};
const ramp = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));

// ---- score
const score = bus();
const [fo0, fo1] = CUES.music.attackFadeOut;
place(score, attack, CUES.music.attack, (t) => db(-2) * (1 - ramp(t, fo0, fo1)) * duck(t, 3), { fadeIn: 0.02 });
const turn = CUES.music.morning;
const clearedFrom = CUES.vo.cleared - 0.15;
const chord = SHOTS.portrait[0] / FPS;
place(
  score,
  morning,
  turn,
  (t) => {
    // subtractive: the score steps back under "Investigated by Apple… cleared of all charges"
    // and returns on the portrait's chord
    const dip = t >= clearedFrom && t < chord - 0.04 ? db(-9) * (1 - ramp(t, clearedFrom, clearedFrom + 0.3)) + db(-17) * ramp(t, clearedFrom, clearedFrom + 0.3) : 1;
    return db(-2) * dip * duck(t, 5);
  },
  { fadeIn: 0.003, fadeOut: 0.3 },
);

// ---- foley
const fx = bus();
const endFrom = SHOTS.end[0] / FPS;
// the archive's projector under the black-and-white parts (cut on the turn; back for the end card)
place(fx, projector, 0, db(-3), { fadeIn: 0.02, fadeOut: 0.01 });
fx[0].fill(0, Math.round(turn * SR)); fx[1].fill(0, Math.round(turn * SR));
place(fx, slice(projector, 0, TOTAL / FPS - endFrom), endFrom, (t) => db(-3) * ramp(t, endFrom, endFrom + 0.25));
const { from, to, count } = CUES.tally;
for (let i = 1; i <= count; i++) {
  // the same schedule as the on-screen counter (outCubic): tick i lands when the count reaches i
  const k = 1 - Math.cbrt(1 - i / count);
  place(fx, tally, from + k * (to - from) - 0.023, db(-8 + (i % 3) * -1.5));
}
for (const s of CUES.stamps) place(fx, stamp, s - 0.023, db(-2));
const addr = SHOTS.addr[0];
place(fx, click, (addr + CUES.addrOpen) / FPS - 0.07, db(-6));
CUES.addrLetters.forEach((f, i) => place(fx, keys[i], (addr + f) / FPS - 0.005, db(-4 + (i % 2) * -2)));
place(fx, swipe, (SHOTS.swipe[0] + CUES.swipeStart) / FPS - 0.046, db(-4));
place(fx, click, (SHOTS.store[0] + CUES.storePress) / FPS - 0.07, db(-4));
// room tone under everything, so the voice never sits in digital silence
place(fx, room, 0, db(6), { fadeIn: 0.01, fadeOut: 0.01 });
place(fx, room, 10, db(6), { fadeIn: 0.05, fadeOut: 0.05 });
place(fx, room, 20, db(6), { fadeIn: 0.05, fadeOut: 0.01 });
place(fx, slice(room, 0, 1.2), 30, db(6), { fadeIn: 0.05, fadeOut: 0.01 });

// ---- mix, write, master
const mix = bus();
for (const b of [voice, score, fx]) for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) mix[c][i] += b[c][i];
const stems = { voice, score, fx, mix };
for (const [name, b] of Object.entries(stems)) writeFileSync(join(work, `${name}.wav`), wav(b));

// Master: a static gain to -14 LUFS, then a limiter (4x oversampled) under -1 dBTP; measured again and nudged
// once so the limiter's cost in loudness is put back.
const loud = (file) => {
  const out = spawnSync("/opt/homebrew/bin/ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const tail = out.slice(out.lastIndexOf("Summary:"));
  return { I: Number(tail.match(/I:\s+(-?[\d.]+) LUFS/)[1]), TP: Number(tail.match(/Peak:\s+(-?[\d.]+) dBFS/)[1]) };
};
const master = (gain) =>
  ffmpeg("-i", join(work, "mix.wav"), "-af", `volume=${gain.toFixed(2)}dB,aresample=192000,alimiter=limit=-1.6dB:attack=0.5:release=40:level=false,aresample=48000`, "-c:a", "pcm_s24le", join(dir, "track.wav"));
const pre = loud(join(work, "mix.wav"));
let gain = -14 - pre.I;
master(gain);
let got = loud(join(dir, "track.wav"));
gain += -14 - got.I;
master(gain);
got = loud(join(dir, "track.wav"));
console.log("track.wav", { pre, gain: +gain.toFixed(2), final: got });

function wav([l, r]) {
  const buf = Buffer.alloc(44 + N * 8);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + N * 8, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(3, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 8, 28); buf.writeUInt16LE(8, 32); buf.writeUInt16LE(32, 34);
  buf.write("data", 36); buf.writeUInt32LE(N * 8, 40);
  for (let i = 0; i < N; i++) { buf.writeFloatLE(l[i], 44 + i * 8); buf.writeFloatLE(r[i], 48 + i * 8); }
  return buf;
}
