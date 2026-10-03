"""Measure a render of the score: per-bar loudness, band balance and width; EBU R128 from ffmpeg; the share of
energy above 8 kHz; onset alignment of section downbeats and sound effects; the silent windows; the tail.

usage: python3 scripts/music/analyze.py [cut ...]   (default: every cut; reads public/music/<cut>.wav)
"""

import os
import re
import subprocess
import sys
import wave

import numpy as np
from scipy import ndimage, signal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import score  # noqa: E402

SR = score.SR


def read(path):
    with wave.open(path) as w:
        assert w.getframerate() == SR and w.getnchannels() == 2, path
        width = w.getsampwidth()
        raw = np.frombuffer(w.readframes(w.getnframes()), np.uint8)
    if width == 3:
        b = raw.reshape(-1, 3).astype(np.int32)
        v = (b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16))
        v = np.where(v >= 1 << 23, v - (1 << 24), v)
        return v.reshape(-1, 2) / float(1 << 23)
    return np.frombuffer(raw.tobytes(), "<i2").reshape(-1, 2) / 32768.0


def ebur128(path):
    r = subprocess.run(["ffmpeg", "-nostats", "-hide_banner", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    tail = r[r.rfind("Summary:"):]
    get = lambda k: float(re.search(k + r":\s+(-?[\d.]+)", tail).group(1))
    return get("I"), get("LRA"), get("Peak")


def bar_loudness(x):
    """Ungated K-weighted loudness of a stretch (LUFS)."""
    y = score.k_weight(x)
    ms = (y ** 2).mean(axis=0).sum()
    return -0.691 + 10 * np.log10(ms + 1e-20)


def loudness_series(x, window):
    """Ungated K-weighted loudness of `window` seconds ending at each 100 ms (momentary 0.4 s, short-term 3 s)."""
    p = (score.k_weight(x) ** 2).sum(axis=1)
    c = np.concatenate([[0], np.cumsum(p)])
    w, hop = int(window * SR), int(0.1 * SR)
    ends = np.arange(w, len(p) + 1, hop)
    return ends / SR, -0.691 + 10 * np.log10((c[ends] - c[ends - w]) / w + 1e-20)


def onset(x, i, search=0.012):
    """Where the attack nearest sample i starts, in ms relative to i: the first 0.25 ms frame within +-search
    whose peak is at least 4 dB above the loudest of the 1-6 ms before it and which leads, within 5 ms, to
    within 4 dB of the window's peak. None when nothing there jumps (a soft entrance)."""
    m = np.abs(x).max(axis=1) if x.ndim == 2 else np.abs(x)
    hop = int(0.00025 * SR)
    a = i - int(search * SR)
    b = i + int(search * SR) + 20 * hop
    seg = np.concatenate([np.zeros(max(0, -(a - 24 * hop))), m[max(0, a - 24 * hop):b]])
    env = 20 * np.log10(seg[: len(seg) // hop * hop].reshape(-1, hop).max(axis=1) + 1e-9)
    top = env[24:24 + 2 * int(search * SR) // hop].max()
    for k in range(24, 24 + 2 * int(search * SR) // hop):
        if env[k] >= top - 24 and env[k] - env[k - 24:k - 4].max() >= 4 and env[k:k + 20].max() >= top - 4:
            return (a + (k - 24) * hop - i) / SR * 1000
    return None


def fmt(d):
    return "soft (no transient)" if d is None else f"{d:+.2f} ms"


def main(name):
    path = os.path.join(score.ROOT, "public", "music", f"{name}.wav")
    x = read(path)
    cut = score.CUTS["cuts"][name]
    beats = cut["beats"]
    print(f"\n=== {name}: {len(x)} samples ({len(x) / SR:.3f} s; expected {score.at(beats)})")
    I, lra, tp = ebur128(path)
    print(f"ffmpeg ebur128: I {I:.1f} LUFS, LRA {lra:.1f} LU, true peak {tp:.1f} dBTP")
    print(f"script:         I {score.lufs(x):.2f} LUFS, true peak {20 * np.log10(score.true_peak(x).max()):.2f} dBTP")
    f, p = signal.welch(x.mean(axis=1), SR, nperseg=8192)
    print(f"energy above 8 kHz: {100 * p[f > 8000].sum() / p.sum():.2f}%   above 4 kHz: {100 * p[f > 4000].sum() / p.sum():.2f}%"
          f"   below 60 Hz: {100 * p[f < 60].sum() / p.sum():.1f}%")
    tm, mom = loudness_series(x, 0.4)
    ts, st = loudness_series(x, 3.0)
    first = 4 * score.BEAT  # the intro's first bar
    print(f"intro (bar 1) momentary: max {mom[tm <= first].max():.1f} LUFS, at 0.5 s {mom[np.argmin(abs(tm - 0.5))]:.1f} LUFS")
    bar = 0
    for kind, bars in cut["arrangement"]:
        a, b = 4 * bar * score.BEAT + 3.0, 4 * (bar + bars) * score.BEAT  # short-term windows wholly inside
        sel = st[(ts >= a) & (ts <= b)]
        if len(sel):
            print(f"  {kind:6s} short-term loudness: median {np.median(sel):6.1f}, max {sel.max():6.1f} LUFS")
        bar += bars

    # per bar
    secs, bar = [], 0
    for kind, bars in cut["arrangement"]:
        secs += [kind] * bars
    print("bar beat  section  LUFS   rms   peak crest  width |   sub   bass lowmid himid   air (dB re bar)")
    loud = {}
    for b in range(beats // 4):
        seg = x[score.at(4 * b):score.at(4 * b + 4)]
        m = seg.mean(axis=1)
        rms = 20 * np.log10(np.sqrt((m ** 2).mean()) + 1e-12)
        pk = 20 * np.log10(np.abs(seg).max() + 1e-12)
        side = (seg[:, 0] - seg[:, 1]) / 2
        width = 20 * np.log10(np.sqrt((side ** 2).mean()) / (np.sqrt((m ** 2).mean()) + 1e-12) + 1e-12)
        ff, pp = signal.welch(m, SR, nperseg=4096)
        tot = pp.sum() + 1e-20
        bands = [10 * np.log10(pp[(ff >= lo) & (ff < hi)].sum() / tot + 1e-12)
                 for lo, hi in [(20, 60), (60, 250), (250, 2000), (2000, 6000), (6000, 20000)]]
        L = bar_loudness(seg)
        loud.setdefault(secs[b], []).append(L)
        print(f"{b:3d} {4 * b:4d}  {secs[b]:7s} {L:6.1f} {rms:5.1f} {pk:6.1f} {pk - rms:5.1f} {width:6.1f} | "
              + " ".join(f"{v:6.1f}" for v in bands))
    for k, v in loud.items():
        print(f"  {k:6s} mean bar loudness {10 * np.log10(np.mean(10 ** (np.array(v) / 10))):6.1f} LUFS")

    # silence
    for a, b in cut.get("silence", []):
        seg = x[score.at(a):score.at(b)]
        print(f"silence {a}-{b}: max |x| = {np.abs(seg).max():.3g} ({'digital zero' if not seg.any() else 'NOT ZERO'})")
        if "dropB" in loud:
            after = bar_loudness(x[score.at(b):score.at(b + 4)])
            before = bar_loudness(x[score.at(a - 4):score.at(a)])
            print(f"  the bar before the silence {before:.1f} LUFS, the bar after {after:.1f} LUFS ({after - before:+.1f} dB)")
    last = x[-int(0.05 * SR):]
    print(f"last 50 ms peak {20 * np.log10(np.abs(last).max() + 1e-12):.1f} dBFS; "
          f"last frame (1/30 s) rms {20 * np.log10(np.sqrt((x[-1600:] ** 2).mean()) + 1e-12):.1f} dBFS")

    # onsets on the master: every section downbeat, and every sound effect cue on its own stem
    print("onsets (ms vs the grid):")
    bar = 0
    marks = []
    for a, b in cut.get("breaths", []):
        marks.append(("breath slam", b))
        seg = x[score.at(a) + int(0.05 * SR):score.at(b)]
        lo = score.filt(seg, "lowpass", 100)
        print(f"breath {a}-{b}: below-100 Hz rms {20 * np.log10(np.sqrt((lo ** 2).mean()) + 1e-12):.1f} dBFS, "
              f"loudness {bar_loudness(seg):.1f} LUFS")
    for kind, bars in cut["arrangement"]:
        marks.append((f"{kind} downbeat", 4 * bar))
        if kind == "end":
            tl = 4 * (bar + bars - 2)
            ends = [("tap", tl), ("tap", tl + 1), ("tap", tl + 2), ("button", tl + 3)] if bars >= 3 else [("button", 4 * bar + 4)]
            marks += [(f"end {k}", t) for k, t in ends]
        bar += bars
    for label, beat in marks:
        print(f"  {label:16s} beat {beat:5.2f}: {fmt(onset(x, score.at(beat)))}")
    m = score.Mix(name)
    for cue in cut.get("sfx", []):
        score.play_sfx(m, cue)
    stem = m.bus["sfx"] + m.bus["fx"]
    worst = 0.0
    for cue in cut.get("sfx", []):
        d = onset(stem, score.at(cue["beat"]))
        if cue["kind"] not in ("whoosh", "swipe", "riser"):
            worst = max(worst, abs(d) if d is not None else 99)
        print(f"  sfx {cue['kind']:7s} beat {cue['beat']:6.2f}: {fmt(d)} on its stem")
    print(f"  worst transient sfx offset {worst:.2f} ms (whoosh/swipe/riser swell in by design)")


if __name__ == "__main__":
    for n in sys.argv[1:] or list(score.CUTS["cuts"].keys()):
        main(n)
