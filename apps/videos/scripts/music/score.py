"""The launch film's score: an original track synthesized here from oscillators and noise, no samples.

A campaign-rally anthem at 128.57 BPM (a beat is exactly 14 frames at 30 fps): brass stabs, a marching snare
roll, a four-on-the-floor drop with a supersaw chord bed and a brass riff, a break, a bigger second drop and a
final hit. The arrangement and the sound effects come from src/lib/nn-launch/cuts.json, the same file the
edit reads, so every hit lands on the frame the picture cuts on.

usage: python3 scripts/music/score.py [cut ...]   (default: every cut) -> public/music/<cut>.wav
Needs numpy and scipy. Deterministic: the noise is seeded.
"""

import json
import os
import sys

import numpy as np
from scipy import signal

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
CUTS = json.load(open(os.path.join(ROOT, "src", "lib", "nn-launch", "cuts.json")))

SR = 48000
BPM = CUTS["bpm"]
BEAT = 60.0 / BPM
BAR = BEAT * 4
RNG = np.random.default_rng(67)


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


# ---------------------------------------------------------------------------------------------- oscillators

def polyblep(t, dt):
    dt = np.broadcast_to(dt, t.shape)
    out = np.zeros_like(t)
    m = t < dt
    x = t[m] / dt[m]
    out[m] = x + x - x * x - 1
    m = t > 1 - dt
    x = (t[m] - 1) / dt[m]
    out[m] = x * x + x + x + 1
    return out


def saw(freq, n, phase=0.0):
    """Band-limited saw; freq may be an array (glides)."""
    f = np.broadcast_to(np.asarray(freq, dtype=np.float64), (n,))
    dt = f / SR
    ph = (phase + np.cumsum(dt)) % 1.0
    return 2 * ph - 1 - polyblep(ph, dt)


def square(freq, n, phase=0.0, width=0.5):
    f = np.broadcast_to(np.asarray(freq, dtype=np.float64), (n,))
    dt = f / SR
    ph = (phase + np.cumsum(dt)) % 1.0
    ph2 = (ph + 1 - width) % 1.0
    return (2 * ph - 1 - polyblep(ph, dt)) - (2 * ph2 - 1 - polyblep(ph2, dt))


def sine(freq, n, phase=0.0):
    f = np.broadcast_to(np.asarray(freq, dtype=np.float64), (n,))
    return np.sin(2 * np.pi * (phase + np.cumsum(f / SR)))


def noise(n):
    return RNG.standard_normal(n)


def env_adsr(n, a, d, s, r, hold=None):
    """Attack/decay/sustain for `hold` seconds (default: until release starts at n - r), then release."""
    t = np.arange(n) / SR
    hold = (n / SR - r) if hold is None else hold
    e = np.where(t < a, t / max(a, 1e-6), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-6)))
    rel = t > hold
    if rel.any():
        level = e[np.argmax(rel) - 1] if np.argmax(rel) > 0 else s
        e[rel] = level * np.exp(-(t[rel] - hold) / max(r / 4, 1e-6))
    return e


def exp_env(n, decay):
    return np.exp(-np.arange(n) / SR / decay)


# ---------------------------------------------------------------------------------------------- filters

def biquad_lp(fc, q):
    w = 2 * np.pi * np.clip(fc, 20, SR * 0.45) / SR
    alpha = np.sin(w) / (2 * q)
    c = np.cos(w)
    b = np.array([(1 - c) / 2, 1 - c, (1 - c) / 2])
    a = np.array([1 + alpha, -2 * c, 1 - alpha])
    return b / a[0], a / a[0]


def lowpass_sweep(x, fc, q=0.8, block=64):
    """Time-varying resonant lowpass: fc is an array of cutoffs (Hz), updated every `block` samples."""
    fc = np.broadcast_to(np.asarray(fc, dtype=np.float64), x.shape[:1])
    y = np.zeros_like(x)
    zi = np.zeros(2)
    for i in range(0, len(x), block):
        b, a = biquad_lp(fc[i], q)
        y[i:i + block], zi = signal.lfilter(b, a, x[i:i + block], zi=zi)
    return y


