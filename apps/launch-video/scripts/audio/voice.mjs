// The whispered voice for "Pour" (ElevenLabs eleven_v3). Each line is its own request, several takes each;
// takes are compared with transcribe.mjs (words) and by length against the slot the line has on the grid.
// usage: node scripts/audio/voice.mjs [ids…] → work/voice/<id>-<n>.mp3
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { elevenBytes } from "./eleven.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const out = join(root, "work/voice");
mkdirSync(out, { recursive: true });

// "Casanova" from the ElevenLabs voice library: deep, hushed and breathy, close to the ear.
export const VOICE = "IM2NskAf9RDJ9aOlvoTu";

export const LINES = {
  name: "[whispers] Netnyahoo.",
  finishes: "[whispers] It finishes... what you start.",
  between: "[whispers] Nothing between you.",
  protection: "[whispers] Protection. Always on.",
  discreet: "[whispers] Discreet.",
  strings: "[whispers] No strings attached.",
  immunity: "[whispers] Full immunity.",
};

const TAKES = 4;
const ids = process.argv.slice(2);
await Promise.all(
  Object.entries(LINES)
    .filter(([id]) => !ids.length || ids.includes(id))
    .map(async ([id, text]) => {
      for (let n = 0; n < TAKES; n++) {
        const audio = await elevenBytes(`/v1/text-to-speech/${VOICE}`, {
          method: "POST",
          query: { output_format: "mp3_44100_192" },
          // Natural (0.5) for the first takes, Creative (0) for the rest: more breath, less even.
          json: { text, model_id: "eleven_v3", voice_settings: { stability: n < 2 ? 0.5 : 0, similarity_boost: 0.8 } },
        });
        writeFileSync(join(out, `${id}-${n}.mp3`), audio);
        console.log(id, n, audio.length);
      }
    }),
);
