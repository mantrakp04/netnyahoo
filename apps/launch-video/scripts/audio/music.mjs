// Generates the score's cues with Eleven Music (music_v2_5, instrumental).
// usage: node scripts/audio/music.mjs <name> → work/music/<name>.mp3 (+ .json with the request)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { elevenBytes } from "./eleven.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const out = join(root, "work/music");
mkdirSync(out, { recursive: true });

const NEG_V = ["vocals", "singing", "spoken word", "voice", "lyrics", "choir", "synthesizer", "electronic drums", "EDM", "ukulele", "whistling", "risers", "whooshes"];
const NEG = ["synthesizer", "electronic drums", "EDM", "trap", "lo-fi", "ukulele", "whistling", "vocals", "choir", "chiptune", "risers", "whooshes"];
export const CUES = {
  // The attack half: tense, not horror.
  attack: {
    composition_plan: {
      chunks: [
        {
          text: "[Intro]\nA tense cello section holds a low tremolo in the middle register.\nSparse, dissonant piano notes in the middle octave, far apart.\nA soft muted timpani pulse like a slow heartbeat. A thin, uneasy high violin harmonic above.",
          duration_ms: 8000,
          positive_styles: ["political attack ad underscore", "tense", "suspicious", "orchestral", "live string section", "cello tremolo", "sparse piano", "slow", "dry close-miked strings", "audible midrange"],
          negative_styles: [...NEG, "horror", "jump scare", "sub bass rumble", "melody", "big drums"],
          context_adherence: "high",
        },
      ],
    },
  },
  // The morning half: a hopeful American campaign score, played. Chunk `text` is sung as lyrics by
  // music_v2_5, so it holds only a section label and an {instrumental} cue; the direction is in the styles.
  morning: {
    composition_plan: {
      chunks: [
        { text: "[Intro]\n{instrumental}", duration_ms: 4500, positive_styles: ["instrumental", "American political campaign ad score", "hopeful", "warm major-key piano ostinato", "soft legato strings", "96 bpm", "sincere", "live orchestra"], negative_styles: NEG_V, context_adherence: "high" },
        { text: "[Verse]\n{instrumental}", duration_ms: 9000, positive_styles: ["instrumental", "light snare march", "pizzicato bass", "noble French horn melody", "piano ostinato", "building", "live strings with bow noise"], negative_styles: NEG_V, context_adherence: "high" },
        { text: "[Climax]\n{instrumental}", duration_ms: 4000, positive_styles: ["instrumental", "full brass and strings swell", "timpani roll", "resolving on a big major chord", "triumphant"], negative_styles: NEG_V, context_adherence: "high" },
        { text: "[Outro]\n{instrumental}", duration_ms: 3500, positive_styles: ["instrumental", "one sustained held major chord", "strings and horns ringing", "slow decay to silence"], negative_styles: [...NEG_V, "drums", "new melody", "staccato hits"], context_adherence: "high" },
      ],
    },
  },
  // The same, as a prompt (force_instrumental guarantees no voice).
  morningPrompt: {
    prompt:
      "Instrumental American political campaign TV ad score, 96 BPM, major key, played by a live orchestra. " +
      "0-4.5 s: a warm, hopeful piano ostinato with soft legato strings. 4.5 s: a light snare march and pizzicato bass enter " +
      "under a noble French horn melody, building steadily. 17 s: full brass and strings swell with a timpani roll and land on " +
      "one big major chord, held by strings and horns and slowly decaying to silence by 21 s. Sincere, not cheesy. No vocals.",
    music_length_ms: 21000,
    force_instrumental: true,
  },
};

const [name, cue = name] = process.argv.slice(2);
const body = { ...CUES[cue], model_id: "music_v2_5" };
const audio = await elevenBytes("/v1/music", { method: "POST", json: body, query: { output_format: "mp3_48000_320" } });
writeFileSync(join(out, `${name}.mp3`), audio);
writeFileSync(join(out, `${name}.json`), JSON.stringify(body, null, 1));
console.log(name, audio.length, "bytes");
