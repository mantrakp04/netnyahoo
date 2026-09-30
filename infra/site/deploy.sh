#!/usr/bin/env bash
# Builds netnyahoo.com and deploys it to Hexclave (hexclave.deploy.ts, project "netnyahoo").
# `hexclave deploy` uploads the deploy file's directory, so the built site is staged here as dist/
# (gitignored) next to the Dockerfile and nginx.conf that serve it.
# usage: infra/site/deploy.sh   (or `pnpm -C apps/site run deploy`)
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
site="$here/../../apps/site"

SITE_URL=https://netnyahoo.com pnpm -C "$site" exec astro build
rsync -a --delete "$site/dist/" "$here/dist/"
cd "$here"
npx @hexclave/cli@latest deploy --cloud-project-id 49be2e2e-87c4-433e-b42f-f255854bff56
