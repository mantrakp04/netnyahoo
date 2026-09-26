// Puts the soundtrack (public/sound/track.wav, scripts/make-sound.mjs) on the rendered picture and encodes
// the upload: H.264 High (x264 tuned for grain, CRF 18, capped at 16 Mb/s; the black-and-white half's grain
// is new every frame), AAC 256 kb/s from frame 0 so the loop doesn't click.
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const out = join(root, "../../output/launch-video");
const master = join(out, "netnyahoo-launch.master.mp4");
const video = join(out, "netnyahoo-launch.mp4");
execFileSync("/opt/homebrew/bin/ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", master, "-i", join(root, "public/sound/track.wav"),
  "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-tune", "grain", "-maxrate", "16M", "-bufsize", "32M",
  "-pix_fmt", "yuv420p", "-profile:v", "high", "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-shortest", "-movflags", "+faststart", video]);
rmSync(master);
console.log("wrote", video);
