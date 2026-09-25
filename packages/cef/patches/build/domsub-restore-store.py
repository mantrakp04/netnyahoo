#!/usr/bin/env python3
"""Undo domain substitution for the files in domsub-keep-store.txt, using the
pre-substitution copies in domsubcache.tar.gz. Only files whose content still
matches what substitution produced are restored (anything edited since is
reported and left alone). Touches restored files so they rebuild."""
import fnmatch, pathlib, sys, tarfile, zlib

CB = pathlib.Path.home() / 'chromium-build'
SRC = CB / 'chromium_git/chromium/src'
patterns = [l.strip() for l in (CB / 'scripts/domsub-keep-store.txt').read_text().splitlines()
            if l.strip() and not l.startswith('#')]
with tarfile.open(CB / 'domsubcache.tar.gz') as tar:
    index = {}
    for line in tar.extractfile('cache_index.list').read().decode().splitlines():
        path, crc = line.rsplit('|', 1)
        index[path] = int(crc, 16)
    restored, changed = [], []
    for path, crc in index.items():
        if not any(fnmatch.fnmatch(path, p) for p in patterns):
            continue
        f = SRC / path
        cur = f.read_bytes()
        if zlib.crc32(cur) != crc:
            changed.append(path)
            continue
        f.write_bytes(tar.extractfile('orig/' + path).read())
        restored.append(path)
print('restored:', *restored, sep='\n  ')
if changed:
    print('edited after substitution (left alone, check by hand):', *changed, sep='\n  ')
