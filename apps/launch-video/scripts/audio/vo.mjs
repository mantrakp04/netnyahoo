// The narrator's lines, several takes each (the designed voice, see README "Sound").
// usage: node scripts/audio/vo.mjs [takes] [line ids…] → work/vo/<line>-<model>-<n>.mp3
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { elevenBytes } from "./eleven.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const out = join(root, "work/vo");
mkdirSync(out, { recursive: true });
export const VOICE = "jAduNcO9CPoyyp6ZZYbw"; // "Netnyahoo Narrator" (voice design, eleven_ttv_v3)

// id → text. v3 reads ellipses as pauses and [tags] as direction; v2 gets the plain text.
export const LINES = {
  privacy: "[serious] They said your privacy was important to them.",
  forecast: "[serious] Then one weather forecast... called twenty-two ad companies.",
  since: "[serious] Same browser. Since two thousand eight.",
  immunity: "Netnyahoo. Full immunity.",
  cleared: "Investigated by Apple... cleared of all charges.",
  impeach: "Impeach Chrome.",
  disclaimer: "[quickly] Paid for by nobody. Not authorized by any candidate.",
};
const plain = (t) => t.replace(/\[[^\]]+\]\s*/g, "");

const MODELS = {
  v3: { model_id: "eleven_v3", voice_settings: { stability: 0.5, similarity_boost: 0.8, use_speaker_boost: true } },
  v2: { model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.62, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true } },
};

const [takesArg, ...ids] = process.argv.slice(2);
const takes = Number(takesArg ?? 3);
for (const id of ids.length ? ids : Object.keys(LINES)) {
  for (const [m, cfg] of Object.entries(MODELS)) {
    for (let n = 0; n < takes; n++) {
      const text = m === "v3" ? LINES[id] : plain(LINES[id]);
      const speed = id === "disclaimer" && m === "v2" ? 1.15 : undefined;
      const body = { text, ...cfg, voice_settings: { ...cfg.voice_settings, ...(speed ? { speed } : {}) }, seed: 1000 + n * 17 };
      const audio = await elevenBytes(`/v1/text-to-speech/${VOICE}`, { method: "POST", json: body, query: { output_format: "mp3_44100_192" } });
      writeFileSync(join(out, `${id}-${m}-${n}.mp3`), audio);
      console.log(id, m, n, audio.length);
    }
  }
}