def sos(kind, freq, order=2):
    return signal.butter(order, freq, btype=kind, fs=SR, output="sos")


def filt(x, kind, freq, order=2):
    return signal.sosfilt(sos(kind, freq, order), x, axis=0)


# ---------------------------------------------------------------------------------------------- instruments
# Each returns a mono or stereo array starting at the note's onset.

def kick(level=1.0):
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    f = 52 + 120 * np.exp(-t / 0.03) + 60 * np.exp(-t / 0.004)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * exp_env(n, 0.15)
    click = filt(noise(n), "highpass", 2500) * exp_env(n, 0.005) * 0.6
    x = np.tanh((body + click) * 1.8) * 0.9
    return x * level


def clap(level=1.0):
    n = int(0.6 * SR)
    t = np.arange(n) / SR
    e = np.zeros(n)
    for k, off in enumerate([0, 0.011, 0.022, 0.031]):
        e += (t >= off) * np.exp(-np.clip(t - off, 0, None) / (0.006 if k < 3 else 0.14))
    x = filt(noise(n), "bandpass", [900, 3200]) * e
    x += filt(noise(n), "bandpass", [180, 260], 1) * exp_env(n, 0.05) * 0.5
    return np.tanh(x * 1.2) * 0.55 * level


def snare(level=1.0, decay=0.13):
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    tone = np.sin(2 * np.pi * 185 * t) * exp_env(n, 0.05) + 0.5 * np.sin(2 * np.pi * 330 * t) * exp_env(n, 0.03)
    rattle = filt(noise(n), "bandpass", [1800, 9000]) * exp_env(n, decay)
    return np.tanh((tone * 0.6 + rattle * 0.9) * 1.4) * 0.5 * level


def hat(open_=False, level=1.0):
    n = int((0.32 if open_ else 0.06) * SR)
    metal = sum(square(f, n, phase=RNG.random()) for f in [317, 421, 541, 663, 811, 1007]) / 6
    x = filt(metal * 0.6 + noise(n) * 0.8, "highpass", 7000, 4)
    return x * exp_env(n, 0.11 if open_ else 0.018) * 0.32 * level


def crash(level=1.0, length=2.6):
    n = int(length * SR)
    metal = sum(square(f, n, phase=RNG.random()) for f in [287, 409, 521, 733, 1013, 1291, 1723]) / 7
    x = filt(metal * 0.5 + noise(n), "highpass", 4500, 2)
    x = filt(x, "lowpass", 14000)
    return x * exp_env(n, 0.7) * 0.32 * level


def tom(note, level=1.0):
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    f = midi(note) * (1 + 0.5 * np.exp(-t / 0.03))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * exp_env(n, 0.22)
    x += filt(noise(n), "bandpass", [300, 2000]) * exp_env(n, 0.02) * 0.4
    return np.tanh(x * 1.5) * 0.6 * level


def supersaw(notes, dur, cutoff=(600, 5200), env=(0.01, 0.3, 0.75, 0.25), voices=7, detune=0.18, level=1.0):
    n = int((dur + env[3]) * SR)
    left = np.zeros(n)
    right = np.zeros(n)
    for note in notes:
        for v in range(voices):
            d = (v - (voices - 1) / 2) / ((voices - 1) / 2) * detune
            wave = saw(midi(note + d), n, phase=RNG.random())
            pan = 0.5 + 0.45 * (v - (voices - 1) / 2) / ((voices - 1) / 2)
            left += wave * np.sqrt(1 - pan)
            right += wave * np.sqrt(pan)
    e = env_adsr(n, env[0], env[1], env[2], env[3], hold=dur)
    lo, hi = cutoff
    fc = lo + (hi - lo) * env_adsr(n, 0.005, 0.18, 0.35, env[3], hold=dur)
    out = np.stack([lowpass_sweep(left, fc, 0.9), lowpass_sweep(right, fc, 0.9)], axis=1)
    return out * e[:, None] * level / (voices * len(notes)) ** 0.5 * 0.45


