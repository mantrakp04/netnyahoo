#!/usr/bin/env bash
# Installs the pinned uBlock Origin Lite into packages/arcadiacore/vendor/ubol/ext, where embed.sh copies it into the
# app. The build runs it (embed.sh); scripts/update-ubol.sh moves the pin to uBOL's latest release. Idempotent.
set -euo pipefail

vendor="$(cd "$(dirname "$0")/.." && pwd)/vendor"

# The content blocker: uBlock Origin Lite (MV3, declarativeNetRequest), loaded as a
# built-in extension in every profile (ArcadiaCoreContentBlocker.mm). Pinned release; the
# manifest gets our `key` so its extension id is fixed
# (bnjeokpoejhioagiokhkhmdogkhbnbki), wherever the app bundle lives.
UBOL_VERSION="2026.1006.1931"
UBOL_SHA256="1670f92590f5ad5b20f02d0a75e144572567b4ba979b3dc3204c41f651206fe7"
UBOL_KEY="MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0ZvGFQVC3AezHHji9jii1xuD992hwYUSRZuvPmdugT/g4FkXxqD9NgrPPVh+nLdRfEvK7ht6i1ADwFJXo9vYh7asPSeB8cU/z/Vt2VufXw7XvR7PGcDWsXXfS3P/LBv/BG3tYOADD/RwwBAPqasjAtWkLsJdEawZArm316VS6Boo89W5lrCNp4bm4RYqTP9MRTBzRzZS7NmMQWNnD1OFEDb4w+36+J1lSLMv8A06EEbVzvIdYK6MQrUwhLXe6CfeITpp/YQ6PWWEfmRpQUolkLiOE/swvV8GvkV9Kpx/USDwhkaybF7JZqKV5nUSYdiRiO/7t30yDnk52MG7xR4KBQIDAQAB"
ubol="$vendor/ubol"
installed() { [ -f "$ubol/.version" ] && [ "$(cat "$ubol/.version")" = "$UBOL_VERSION" ]; }
# Parallel builds run this at once: one installs (under a lock that dies with it), the others wait and find it done.
if ! installed && [ -z "${UBOL_LOCKED:-}" ]; then
  mkdir -p "$ubol"
  UBOL_LOCKED=1 exec lockf -k -t 600 "$ubol/.lock" "$0"
fi
if ! installed; then
  zip="$ubol/uBOLite_$UBOL_VERSION.chromium.zip"
  if [ ! -f "$zip" ]; then
    url="https://github.com/uBlockOrigin/uBOL-home/releases/download/$UBOL_VERSION/uBOLite_$UBOL_VERSION.chromium.zip"
    echo "Downloading $url"
    curl -fL --retry 3 -o "$zip.part" "$url"
    mv "$zip.part" "$zip"
  fi
  echo "$UBOL_SHA256  $zip" | shasum -a 256 -c -
  # Unpacked beside it and swapped in, so a build copying ext never sees it half-written.
  rm -rf "$ubol/ext.new" "$ubol/ext.old"
  unzip -q "$zip" -d "$ubol/ext.new"
  python3 - "$ubol/ext.new/manifest.json" "$UBOL_KEY" <<'PY'
import json, sys
path, key = sys.argv[1], sys.argv[2]
manifest = json.load(open(path))
manifest["key"] = key
json.dump(manifest, open(path, "w"), indent=2)
PY
  [ -d "$ubol/ext" ] && mv "$ubol/ext" "$ubol/ext.old"
  mv "$ubol/ext.new" "$ubol/ext"
  rm -rf "$ubol/ext.old"
  echo "$UBOL_VERSION" > "$ubol/.version"
fi
