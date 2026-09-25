// Builds public/sound/track.wav, the video's soundtrack, timed to src/timeline.ts:
//  1. the score and effects (scripts/sound/score.js), synthesized with WebAudio in headless Chromium;
//  2. the campaign narrator, macOS `say` with the voice in $VO_VOICE (off when unset), shaped with
//     ffmpeg (EQ, compression, a little room), placed on the beats below;
//  3. the mix: the music ducks under the voice, then a static gain to -14 LUFS and a -1 dBTP limiter.
// Everything is generated locally; nothing is downloaded.
//
//   node scripts/make-sound.mjs                  # music and effects
//   VO_VOICE="Evan (Enhanced)" node scripts/make-sound.mjs   # with the narrator
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { B, FPS, TOTAL } from "../src/timeline.ts";
import { launch } from "./headless.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const dir = join(root, "public/sound");
const work = join(dir, "work");
mkdirSync(work, { recursive: true });
const ffmpeg = (...args) => execFileSync("/opt/homebrew/bin/ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
const SR = 48000;
const secs = TOTAL / FPS;

// ---- 1. score
const b = await launch(9401);
// The first OfflineAudioContext in a fresh page can stall; warm one up.
await b.evaluate(`(async () => { const c = new OfflineAudioContext(1, 4800, 48000); await c.startRendering(); return 1; })()`);
const score = readFileSync(join(root, "scripts/sound/score.js"), "utf8");
await b.evaluate(`(async () => {
  ${score}
  window.__score = await renderScore(${JSON.stringify(B)}, ${TOTAL}, ${FPS}, ${SR});
  return 1;
})()`);
// PCM16, interleaved, base64 (normalized so the synth's peaks can't clip).
const pcmLength = await b.evaluate(`(() => {
  const [l, r] = window.__score;
  const out = new Int16Array(l.length * 2);
  let peak = 0;
  for (let i = 0; i < l.length; i++) peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
  const k = peak > 0.98 ? 0.98 / peak : 1;
  for (let i = 0; i < l.length; i++) { out[2 * i] = l[i] * k * 32767; out[2 * i + 1] = r[i] * k * 32767; }
  let s = ""; const u8 = new Uint8Array(out.buffer);
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  window.__pcm = btoa(s);
  return window.__pcm.length;
})()`);
// Fetched in pieces: one multi-megabyte CDP reply stalls.
let pcm = "";
for (let i = 0; i < pcmLength; i += 400_000) pcm += await b.evaluate(`window.__pcm.slice(${i}, ${i + 400_000})`);
b.close();
setTimeout(() => {}, 0);
writeFileSync(join(work, "score.wav"), wav(Buffer.from(pcm, "base64"), 2, SR));

// ---- 2. the narrator: [frame, line, words per minute]
const VOICE = process.env.VO_VOICE;
const LINES = [
  [B.opener.from + 4, "Full immunity.", 175],
  [B.toolbar.from + 6, "Dissolves the toolbar.", 190],
  [B.pledges.from + 120 + 2, "Tracks nothing. Unusual, for a man in his position.", 245],
  [B.offline.from + 6, "Chrome gives you a dinosaur.", 200],
  [B.find.from + 2, "Netnyahoo gives you him.", 195],
  [B.cta.from + 9, "Impeach Chrome.", 165],
  [B.cta.from + 44, "Paid for by nobody. Not authorized by any candidate.", 300],
];
let inputs = [join(work, "score.wav")];
if (VOICE) {
  const parts = [];
  LINES.forEach(([frame, text, rate], i) => {
    const aiff = join(work, `vo${i}.aiff`);
    execFileSync("say", ["-v", VOICE, "-r", String(rate), "-o", aiff, text]);
    // Disclaimer: quieter and thinner, like the small print it is.
    const small = i === LINES.length - 1;
    const f = join(work, `vo${i}.wav`);
    ffmpeg("-i", aiff, "-af", [
      "aresample=48000", "highpass=f=90", "equalizer=f=180:t=q:w=1:g=2.5", "equalizer=f=3200:t=q:w=1.2:g=3",
      "acompressor=threshold=-20dB:ratio=4:attack=5:release=80:makeup=4", small ? "volume=-7dB,highpass=f=260" : "anull",
      "aecho=0.8:0.5:22|37:0.18|0.1", `adelay=${Math.round((frame / FPS) * 1000)}|${Math.round((frame / FPS) * 1000)}`, "apad",
    ].join(","), "-ac", "2", "-t", String(secs), f);
    parts.push(f);
  });
  const vo = join(work, "vo.wav");
  ffmpeg(...parts.flatMap((p) => ["-i", p]), "-filter_complex", `${parts.map((_, i) => `[${i}]`).join("")}amix=inputs=${parts.length}:normalize=0`, "-t", String(secs), vo);
  inputs.push(vo);
}

// ---- 3. mix: duck under the voice, then loudness
const premix = join(work, "premix.wav");
if (inputs.length === 2) {
  ffmpeg("-i", inputs[0], "-i", inputs[1], "-filter_complex",
    "[1]asplit=2[vo][key];[0][key]sidechaincompress=threshold=0.03:ratio=6:attack=15:release=250:makeup=1[duck];[duck][vo]amix=inputs=2:normalize=0:weights=1 1.6",
    "-t", String(secs), premix);
} else ffmpeg("-i", inputs[0], "-t", String(secs), premix);
const lufsOf = (f) =>
  parseFloat(execFileSync("sh", ["-c", `/opt/homebrew/bin/ffmpeg -hide_banner -i "${f}" -af ebur128 -f null - 2>&1 | grep -A1 "Integrated loudness" | tail -1`]).toString().match(/I:\s*(-?[\d.]+)/)[1]);
const out = join(dir, process.env.SOUND_OUT ?? "track.wav");
// Gain to -14 LUFS, then a -1 dBTP-ish limiter; the limiter shaves a little, so correct once.
const lufs = lufsOf(premix);
let gain = -14 - lufs;
const master = (g) => ffmpeg("-i", premix, "-af", `volume=${g.toFixed(2)}dB,alimiter=limit=0.8:attack=3:release=60:level=false:latency=true`, "-ar", String(SR), out);
master(gain);
gain += -14 - lufsOf(out);
master(gain);
console.log(`sound: ${secs.toFixed(2)} s, premix ${lufs} LUFS, gain ${gain.toFixed(2)} dB, voice ${VOICE ?? "none"}`);

function wav(data, channels, rate) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * channels * 2, 28);
  h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