def brass(notes, dur, level=1.0, bright=1.0):
    """A synth-brass stab: saws with a fast filter blip and a small pitch scoop up."""
    n = int((dur + 0.18) * SR)
    t = np.arange(n) / SR
    scoop = 2 ** (-0.6 * np.exp(-t / 0.025) / 12)
    left = np.zeros(n)
    right = np.zeros(n)
    for note in notes:
        for k, d in enumerate([-0.09, 0.0, 0.11]):
            wave = saw(midi(note + d) * scoop, n, phase=RNG.random()) + 0.35 * square(midi(note - 12 + d) * scoop, n, phase=RNG.random(), width=0.42)
            if k == 0:
                left += wave
            elif k == 2:
                right += wave
            else:
                left += wave * 0.7
                right += wave * 0.7
    fc = 500 + 5200 * bright * (np.exp(-t / 0.09) * 0.75 + 0.25)
    e = env_adsr(n, 0.006, 0.12, 0.55, 0.15, hold=dur)
    out = np.stack([lowpass_sweep(left, fc, 1.1), lowpass_sweep(right, fc, 1.1)], axis=1)
    return np.tanh(out * 0.6) * e[:, None] * level * 0.42 / len(notes) ** 0.5


def bass(note, dur, level=1.0, growl=0.0):
    n = int((dur + 0.05) * SR)
    t = np.arange(n) / SR
    f = midi(note)
    x = saw(f, n) * 0.8 + square(f * 2, n, width=0.5) * 0.2
    fc = 180 + (1300 + 1800 * growl) * np.exp(-t / 0.07)
    x = lowpass_sweep(x, fc, 1.3)
    sub = sine(f, n) * 0.55
    e = env_adsr(n, 0.003, 0.08, 0.8, 0.04, hold=dur)
    return np.tanh((x + sub) * 1.4) * e * 0.5 * level


def lead(note, dur, level=1.0):
    n = int((dur + 0.25) * SR)
    t = np.arange(n) / SR
    vib = 2 ** (0.12 * np.sin(2 * np.pi * 5.5 * t) * np.clip((t - 0.15) / 0.2, 0, 1) / 12)
    x = square(midi(note) * vib, n, width=0.3) * 0.5 + saw(midi(note + 0.07) * vib, n) * 0.5 + saw(midi(note + 12 - 0.05) * vib, n) * 0.18
    fc = 1600 + 3800 * env_adsr(n, 0.01, 0.2, 0.5, 0.2, hold=dur)
    x = lowpass_sweep(x, fc, 1.0)
    e = env_adsr(n, 0.008, 0.15, 0.8, 0.22, hold=dur)
    return x * e * 0.3 * level


def pad(notes, dur, level=1.0):
    return supersaw(notes, dur, cutoff=(350, 1500), env=(0.5, 0.8, 0.85, 1.2), voices=5, detune=0.12, level=level)


