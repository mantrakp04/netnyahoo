#!/bin/zsh
# Generates one raw image with the Codex CLI's built-in image tool.
#   gen.sh <name> <raw-dir> [reference-image]
# Reads prompts/<name>.txt and writes <raw-dir>/<name>.png.
# The Big Yahu sheet uses the brand mascot as its reference:
#   gen.sh yahu raw ~/Documents/netnyahoo/output/grotesque-brand/06-mascot.png
# (the -i flag takes several files, so it must come after the prompt.)
set -eu
name=$1
raw=${2:A}
ref=${3:-}
here=${0:A:h}
mkdir -p $raw
prompt=$(<$here/prompts/$name.txt)
args=()
[[ -n $ref ]] && args=(-i $ref)
codex exec -s danger-full-access --skip-git-repo-check -C $raw \
  "Use your built-in image generation tool to create exactly ONE image from the description below, then copy the generated PNG file unchanged to $raw/$name.png. Do not write code to draw or edit the image. Description: $prompt" $args
