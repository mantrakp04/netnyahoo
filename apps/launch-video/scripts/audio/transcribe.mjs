// Word-level transcription (Scribe v2) of an audio file: checks a take's words and gives their timing.
// usage: node scripts/audio/transcribe.mjs <file> [out.json]
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { elevenJson } from "./eleven.mjs";

const [file, out] = process.argv.slice(2);
const form = new FormData();
form.set("model_id", "scribe_v2");
form.set("timestamps_granularity", "word");
form.set("tag_audio_events", "false");
form.set("file", new Blob([readFileSync(file)]), basename(file));
const r = await elevenJson("/v1/speech-to-text", { method: "POST", form });
const words = r.words.filter((w) => w.type === "word").map((w) => ({ text: w.text, start: w.start, end: w.end }));
if (out) writeFileSync(out, JSON.stringify({ text: r.text, words }, null, 1));
console.log(r.text);
