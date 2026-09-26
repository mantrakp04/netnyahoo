#!/usr/bin/env bash
# Installs the pinned uBlock Origin Lite into vendor/ubol/ext, where embed.sh copies it into the
# app. setup.sh runs it; scripts/update-ubol.sh moves the pin to uBOL's latest release. Idempotent.
set -euo pipefail

vendor="$(cd "$(dirname "$0")/.." && pwd)/vendor"

# The content blocker: uBlock Origin Lite (MV3, declarativeNetRequest), loaded as a
# built-in extension in every profile (NNContentBlocker.mm). Pinned release; the
# manifest gets our `key` so its extension id is fixed
# (bnjeokpoejhioagiokhkhmdogkhbnbki), wherever the app bundle lives.
UBOL_VERSION="2026.920.1710"
UBOL_SHA256="3ebf1458078d8738daf580e5ddeb41412cfa20fe4874a2fb321373f5ff7a09f1"
UBOL_KEY="MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0ZvGFQVC3AezHHji9jii1xuD992hwYUSRZuvPmdugT/g4FkXxqD9NgrPPVh+nLdRfEvK7ht6i1ADwFJXo9vYh7asPSeB8cU/z/Vt2VufXw7XvR7PGcDWsXXfS3P/LBv/BG3tYOADD/RwwBAPqasjAtWkLsJdEawZArm316VS6Boo89W5lrCNp4bm4RYqTP9MRTBzRzZS7NmMQWNnD1OFEDb4w+36+J1lSLMv8A06EEbVzvIdYK6MQrUwhLXe6CfeITpp/YQ6PWWEfmRpQUolkLiOE/swvV8GvkV9Kpx/USDwhkaybF7JZqKV5nUSYdiRiO/7t30yDnk52MG7xR4KBQIDAQAB"
ubol="$vendor/ubol"
if [ ! -f "$ubol/.version" ] || [ "$(cat "$ubol/.version")" != "$UBOL_VERSION" ]; then
  zip="$ubol/uBOLite_$UBOL_VERSION.chromium.zip"
  mkdir -p "$ubol"
  if [ ! -f "$zip" ]; then
    url="https://github.com/uBlockOrigin/uBOL-home/releases/download/$UBOL_VERSION/uBOLite_$UBOL_VERSION.chromium.zip"
    echo "Downloading $url"
    curl -fL --retry 3 -o "$zip.part" "$url"
    mv "$zip.part" "$zip"
  fi
  echo "$UBOL_SHA256  $zip" | shasum -a 256 -c -
  rm -rf "$ubol/ext"
  unzip -q "$zip" -d "$ubol/ext"
  python3 - "$ubol/ext/manifest.json" "$UBOL_KEY" <<'PY'
import json, sys
path, key = sys.argv[1], sys.argv[2]
manifest = json.load(open(path))
manifest["key"] = key
json.dump(manifest, open(path, "w"), indent=2)
PY
  echo "$UBOL_VERSION" > "$ubol/.version"
fi
