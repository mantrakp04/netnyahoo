// Puts the soundtrack on the rendered video with ffmpeg (Remotion's own mux starts the audio with a few
// milliseconds of silence, which would click at every loop). Also writes the narrator preview when
// public/sound/track-vo.wav exists (VO_VOICE=… SOUND_OUT=track-vo.wav node scripts/make-sound.mjs).
import { execFileSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const out = join(root, "../../output/launch-video");
const video = join(out, "netnyahoo-launch.mp4");
const mux = (audio, dest) =>
  execFileSync("/opt/homebrew/bin/ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", video, "-i", audio,
    "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", dest]);
const tmp = join(out, "netnyahoo-launch.muxed.mp4");
mux(join(root, "public/sound/track.wav"), tmp);
renameSync(tmp, video);
const vo = join(root, "public/sound/track-vo.wav");
if (existsSync(vo)) mux(vo, join(out, "netnyahoo-launch-vo-preview.mp4"));
console.log("muxed", video);
