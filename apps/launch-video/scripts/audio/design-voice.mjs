// Voice design: previews of a deadpan American political-ad narrator (eleven_ttv_v3).
// usage: node scripts/audio/design-voice.mjs <tag> "<description>" → work/voice/<tag>-<n>.mp3 + .json
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { elevenJson } from "./eleven.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const out = join(root, "work/voice");
mkdirSync(out, { recursive: true });
const [tag, description] = process.argv.slice(2);
const text =
  "They said your privacy was important to them. Then one weather forecast talked to fifty-three other companies. " +
  "Netnyahoo. Full immunity. Investigated by Apple... cleared of all charges. Impeach Chrome. " +
  "Paid for by nobody. Not authorized by any candidate.";
const r = await elevenJson("/v1/text-to-voice/design", {
  method: "POST",
  json: { voice_description: description, model_id: "eleven_ttv_v3", text, loudness: 0.5, guidance_scale: 5 },
});
r.previews.forEach((p, i) => {
  writeFileSync(join(out, `${tag}-${i}.mp3`), Buffer.from(p.audio_base_64, "base64"));
  writeFileSync(join(out, `${tag}-${i}.json`), JSON.stringify({ generated_voice_id: p.generated_voice_id, duration: p.duration_secs, description }));
  console.log(`${tag}-${i}`, p.generated_voice_id, p.duration_secs);
});
