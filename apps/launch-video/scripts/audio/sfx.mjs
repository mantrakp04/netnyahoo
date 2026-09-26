// Foley for the spot (ElevenLabs sound effects, eleven_text_to_sound_v2). No whooshes, no risers.
// usage: node scripts/audio/sfx.mjs [ids…] → work/sfx/<id>-<n>.mp3
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { elevenBytes } from "./eleven.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const out = join(root, "work/sfx");
mkdirSync(out, { recursive: true });

export const SFX = {
  keys: { text: "Someone typing slowly on a MacBook laptop keyboard, soft individual key presses with gaps between them, close-miked, quiet room", duration_seconds: 3, prompt_influence: 0.7, takes: 2 },
  click: { text: "A single MacBook trackpad click, soft tactile click, close-miked, dry", duration_seconds: 0.5, prompt_influence: 0.8, takes: 3 },
  swipe: { text: "A soft two-finger swipe across a glass laptop trackpad, faint skin friction, very quiet, close-miked", duration_seconds: 0.6, prompt_influence: 0.7, takes: 2 },
};

const ids = process.argv.slice(2);
for (const [id, { takes, ...body }] of Object.entries(SFX)) {
  if (ids.length && !ids.includes(id)) continue;
  for (let n = 0; n < takes; n++) {
    const audio = await elevenBytes("/v1/sound-generation", { method: "POST", json: { ...body, model_id: "eleven_text_to_sound_v2" }, query: { output_format: "mp3_44100_192" } });
    writeFileSync(join(out, `${id}-${n}.mp3`), audio);
    console.log(id, n, audio.length);
  }
}
