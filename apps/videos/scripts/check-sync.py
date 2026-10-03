"""Cross-correlates a render's audio against its score WAV: prints the lag in samples (0 = in sync) and the length
difference. usage: python3 scripts/check-sync.py out/<id>.mp4 public/music/<cut>.wav"""
import subprocess, sys
import numpy as np

def pcm(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32)

a, b = pcm(sys.argv[1]), pcm(sys.argv[2])
n = min(len(a), len(b))
lags = []
for start in (int(n * 0.15), int(n * 0.5), int(n * 0.8)):
    m, s = a[start:start + 48000 * 4], b[start:start + 48000 * 4]
    c = np.fft.irfft(np.fft.rfft(m, 2 * len(m)) * np.conj(np.fft.rfft(s, 2 * len(m))))
    k = int(np.argmax(c))
    lags.append(k if k < len(m) else k - 2 * len(m))
print(f"{sys.argv[1]}: lag {lags} samples, length difference {len(a) - len(b)} samples")
sys.exit(0 if all(l == 0 for l in lags) else 1)
