#!/bin/bash
# Renders a cut and puts the score back on it sample-accurately: Remotion's AAC carries the encoder's priming
# (2048 samples) without an edit list, so every hit would land 43 ms late. The video is kept; the audio is
# re-encoded from the WAV by ffmpeg, whose mp4 muxer writes the edit list that trims the priming.
# usage: scripts/deliver.sh <composition id>   (→ out/<id>.mp4, then scripts/check-sync.py must report 0)
set -euo pipefail
V=$(cd "$(dirname "$0")/.." && pwd); cd "$V"
id=$1; cut=${id%%-*}
pnpm exec remotion render src/index.ts "$id" "out/$id.render.mp4" --concurrency=6 --log=error
ffmpeg -v error -y -i "out/$id.render.mp4" -i "public/music/$cut.wav" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 320k \
  -movflags +faststart "out/$id.mp4"
rm "out/$id.render.mp4"
python3 scripts/check-sync.py "out/$id.mp4" "public/music/$cut.wav"
