// usage: node scripts/mux-audio.mjs [name=netnyahoo-launch] [track=track.wav] → output/launch-video/<name>.mp4
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const out = join(root, "../../output/launch-video");
const [name = "netnyahoo-launch", track = "track.wav"] = process.argv.slice(2);
const master = join(out, `${name}.master.mp4`);
const video = join(out, `${name}.mp4`);
execFileSync("/opt/homebrew/bin/ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", master, "-i", join(root, "public/sound", track),
  "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-tune", "grain", "-maxrate", "16M", "-bufsize", "32M",
  "-pix_fmt", "yuv420p", "-profile:v", "high", "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-shortest", "-movflags", "+faststart", video]);
rmSync(master);
console.log("wrote", video);