def riser(dur, level=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    p = t / dur
    x = noise(n)
    fc = 300 * (40 ** p)
    y = np.zeros(n)
    zi = np.zeros(2)
    for i in range(0, n, 64):
        w = 2 * np.pi * min(fc[i], SR * 0.45) / SR
        alpha = np.sin(w) / (2 * 4.0)
        b = np.array([alpha, 0, -alpha]) / (1 + alpha)
        a = np.array([1 + alpha, -2 * np.cos(w), 1 - alpha]) / (1 + alpha)
        y[i:i + 64], zi = signal.lfilter(b, a, x[i:i + 64], zi=zi)
    tone = saw(110 * (8 ** p), n) * 0.12
    return (y * 0.6 + lowpass_sweep(tone, 400 + 6000 * p, 1.0)) * p ** 1.6 * 0.8 * level


def impact(level=1.0):
    n = int(2.8 * SR)
    t = np.arange(n) / SR
    f = 32 + 70 * np.exp(-t / 0.08)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * exp_env(n, 0.9)
    hit = filt(noise(n), "lowpass", 3000) * exp_env(n, 0.08)
    return np.tanh((boom * 1.2 + hit * 0.6) * 1.5) * 0.75 * level


def reverse_crash(dur, level=1.0):
    c = crash(1.0, length=dur + 0.2)[: int(dur * SR)]
    return c[::-1] * 0.8 * level


# ---------------------------------------------------------------------------------------------- sound effects

def sfx_whoosh(level=1.0, dur=0.42):
    n = int(dur * SR)
    t = np.arange(n) / SR
    p = t / dur
    x = noise(n)
    lo = filt(x, "bandpass", [400, 5000])
    shape = np.sin(np.pi * p) ** 2
    pan = p
    out = np.stack([lo * shape * np.sqrt(1 - pan), lo * shape * np.sqrt(pan)], axis=1)
    return out * 0.35 * level


def sfx_stamp(level=1.0):
    """A rubber stamp on paper: a low thud, a slap and a short rattle of the desk."""
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    thud = np.sin(2 * np.pi * (70 + 60 * np.exp(-t / 0.02)) * t) * exp_env(n, 0.09)
    slap = filt(noise(n), "bandpass", [600, 4000]) * exp_env(n, 0.012)
    return np.tanh((thud * 1.2 + slap * 0.8) * 1.6) * 0.6 * level


def sfx_click(level=1.0):
    n = int(0.05 * SR)
    x = filt(noise(n), "bandpass", [2000, 7000]) * exp_env(n, 0.003)
    x += np.sin(2 * np.pi * 2400 * np.arange(n) / SR) * exp_env(n, 0.006) * 0.5
    return x * 0.45 * level


def sfx_key(level=1.0):
    n = int(0.06 * SR)
    x = filt(noise(n), "bandpass", [1200, 5000]) * exp_env(n, 0.006)
    x += filt(noise(n), "lowpass", 400) * exp_env(n, 0.012) * 0.6
    return x * 0.35 * level


def sfx_swipe(level=1.0, dur=0.32):
    n = int(dur * SR)
    p = np.arange(n) / n
    x = filt(noise(n), "bandpass", [900, 6000]) * np.sin(np.pi * p) ** 1.5
    return x * 0.22 * level


SFX = {"whoosh": sfx_whoosh, "stamp": sfx_stamp, "click": sfx_click, "key": sfx_key, "swipe": sfx_swipe,
       "impact": lambda level=1.0: impact(level), "riser": None}

# ---------------------------------------------------------------------------------------------- the song

# F minor: Fm - Db - Ab - Eb, one chord a bar.
ROOTS = [41, 37, 44, 39]  # F2 Db2 Ab2 Eb2
CHORDS = [[65, 68, 72], [65, 68, 73], [63, 68, 72], [63, 67, 70]]  # voiced close around F4
RIFF = [  # (16th step, index into the bar's chord, length in 16ths): a tresillo brass riff on chord tones
    (0, 0, 2), (3, 0, 2), (6, 1, 2), (10, 0, 1), (12, 2, 2), (14, 1, 2),
]
MELODY = [  # drop B lead, per bar: (16th step, midi, length in 16ths)
    [(0, 72, 3), (3, 72, 3), (6, 75, 2), (8, 77, 6), (14, 75, 2)],
    [(0, 73, 3), (3, 72, 3), (6, 70, 2), (8, 68, 8)],
    [(0, 75, 3), (3, 75, 3), (6, 77, 2), (8, 80, 6), (14, 79, 2)],
    [(0, 79, 3), (3, 77, 3), (6, 75, 2), (8, 79, 8)],
]


class Mix:
    def __init__(self, seconds):
        self.n = int(seconds * SR) + SR * 3
        self.bus = {k: np.zeros((self.n, 2)) for k in ["drums", "bass", "music", "fx", "sfx"]}
        self.verb = np.zeros((self.n, 2))
        self.kicks = []

    def add(self, bus, x, at, gain=1.0, pan=0.0, verb=0.0):
        if x.ndim == 1:
            l, r = np.sqrt(0.5 * (1 - pan)), np.sqrt(0.5 * (1 + pan))
            x = np.stack([x * l * 1.414, x * r * 1.414], axis=1)
        i = int(round(at * SR))
        if i >= self.n:
            return
        x = x[: self.n - i] * gain
        self.bus[bus][i:i + len(x)] += x
        if verb:
            self.verb[i:i + len(x)] += x * verb


def section_bars(cut):
    """[(name, first bar, bars)] from the cut's arrangement."""
    out, bar = [], 0
    for name, bars in cut["arrangement"]:
        out.append((name, bar, bars))
        bar += bars
    return out, bar


def play_groove(m, bar0, bars, big=False, fill_last=True):
    for b in range(bar0, bar0 + bars):
        t0 = b * BAR
        ci = (b - bar0) % 4
        root = ROOTS[ci]
        last = b == bar0 + bars - 1
        for beat in range(4):
            m.add("drums", kick(1.0), t0 + beat * BEAT)
            m.kicks.append(t0 + beat * BEAT)
            if beat in (1, 3):
                m.add("drums", clap(1.0), t0 + beat * BEAT, verb=0.25)
                m.add("drums", snare(0.5), t0 + beat * BEAT)
            m.add("drums", hat(True, 1.4), t0 + beat * BEAT + BEAT / 2, pan=0.2)
            if big:
                for s in (1, 3):
                    m.add("drums", hat(False, 1.2), t0 + beat * BEAT + s * BEAT / 4, pan=-0.25)
        # bass: rolling off-beat 16ths (x.xx), sidechained below
        for step in range(16):
            if step % 4 == 0:
                continue
            note = root + (12 if step in (6, 14) and big else 0)
            m.add("bass", bass(note, BEAT / 4 * 0.9, 0.9, growl=0.6 if big else 0.2), t0 + step * BEAT / 4)
        # chord bed on every bar, brass riff on top
        m.add("music", supersaw([c - 12 for c in CHORDS[ci]] + CHORDS[ci], BAR * 0.98, level=0.8 if big else 0.65), t0, verb=0.3)
        for step, idx, length in RIFF:
            note = CHORDS[ci][idx]
            m.add("music", brass([note, note + 12] if big else [note], BEAT / 4 * length * 0.9, level=0.9), t0 + step * BEAT / 4, verb=0.15)
        if big:
            for step, note, length in MELODY[ci]:
                m.add("music", lead(note, BEAT / 4 * length * 0.95, 0.9), t0 + step * BEAT / 4, pan=0.0, verb=0.35)
        if ci == 0:
            m.add("fx", crash(0.9), t0, pan=-0.3, verb=0.3)
        if last and fill_last:
            for k, note in enumerate([50, 47, 45, 41]):
                m.add("drums", tom(note, 0.9), t0 + 2 * BEAT + k * BEAT / 4, pan=0.4 - 0.25 * k)
            m.add("fx", reverse_crash(BEAT * 2), t0 + 2 * BEAT, gain=0.8)


def play_hook(m, bar0, bars):
    """Bar 1: four brass stabs with kicks and a crash. Bar 2: a marching snare roll and a riser into the drop."""
    t0 = bar0 * BAR
    for beat in range(4):
        notes = CHORDS[0] if beat < 3 else CHORDS[3]
        m.add("music", brass([n - 12 for n in notes] + notes, BEAT * 0.55, level=1.25, bright=1.2), t0 + beat * BEAT, verb=0.3)
        m.add("drums", kick(1.0), t0 + beat * BEAT)
        m.kicks.append(t0 + beat * BEAT)
        m.add("bass", bass(ROOTS[0] if beat < 3 else ROOTS[3], BEAT * 0.5, 1.0, growl=0.8), t0 + beat * BEAT)
    m.add("fx", crash(1.0), t0, verb=0.3)
    m.add("fx", impact(0.45), t0)
    if bars < 2:
        return
    t1 = t0 + BAR
    # roll: 8ths, then 16ths, then 32nds, crescendo
    times = [t1 + k * BEAT / 2 for k in range(4)] + [t1 + 2 * BEAT + k * BEAT / 4 for k in range(4)] + [t1 + 3 * BEAT + k * BEAT / 8 for k in range(8)]
    for k, tt in enumerate(times):
        m.add("drums", snare(0.45 + 0.6 * k / len(times), decay=0.09), tt, pan=0.1 * (-1) ** k, verb=0.2)
    m.add("fx", riser(BAR, 1.0), t1)
    m.add("music", pad([c - 12 for c in CHORDS[3]], BAR * 0.95, level=0.5), t1, verb=0.4)
    m.add("bass", bass(ROOTS[3], BAR * 0.9, 0.5), t1)


def play_break(m, bar0, bars):
    for b in range(bar0, bar0 + bars):
        t0 = b * BAR
        ci = (b - bar0) % 4
        m.add("music", pad(CHORDS[ci], BAR * 0.98, level=0.9), t0, verb=0.5)
        m.add("bass", sine(midi(ROOTS[ci]), int(BAR * SR)) * env_adsr(int(BAR * SR), 0.05, 0.5, 0.7, 0.3) * 0.3, t0)
        # a heartbeat: muted kick on 1 and the "and" of 2
        m.add("drums", filt(kick(0.6), "lowpass", 300), t0)
        m.add("drums", filt(kick(0.4), "lowpass", 300), t0 + 1.5 * BEAT)
        for step in range(0, 16, 2):  # plucked brass ticking
            m.add("music", lowpass_sweep(brass([CHORDS[ci][step // 2 % 3]], BEAT / 8, 0.5, 0.3)[:, 0], 1800, 0.7), t0 + step * BEAT / 4, pan=0.4 * (-1) ** (step // 2), verb=0.4)
    last = (bar0 + bars - 1) * BAR
    m.add("fx", riser(BAR, 1.1), last)
    times = [last + 2 * BEAT + k * BEAT / 4 for k in range(4)] + [last + 3 * BEAT + k * BEAT / 8 for k in range(8)]
    for k, tt in enumerate(times):
        m.add("drums", snare(0.4 + 0.6 * k / len(times), decay=0.08), tt, verb=0.2)


def play_end(m, bar0, bars):
    """The last downbeat: everything at once, then the chord rings out over the end card."""
    t0 = bar0 * BAR
    m.add("fx", impact(1.1), t0, verb=0.2)
    m.add("fx", crash(1.0, length=4.0), t0, verb=0.4)
    m.add("drums", kick(1.1), t0)
    m.kicks.append(t0)
    notes = CHORDS[0]
    m.add("music", brass([n - 12 for n in notes] + notes + [notes[0] + 12], BEAT * 1.5, level=1.3, bright=1.3), t0, verb=0.4)
    m.add("music", pad([n - 12 for n in notes] + notes, BAR * bars - 0.4, level=1.0), t0, verb=0.6)
    m.add("bass", bass(ROOTS[0], BEAT * 1.4, 1.0, growl=0.8), t0)
    # a march tail: snare taps on the next-to-last bar's beats 1-3, a final brass button on its beat 4, and the
    # last bar left to ring out under the end card
    if bars >= 3:
        tl = (bar0 + bars - 2) * BAR
        for k in range(3):
            m.add("drums", snare(0.55, decay=0.1), tl + k * BEAT, verb=0.3)
        m.add("music", brass([notes[0], notes[2], notes[0] + 12], BEAT * 0.5, level=1.1), tl + 3 * BEAT, verb=0.4)
        m.add("drums", kick(1.0), tl + 3 * BEAT)
        m.kicks.append(tl + 3 * BEAT)


def reverb_ir(seconds=2.2, predelay=0.02):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = np.stack([noise(n), noise(n)], axis=1) * np.exp(-t / (seconds / 6.5))[:, None]
    ir = filt(ir, "lowpass", 6000)
    ir = np.concatenate([np.zeros((int(predelay * SR), 2)), ir])
    return ir / np.sqrt((ir ** 2).sum(axis=0))


def sidechain(n, kicks, depth=0.75, release=0.16):
    g = np.ones(n)
    t = np.arange(n) / SR
    for k in kicks:
        i = int(k * SR)
        j = min(n, i + int(release * 3 * SR))
        g[i:j] = np.minimum(g[i:j], 1 - depth * np.exp(-(t[i:j] - k) / release))
    # a 4 ms attack so the duck isn't a click
    return signal.sosfilt(sos("lowpass", 120, 1), g)


def master(x, target_lufs=-14.0):
    # glue: soft clip, then a lookahead peak limiter at -1.2 dBFS
    x = np.tanh(x * 1.1) / 1.1
    ceiling = 10 ** (-1.2 / 20)
    loud = lufs(x)
    x = x * 10 ** ((target_lufs - loud) / 20)
    for _ in range(3):
        peak = np.abs(x).max(axis=1)
        look = int(0.003 * SR)
        need = np.maximum(1, peak / ceiling)
        need = np.maximum.reduce([np.roll(need, -k) for k in range(0, look, 8)])
        gain = 1 / need
        rel = np.exp(-1 / (0.08 * SR))
        g = gain.copy()
        for i in range(1, len(g)):  # release smoothing (attack is instant via the lookahead)
            if g[i] > g[i - 1]:
                g[i] = g[i - 1] * rel + g[i] * (1 - rel)
        x = x * g[:, None]
        x = x * 10 ** ((target_lufs - lufs(x)) / 20)
    return np.clip(x, -ceiling, ceiling)


def lufs(x):
    """ITU-R BS.1770 integrated loudness (K-weighting, 400 ms gates, absolute and relative gating)."""
    b1, a1 = [1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585]
    b2, a2 = [1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621]
    if SR != 48000:
        raise ValueError("K-weighting coefficients are for 48 kHz")
    y = signal.lfilter(b2, a2, signal.lfilter(b1, a1, x, axis=0), axis=0)
    block, hop = int(0.4 * SR), int(0.1 * SR)
    ms = np.array([(y[i:i + block] ** 2).mean(axis=0).sum() for i in range(0, len(y) - block, hop)])
    ms = ms[ms > 0]
    l = -0.691 + 10 * np.log10(ms)
    ms = ms[l > -70]
    rel = -0.691 + 10 * np.log10(ms.mean()) - 10
    ms = ms[(-0.691 + 10 * np.log10(ms)) > rel]
    return -0.691 + 10 * np.log10(ms.mean())


def render(name):
    cut = CUTS["cuts"][name]
    secs, total_bars = section_bars(cut)
    length = cut["beats"] * BEAT
    m = Mix(length)
    for kind, bar0, bars in secs:
        if kind == "hook":
            play_hook(m, bar0, bars)
        elif kind in ("dropA", "dropB"):
            play_groove(m, bar0, bars, big=kind == "dropB", fill_last=True)
        elif kind == "break":
            play_break(m, bar0, bars)
        elif kind == "end":
            play_end(m, bar0, bars)
        else:
            raise ValueError(kind)
    for cue in cut.get("sfx", []):
        fn = SFX[cue["kind"]]
        at = cue["beat"] * BEAT
        x = riser(cue.get("len", 1) * BEAT, cue.get("gain", 1.0)) if fn is None else fn(level=cue.get("gain", 1.0))
        m.add("sfx", x, at, pan=cue.get("pan", 0.0), verb=cue.get("verb", 0.1))
    n = m.n
    sc = sidechain(n, m.kicks)
    bus = m.bus
    bus["bass"] *= sc[:, None]
    bus["music"] *= (0.35 + 0.65 * sc)[:, None]
    verb = signal.fftconvolve(m.verb * (0.5 + 0.5 * sc)[:, None], reverb_ir(), axes=0)[:n] * 0.35
    drums = np.tanh(bus["drums"] * 1.3) / 1.3
    mixdown = drums * 0.85 + bus["bass"] * 0.5 + bus["music"] * 1.25 + bus["fx"] * 0.6 + bus["sfx"] * 0.9 + verb
    mixdown = filt(mixdown, "highpass", 28)
    # trim to the cut, with a 30 ms fade at the very end so the file never ends on a click
    end = int(length * SR)
    mixdown = mixdown[:end]
    fade = int(0.03 * SR)
    mixdown[-fade:] *= np.linspace(1, 0, fade)[:, None]
    out = master(mixdown, CUTS.get("lufs", -14.0))
    path = os.path.join(ROOT, "public", "music", f"{name}.wav")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    pcm = (out * 32767).astype("<i2")
    import wave
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"{path}: {length:.2f}s, {lufs(out):.1f} LUFS, peak {20 * np.log10(np.abs(out).max()):.1f} dBFS")


if __name__ == "__main__":
    names = sys.argv[1:] or list(CUTS["cuts"].keys())
    for name in names:
        render(name)
