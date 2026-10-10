#!/bin/zsh
# Generates one raw image with the Codex CLI's built-in image tool.
#   gen.sh <name> <raw-dir> [extra-reference-image…]
# Reads prompts/<name>.txt and writes <raw-dir>/<name>.png. Every image gets the Arcadia logo
# painting (docs/brand/arcadia/source/mark.png) as its style reference; extra references follow it.
# Generate the lamb first, then hand it to the sheets that must match it:
#   gen.sh lamb raw
#   gen.sh decoys raw raw/lamb.png
#   gen.sh notice raw raw/lamb.png
#   for n in sheet1 sheet2 sheet3 sheet4 sheet5 bg-meadow bg-orchard bg-sunset bg-fair; do gen.sh $n raw & done; wait
# CODEX overrides the CLI (default: the one bundled with ChatGPT.app; Homebrew's rejects the model).
set -eu
name=$1
raw=${2:A}
here=${0:A:h}
codex=${CODEX:-/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex}
refs=($here/../../../../docs/brand/arcadia/source/mark.png(:A) ${@[3,-1]:A})
mkdir -p $raw
prompt=$(<$here/prompts/$name.txt)
# stdin must be /dev/null or codex waits on it; -i takes several files, so it comes after the prompt.
timeout 1500 $codex exec -m gpt-6.1-sol -c model_reasoning_effort='"high"' -c service_tier='"priority"' \
  -s workspace-write --skip-git-repo-check -C $raw \
  "Use your built-in image generation tool to create exactly ONE image from the description below, then copy the generated PNG file unchanged to $raw/$name.png. Do not write code to draw or edit the image. The first attached image is the style reference. Description: $prompt" \
  -i $refs < /dev/null
