// usage: node scripts/audio/music.mjs <name> → work/music/<name>.mp3 (+ .json with the request)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { elevenBytes } from "./eleven.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const out = join(root, "work/music");
mkdirSync(out, { recursive: true });

export const CUES = {
  film: {
    prompt:
      "Instrumental cinematic score for a premium Apple-style product film, exactly 72 BPM in 4/4, major key, warm and understated, " +
      "played by real musicians. Bars 1-2 (0-6.7 s): a soft felt piano motif in quarter notes over a low sustained cello note. " +
      "Bars 3-5 (6.7-16.7 s): a gentle pulse enters (muted low piano and soft kick on beats 1 and 3), legato strings join. " +
      "Bars 6-7 (16.7-23.3 s): the full string section and a soft brass pad lift the theme, a little brighter. " +
      "Bar 8 (23.3-26.7 s): everything drops to the piano alone, holding one long chord. " +
      "Bar 9 (26.7-30 s): a single deep, warm final hit on the downbeat, then the chord rings and decays to silence. " +
      "Elegant, confident, spacious, no drums fills, no risers, no vocals.",
    music_length_ms: 30000,
    force_instrumental: true,
  },
  pour: {
    prompt:
      "Instrumental score for a luxury perfume commercial, exactly 67 BPM in 4/4, minor key, sultry, slow and intimate, " +
      "trip-hop and slow R&B, played by real musicians, lots of space. " +
      "Bars 1-2 (0-7 s): a deep warm sub-bass note swells in under a breathy analog pad; a soft brushed kick on beat 1 and a " +
      "dry rimshot on beat 3; nothing else. " +
      "Bar 3 (7-11 s): a slow Rhodes electric piano chord on each downbeat and a tremolo guitar note, the pulse continues. " +
      "Bar 4 (11-14 s): one deep low hit on the downbeat, then everything drops out except the pad, near silence. " +
      "Bars 5-7 (14-25 s): the groove returns, a slow heavy trip-hop beat, a round deep bass line, muted guitar, the Rhodes, " +
      "sensual and restrained. " +
      "Bar 8 (25-29 s): the drums stop; bass and pad only, holding. " +
      "Bar 9 (29-32 s): a single deep final hit on the downbeat, then the chord rings and decays to silence. " +
      "Sensual, expensive, minimal, no risers, no cymbal crashes, no vocals.",
    music_length_ms: 32500,
    force_instrumental: true,
  },
};

const [name, cue = "film"] = process.argv.slice(2);
const body = { ...CUES[cue], model_id: "music_v2_5" };
const audio = await elevenBytes("/v1/music", { method: "POST", json: body, query: { output_format: "mp3_48000_320" } });
writeFileSync(join(out, `${name}.mp3`), audio);
writeFileSync(join(out, `${name}.json`), JSON.stringify(body, null, 1));
console.log(name, audio.length, "bytes");
