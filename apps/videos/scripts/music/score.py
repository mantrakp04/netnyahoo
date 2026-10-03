"""The launch film's score: a sampler that plays real recorded instruments on the film's beat grid.

A campaign-rally anthem in F minor at 128.57 BPM (a beat is exactly 14 frames at 30 fps, 22400 samples at 48 kHz).
Brass sections (trumpets, horns, trombones, tuba), timpani, a concert bass drum and cymbals from VSCO 2 CE; a
rope-tension march snare, hand claps, a tom, a slapstick and a woodblock from VCSL; a 909 kick, clap and hats
recorded from a TR-8 (MckSamplePacks). All three libraries are CC0; scripts/music/samples.md lists every file and
scripts/music/fetch-samples.sh downloads them into public/music/samples.

Synthesis is kept to what a producer adds on top: a sine sub under the kick and the bass, a filtered noise riser,
and the noise in the whoosh and swipe effects. A generated stereo hall and room (convolution), a kick sidechain, a
glue compressor and a 4x-oversampled true-peak limiter master it to cuts.json's `lufs` and `truePeak`.

The arrangement, the sound effects, the silent windows and the breaths (bars where the kick, bass and hats drop out
under brass stabs) come from src/lib/nn-launch/cuts.json, the file the edit reads, so every hit lands on the frame
the picture cuts on: each sample is trimmed so its attack starts exactly on its beat (beat * 22400 samples).

usage: python3 scripts/music/score.py [cut ...]   (default: every cut) -> public/music/<cut>.wav (48 kHz, 24-bit)
Needs numpy, scipy and ffmpeg (to decode the samples). Deterministic: round robins are counters; noise and the
humaniser (inner notes up to 6-12 ms early or late, +-2.5 dB; never a section downbeat, hit, tap, button, breath
edge or sound-effect beat) are seeded.
scripts/music/analyze.py measures a render (loudness per bar, R128, top end, onsets, silences, tail).
"""

import json
import os
import re
import subprocess
import sys
import wave
import zlib
from fractions import Fraction

import numpy as np
from scipy import ndimage, signal

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
CUTS = json.load(open(os.path.join(ROOT, "src", "lib", "nn-launch", "cuts.json")))
SAMPLES = os.path.join(ROOT, "public", "music", "samples")

SR = 48000
BPM = CUTS["bpm"]
BEAT = 60.0 / BPM
SPB = int(round(BEAT * SR))  # samples per beat: 22400
assert abs(BEAT * SR - SPB) < 1e-6, "a beat must be a whole number of samples"
PRE = int(0.001 * SR)  # every prepared sample keeps 1 ms before its attack


def midi_hz(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def at(beat):
    """The sample index of a beat."""
    return int(round(beat * SPB))


# ---------------------------------------------------------------------------------------------- dsp helpers

def sos(kind, freq, order=2):
    return signal.butter(order, freq, btype=kind, fs=SR, output="sos")


def filt(x, kind, freq, order=2):
    return signal.sosfilt(sos(kind, freq, order), x, axis=0)


def shelf(x, freq, gain_db, high=True):
    """RBJ shelving filter (slope 1)."""
    a_ = 10 ** (gain_db / 40)
    w = 2 * np.pi * freq / SR
    c, s = np.cos(w), np.sin(w)
    k = 2 * np.sqrt(a_) * s / 2 * np.sqrt(2)
    if high:
        b = [a_ * ((a_ + 1) + (a_ - 1) * c + k), -2 * a_ * ((a_ - 1) + (a_ + 1) * c), a_ * ((a_ + 1) + (a_ - 1) * c - k)]
        a = [(a_ + 1) - (a_ - 1) * c + k, 2 * ((a_ - 1) - (a_ + 1) * c), (a_ + 1) - (a_ - 1) * c - k]
    else:
        b = [a_ * ((a_ + 1) - (a_ - 1) * c + k), 2 * a_ * ((a_ - 1) - (a_ + 1) * c), a_ * ((a_ + 1) - (a_ - 1) * c - k)]
        a = [(a_ + 1) + (a_ - 1) * c + k, -2 * ((a_ - 1) + (a_ + 1) * c), (a_ + 1) + (a_ - 1) * c - k]
    return signal.lfilter(np.array(b) / a[0], np.array(a) / a[0], x, axis=0)


def lowpass_sweep(x, fc, q=0.707, block=64):
    """Time-varying lowpass on an (n, 2) array; fc is an array of cutoffs (Hz), updated every `block` samples."""
    fc = np.broadcast_to(np.asarray(fc, dtype=np.float64), x.shape[:1])
    y = np.zeros_like(x)
    zi = np.zeros((2, x.shape[1]))
    for i in range(0, len(x), block):
        w = 2 * np.pi * np.clip(fc[i], 20, SR * 0.45) / SR
        alpha = np.sin(w) / (2 * q)
        c = np.cos(w)
        b = np.array([(1 - c) / 2, 1 - c, (1 - c) / 2]) / (1 + alpha)
        a = np.array([1.0, -2 * c / (1 + alpha), (1 - alpha) / (1 + alpha)])
        y[i:i + block], zi = signal.lfilter(b, a, x[i:i + block], axis=0, zi=zi)
    return y


def exp_env(n, tau):
    return np.exp(-np.arange(n) / SR / tau)


def stereo(x):
    return np.stack([x, x], axis=1) if x.ndim == 1 else x


def place(x, pan=0.0, width=1.0):
    """Narrow a stereo recording to `width`, then pan it (constant power, unity in the centre)."""
    x = stereo(x)
    mid = (x[:, 0] + x[:, 1]) / 2
    side = (x[:, 0] - x[:, 1]) / 2 * width
    theta = (pan + 1) * np.pi / 4
    return np.stack([(mid + side) * np.cos(theta) * np.sqrt(2), (mid - side) * np.sin(theta) * np.sqrt(2)], axis=1)


def fade_out(x, seconds):
    f = min(len(x), int(seconds * SR))
    if f:
        x[-f:] *= np.linspace(1, 0, f)[:, None]
    return x


# ---------------------------------------------------------------------------------------------- samples

_RAW = {}


def load(rel):
    """Decode a sample (relative to public/music/samples) to float stereo at 48 kHz with ffmpeg."""
    if rel not in _RAW:
        path = os.path.join(SAMPLES, rel)
        if not os.path.exists(path):
            sys.exit(f"missing sample {path}: run scripts/music/fetch-samples.sh first")
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
                             capture_output=True, check=True).stdout
        _RAW[rel] = np.frombuffer(raw, "<f4").reshape(-1, 2).astype(np.float64)
    return _RAW[rel]


_PREP = {}


def prep(rel, thresh_db=-30.0, norm=None):
    """The sample trimmed to start PRE samples before its attack (its first crossing of thresh_db below its peak),
    with its silent tail cut. norm='rms' levels it on the loudness of its body (for multi-sampled instruments);
    otherwise its peak is 1."""
    key = (rel, thresh_db, norm)
    if key in _PREP:
        return _PREP[key]
    x = load(rel)
    x = x - x.mean(axis=0)
    a = np.abs(x).max(axis=1)
    pk = a.max()
    on = int(np.argmax(a > pk * 10 ** (thresh_db / 20)))
    end = len(a) - int(np.argmax(a[::-1] > pk * 10 ** (-75 / 20)))
    s = max(0, on - PRE)
    y = x[s:end].copy()
    if PRE - (on - s) > 0:
        y = np.concatenate([np.zeros((PRE - (on - s), 2)), y])
    y[:PRE] *= (np.linspace(0, 1, PRE) ** 3)[:, None]
    fade_out(y, 0.01)
    if norm == "rms":
        body = y[PRE:PRE + int(0.35 * SR)]
        y = y * (0.1 / np.sqrt((body ** 2).mean()))
    else:
        y = y / pk
    _PREP[key] = y
    return y


_SHIFT = {}


def shifted(rel, semis, thresh_db=-30.0, norm=None):
    """A prepared sample repitched by resampling (shorter when it goes up, like tape), attack still PRE in."""
    key = (rel, semis, thresh_db, norm)
    if key not in _SHIFT:
        x = prep(rel, thresh_db, norm)
        if abs(semis) < 1e-9:
            y = x
        else:
            ratio = Fraction(2 ** (-semis / 12)).limit_denominator(400)
            y = signal.resample_poly(x, ratio.numerator, ratio.denominator, axis=0)
            pre = int(round(PRE * ratio))
            y = y[pre - PRE:] if pre > PRE else np.concatenate([np.zeros((PRE - pre, 2)), y])
        _SHIFT[key] = y
    return _SHIFT[key]


NOTE_PC = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
# Files whose measured f0 is off their name (an octave, or more than half a semitone): never played.
EXCLUDE = {"MOHorn_stac_C3_v3_rr1.wav", "MOHorn_stac_C3_v2_rr1.wav", "MOHorn_stac_C3_v2_rr2.wav",
           "MOHorn_stac_G1_v1_rr2.wav", "Tuba3_stac_A#0_v2_rr3_Sum.wav", "Tuba3_stac_A#0_v2_rr4_Sum.wav",
           "Tuba3_stac_A#1_v1_rr1_Sum.wav", "Tuba3_stac_F1_v1_rr1_Sum.wav"}


class Multi:
    """A multi-sampled pitched instrument: the files of one folder, keyed by note and dynamic layer, round robins
    in turn. VSCO names notes an octave below scientific pitch (its C3 is middle C, MIDI 60); the measured f0 of
    every file played agrees."""

    def __init__(self, folder, max_shift=3):
        self.folder = folder
        self.notes = {}  # note -> {layer: [files]}
        for f in sorted(os.listdir(os.path.join(SAMPLES, folder))):
            m = re.search(r"_([A-G]#?)(\d)_v(\d)", f)
            if not f.endswith(".wav") or not m or f in EXCLUDE:
                continue
            note = NOTE_PC[m.group(1)] + 12 * (int(m.group(2)) + 2)
            self.notes.setdefault(note, {}).setdefault(int(m.group(3)), []).append(f"{folder}/{f}")
        self.max_shift = max_shift
        self.rr = {}

    def pick(self, note, soft=False):
        """The nearest sampled note; its loudest layer, or the next one down when `soft` (if it has one)."""
        base = min(self.notes, key=lambda n: (abs(n - note), n > note))
        if abs(base - note) > self.max_shift:
            raise ValueError(f"{self.folder}: {note} is {note - base} semitones from the nearest sample")
        layers = sorted(self.notes[base])
        layer = layers[-2] if soft and len(layers) > 1 else layers[-1]
        files = self.notes[base][layer]
        k = self.rr.get((base, layer), 0)
        self.rr[(base, layer)] = k + 1
        return files[k % len(files)], note - base

    def play(self, note, dur, release=0.08, thresh_db=-24.0, soft=False):
        """One note gated after `dur` seconds with an exponential release; (n, 2), attack PRE samples in. A soft
        note uses the quieter, darker dynamic layer, levelled the same and then 2.5 dB down."""
        rel, semis = self.pick(note, soft)
        x = shifted(rel, semis, thresh_db, "rms")
        if soft:
            x = x * 0.75
        g = int(dur * SR) + PRE
        n = min(len(x), g + int(release * 6 * SR))
        x = x[:n].copy()
        if n > g:
            x[g:] *= exp_env(n - g, release)[:, None]
        return fade_out(x, 0.004)


class Kit:
    """Round-robin one-shots: a list of files played in turn."""

    def __init__(self, files, thresh_db=-30.0):
        self.files = files
        self.k = 0
        self.thresh = thresh_db

    def hit(self, semis=0.0, length=None, decay=None):
        rel = self.files[self.k % len(self.files)]
        self.k += 1
        x = shifted(rel, semis, self.thresh).copy()
        if length is not None:
            x = x[:PRE + int(length * SR)]
        if decay is not None:
            x[PRE:] *= exp_env(len(x) - PRE, decay)[:, None]
        return fade_out(x, 0.006)


V = "vsco/Brass"
P = "vsco/Percussion"
C = "vcsl/Idiophones/Struck Idiophones"
M = "vcsl/Membranophones/Struck Membranophones"


def instruments():
    return {
        "tpt": Multi(f"{V}/Trumpet/stac"), "tpt_sus": Multi(f"{V}/Trumpet/sus"),
        "hn": Multi(f"{V}/F Horn/stac"), "hn_sus": Multi(f"{V}/F Horn/sus"),
        "tbn": Multi(f"{V}/Tenor Trombone/stac"), "tbn_sus": Multi(f"{V}/Tenor Trombone/sus"),
        "tuba": Multi(f"{V}/Tuba/stac"), "tuba_sus": Multi(f"{V}/Tuba/sus"),
        "kick": Kit(["mck/TR8/BD/004_909_Bass_Drum_1.wav"]),
        "clap909": Kit(["mck/TR8/PERC/019_909_Hand_Clap.wav"]),
        "claps": Kit([f"{C}/Claps/Clap_rr{k}.wav" for k in range(1, 7)]),
        "hat": Kit(["mck/TR8/HATS/010_909_Closed_HiHat_Short.wav", "mck/TR8/HATS/008_909_Closed_HiHat.wav"]),
        "ohat": Kit(["mck/TR8/HATS/009_909_Open_HiHat_Short.wav", "mck/TR8/HATS/007_909_Open_HiHat.wav"]),
        "snare": {v: Kit([f"{P}/Snare2-HitSN_v{v}_rr1_Sum.wav", f"{P}/Snare2-HitSN_v{v}_rr2_Sum.wav"]) for v in (5, 7, 9)},
        "march": {v: Kit([f"{M}/Snare Drum, Rope Tension/Hi/RopeSnare_hi_sn_Main_vl{v}_rr1.wav"]) for v in (2, 3, 4)},
        "stick": Kit([f"{M}/Snare Drum, Rope Tension/RopeSnare_stick_Main_vl1_rr1.wav"]),
        "tom": Kit([f"{M}/Tom 1/Stick/TomH_HitS_v4_rr1_Mid.wav", f"{M}/Tom 1/Stick/TomH_HitS_v4_rr2_Mid.wav"]),
        "bd": Kit([f"{P}/BDrumNewhit_v7_rr1_Sum.wav", f"{P}/BDrumNewhit_v7_rr2_Sum.wav"]),
        "crash": Kit([f"{P}/cymbal-crash1_ff_rr1.wav", f"{P}/cymbal-crash1_ff_rr2.wav"]),
        "swell": Kit([f"{P}/susCymb1-cresc-Short_v1.wav"]),
        "swell_long": Kit([f"{P}/susCymb1-cresc-Median_v1.wav"]),
        "gong": Kit([f"{P}/gongHit_fff.wav"]),
        "timp_roll": Kit([f"{P}/Timpani/Rolls/Timpani1_Roll_v5_rr1_Sum.wav"]),
        "slap": Kit([f"{C}/Slapstick/slapstick_rr1.wav", f"{C}/Slapstick/slapstick_rr2.wav", f"{C}/Slapstick/slapstick_rr3.wav"], -12),
        "wood": Kit([f"{C}/Woodblock/wood_click_f_rr1.wav", f"{C}/Woodblock/wood_click_f_rr2.wav"], -12),
        "wood_soft": Kit([f"{C}/Woodblock/wood_click3_vl2.wav"], -12),
    }


# Timpani: each drum's principal (1,1) mode, measured from its partials (1 : 1.5 : 2 : 2.44), retuned to the key.
TIMPANI = {  # note -> (file, measured principal as MIDI)
    41: (f"{P}/Timpani/Timpani1_Hit_v3_rr1_Sum.wav", 41.9),
    48: (f"{P}/Timpani/Timpani3_Hit_v4_rr1_Sum.wav", 49.5),
    53: (f"{P}/Timpani/Timpani4_Hit_v4_rr1_Sum.wav", 52.5),
}


def timpani(note, length=None, decay=None):
    rel, principal = TIMPANI[note]
    x = shifted(rel, round((note - principal) * 4) / 4).copy()
    if length is not None:
        x = x[:PRE + int(length * SR)]
    if decay is not None:
        x[PRE:] *= exp_env(len(x) - PRE, decay)[:, None]
    return fade_out(x, 0.01)


# ---------------------------------------------------------------------------------------------- synthesis kept on purpose

RNG = np.random.default_rng(67)


def sub(note, dur, drop=1.5, tau=0.2, level=1.0):
    """A sine sub with a short pitch drop (under the kick and the bass); attack PRE samples in."""
    n = int((dur + 0.05) * SR)
    t = np.arange(n) / SR
    f = midi_hz(note) * (1 + drop * np.exp(-t / 0.018))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / tau)
    g = int(dur * SR)
    x[g:] *= np.linspace(1, 0, n - g)
    x[:48] *= np.linspace(0, 1, 48)
    x = signal.sosfilt(sos("highpass", 35, 2), x)  # nothing below 35 Hz
    return np.concatenate([np.zeros(PRE), x]) * level * 0.79


def noise_riser(beats, level=1.0):
    """Band-passed noise sweeping up, rising to its end; attack PRE samples in."""
    n = at(beats)
    p = np.arange(n) / n
    x = RNG.standard_normal((n, 2))
    fc = 250 * (32 ** p)
    y = np.zeros_like(x)
    zi = np.zeros((2, 2))
    for i in range(0, n, 64):
        w = 2 * np.pi * min(fc[i], SR * 0.45) / SR
        alpha = np.sin(w) / (2 * 2.5)
        b = np.array([alpha, 0, -alpha]) / (1 + alpha)
        a = np.array([1, -2 * np.cos(w) / (1 + alpha), (1 - alpha) / (1 + alpha)])
        y[i:i + 64], zi = signal.lfilter(b, a, x[i:i + 64], axis=0, zi=zi)
    y = filt(y, "lowpass", 7000) * (p ** 2.2)[:, None] * 0.5 * level
    return np.concatenate([np.zeros((PRE, 2)), fade_out(y, 0.005)])


def noise_whoosh(dur, lo, hi, level=1.0):
    n = int(dur * SR)
    p = np.arange(n) / n
    x = filt(RNG.standard_normal(n), "bandpass", [lo, hi])
    shape = np.sin(np.pi * p ** 0.8) ** 2
    return np.stack([x * shape * np.sqrt(1 - p), x * shape * np.sqrt(p)], axis=1) * level


# ---------------------------------------------------------------------------------------------- the mix

class Mix:
    BUSES = ["drums", "bass", "brass", "bed", "fx", "sfx"]

    def __init__(self, name):
        self.name = name
        self.cut = CUTS["cuts"][name]
        self.n = at(self.cut["beats"]) + 6 * SR
        self.bus = {k: np.zeros((self.n, 2)) for k in self.BUSES}
        self.hall = np.zeros((self.n, 2))
        self.room = np.zeros((self.n, 2))
        self.kicks = []
        self.sweeps = []  # (buses, start beat, end beat, from Hz, to Hz)
        self.trims = []  # (start beat, end beat, dB): mix automation
        self.gates = []  # (buses, start beat, end beat): silenced (breaths)
        self.inst = instruments()
        self.rng = np.random.default_rng(zlib.crc32(name.encode()))  # the humaniser, seeded per cut
        self.breaths = [tuple(b) for b in self.cut.get("breaths", [])]
        self.protected = set()  # beats that are never moved: section downbeats, hits, taps, button, slams

    def in_breath(self, beat):
        return any(a <= beat < b for a, b in self.breaths)

    def human(self, beat, ms):
        """(beat, gain) for an inner note: up to +-ms late or early and +-2.5 dB, never on a protected beat."""
        if any(abs(beat - p) < 1e-9 for p in self.protected):
            return beat, 1.0
        return beat + self.rng.uniform(-ms, ms) / 1000 / BEAT, 10 ** (self.rng.uniform(-2.5, 2.5) / 20)

    def add(self, bus, x, beat, gain=1.0, pan=0.0, width=1.0, hall=0.0, room=0.0):
        """Add x (attack PRE samples in) so that its attack lands exactly on `beat`."""
        x = place(x, pan, width) * gain
        i = at(beat) - PRE
        if i < 0:
            x, i = x[-i:], 0
        x = x[: self.n - i]
        self.bus[bus][i:i + len(x)] += x
        if hall:
            self.hall[i:i + len(x)] += x * hall
        if room:
            self.room[i:i + len(x)] += x * room

    def kick(self, beat, level=1.0):
        if self.in_breath(beat):
            return
        if not hasattr(self, "_kick"):  # the 909's body peaks near 58 Hz: trim what sits below it
            self._kick = shelf(filt(self.inst["kick"].hit(), "highpass", 42), 70, -2.5, high=False)
        self.add("drums", self._kick, beat, 0.9 * level)
        self.add("drums", sub(29, 0.2, tau=0.12, level=0.12 * level), beat)
        self.kicks.append(beat)


# F minor: Fm - Db - Ab - Eb, one chord a bar.
ROOTS = [41, 37, 44, 39]  # F2 Db2 Ab2 Eb2
CHORDS = [[65, 68, 72], [65, 68, 73], [63, 68, 72], [63, 67, 70]]  # close around F4
RIFF = [(0, 0, 2), (3, 0, 2), (6, 1, 2), (10, 0, 1), (12, 2, 2), (14, 1, 2)]  # (16th, chord tone, 16ths): tresillo
MELODY = [  # drop B lead, per bar: (16th, midi, 16ths)
    [(0, 72, 3), (3, 72, 3), (6, 75, 2), (8, 77, 6), (14, 75, 2)],
    [(0, 73, 3), (3, 72, 3), (6, 70, 2), (8, 68, 8)],
    [(0, 75, 3), (3, 75, 3), (6, 77, 2), (8, 80, 6), (14, 79, 2)],
    [(0, 79, 3), (3, 77, 3), (6, 75, 2), (8, 79, 8)],
]
SEC = {"tpt": (0.15, 0.55), "hn": (-0.45, 0.6), "tbn": (0.45, 0.5), "tuba": (0.1, 0.4)}  # (pan, width)
SEC_GAIN = {"tpt": 0.85, "hn": 0.8, "tbn": 0.75, "tuba": 0.8}


def voicing(ci, top=False):
    ch = CHORDS[ci]
    v = {"tpt": [ch[1], ch[2]], "hn": [c - 12 for c in ch], "tbn": [ROOTS[ci] + 12, ROOTS[ci] + 19], "tuba": [ROOTS[ci]]}
    if top:
        v["tpt"] = v["tpt"] + [ch[0] + 12]
    return v


def tutti(m, ci, beat, beats, level=1.0, top=False, sus=False, release=0.08, hall=0.22, lp=None, voices=None,
          human=0.0, soft=False):
    """A brass chord across the sections: staccato samples for stabs (brass bus), sustains for held chords (bed).
    human=ms lets each player land up to that early or late and vary by +-2.5 dB (not on protected beats)."""
    for sec, notes in (voices or voicing(ci, top)).items():
        pan, width = SEC[sec]
        inst = m.inst[sec + "_sus"] if sus else m.inst[sec]
        for k, note in enumerate(notes):
            x = inst.play(note, beats * BEAT, release, soft=soft and not sus)
            if lp:
                x = filt(x, "lowpass", lp)
            off = (k - (len(notes) - 1) / 2) * 0.12
            t, g = m.human(beat, human) if human else (beat, 1.0)
            m.add("bed" if sus else "brass", x, t, g * SEC_GAIN[sec] * level / len(notes) ** 0.35, pan + off, width,
                  hall=hall)


def stop_before(cut, a, b):
    """The first silence window starting in (a, b], else b."""
    starts = [s for s, _ in cut.get("silence", []) if a < s <= b]
    return min(starts) if starts else b


def crash(m, beat, level=1.0, length=3.0, decay=1.0):
    """A pair of orchestral clash cymbals, damped (they ring for ten seconds undamped)."""
    x = m.inst["crash"].hit(length=length, decay=decay)
    m.add("fx", x, beat, 0.65 * level, pan=-0.25, width=0.8, hall=0.15)


def impact(m, beat, level=1.0, ring=None, decay=None):
    """Concert bass drum + low timpani + a sub boom."""
    m.add("fx", m.inst["bd"].hit(length=ring, decay=decay), beat, 0.9 * level, hall=0.25)
    m.add("fx", timpani(41, length=ring, decay=decay), beat, 0.55 * level, pan=-0.1, hall=0.2)
    m.add("fx", sub(29, min(ring or 1.0, 1.0), drop=2.0, tau=0.45, level=0.6 * level), beat)


def snare_roll(m, a, b, v0=0.3, v1=1.0, gain=0.7):
    """A march roll from beat a to b: 8ths, then 16ths, then 32nds over its last quarter, crescendo."""
    times, t = [], a
    while t < b - 1e-9:
        p = (t - a) / (b - a)
        times.append(t)
        t += 0.5 if p < 0.5 else 0.25 if p < 0.75 else 0.125
    for k, tt in enumerate(times):
        v = v0 + (v1 - v0) * ((tt - a) / (b - a)) ** 1.3
        x = m.inst["march"][2 if v < 0.45 else 3 if v < 0.75 else 4].hit()
        m.add("drums", x, tt, gain * v, pan=0.05 * (-1) ** k, room=0.25)


def timp_roll(m, a, b, level=1.0):
    """The sampled timpani roll, swelled from nothing to `level` and cut at b."""
    x = m.inst["timp_roll"].hit()[:PRE + at(b) - at(a)].copy()
    x *= (np.linspace(0, 1, len(x)) ** 2)[:, None]
    m.add("fx", fade_out(x, 0.01), a, 0.9 * level, pan=-0.15, hall=0.2)


def swell(m, b, beats, level=1.0):
    """A suspended-cymbal crescendo whose loudest point lands on beat b (cut there)."""
    x = prep(m.inst["swell" if beats <= 4 else "swell_long"].files[0])
    pk = int(np.argmax(np.abs(x).max(axis=1)))
    y = fade_out(x[max(0, pk - at(beats)):pk].copy(), 0.008)
    y = shelf(filt(y, "lowpass", 11000), 6000, -4)
    m.add("fx", np.concatenate([np.zeros((PRE, 2)), y]), b - len(y) / SPB, 0.45 * level, pan=0.3, hall=0.2)


def reverse_crash(m, end, beats=1.5, level=1.0):
    """The head of a crash, reversed, ending on beat `end`."""
    rev = prep(m.inst["crash"].files[1])[:at(beats)][::-1].copy()
    rev = shelf(filt(rev, "lowpass", 9000), 5000, -4)
    m.add("fx", np.concatenate([np.zeros((PRE, 2)), fade_out(rev, 0.004)]), end - beats, 0.18 * level, pan=0.2, hall=0.1)


# ---------------------------------------------------------------------------------------------- sections

def play_hook(m, bar0, bars):
    """Bar 1: four brass stabs and a kick, nothing else (no crash, no impact: drop A gets to hit). Bar 2: a march
    snare roll, a timpani roll, a cymbal swell and a riser over a soft held horn chord; no kick."""
    b0 = 4 * bar0
    for k in range(4):
        tutti(m, 0 if k < 3 else 3, b0 + k, 0.55, level=0.48, top=True, hall=0.25, human=12)
        m.kick(b0 + k, 0.6)
    if bars < 2:
        return
    b1 = b0 + 4
    end = stop_before(m.cut, b1, b1 + 4)
    snare_roll(m, b1, end, 0.3, 0.85, gain=0.45)
    timp_roll(m, b1, end, 0.4)
    swell(m, end, end - b1, 0.5)
    m.add("fx", noise_riser(end - b1, 0.3), b1)
    tutti(m, 3, b1, end - b1 - 0.25, level=0.35, sus=True, release=0.12, hall=0.35, lp=2500,
          voices={"hn": [c - 12 for c in CHORDS[3]], "tuba": [ROOTS[3]]})


def play_drop(m, bar0, bars, big, nxt=None):
    """Four-on-the-floor under a brass riff over a held brass bed. Drop A opens half-time and filtered for two
    bars, then sits 2.5 dB under drop B; drop B is the biggest section: an impact on its downbeat, trumpets doubled at
    the octave, a lead line, 16th and open hats. The last bar of every four has a fill in place of its fourth kick.
    Inside a breath (cuts.json `breaths`) the kick, bass, hats, bed, riff and lead stop and brass stabs hit every
    beat over the claps and a march snare; everything slams back on its end beat with a crash."""
    I = m.inst
    B0 = 4 * bar0
    if big:
        impact(m, B0, 1.0)
    else:
        impact(m, B0, 0.5)
        m.sweeps.append((("brass", "bed"), B0, B0 + 8, 600, 16000))
        m.trims.append((B0 + 8, B0 + 4 * bars, -2.5))  # its half-time opening is already smaller
    breath = m.in_breath
    for i in range(bars):
        B = B0 + 4 * i
        ci = i % 4
        fill = i % 4 == 3
        half = (not big) and i < 2
        if ci == 0:
            crash(m, B, 1.0 if i == 0 else 0.75)
        for k in range(4):
            if (half and k in (1, 3)) or (fill and k == 3):
                continue
            m.kick(B + k)
        for k in ((2,) if half else (1, 3)):
            if fill and k == 3:
                continue
            m.add("drums", I["claps"].hit(), B + k, 0.5, pan=0.1, width=0.7, room=0.3)
            m.add("drums", I["clap909"].hit(), B + k, 0.32, room=0.15)
            m.add("drums", I["snare"][7].hit(length=0.25, decay=0.09), B + k, 0.32, room=0.25)
        hats = []  # (beat, kit, level, pan, length)
        for k in range(4):
            if half:
                hats.append((B + k + 0.5, "hat", 0.18, 0.3, None))
            elif big:
                hats.append((B + k + 0.5, "ohat", 0.5, 0.3, 0.22))
                hats += [(B + k + s, "hat", 0.24, -0.3, None) for s in (0.25, 0.75)]
            else:
                hats += [(B + k + 0.5, "hat", 0.4, 0.3, None), (B + k + 0.75, "hat", 0.16, -0.3, None)]
        for t, kit, level, pan, length in hats:
            if breath(t):
                continue
            x = I[kit].hit(length=length, decay=None if length is None else 0.08)
            t, g = m.human(t, 6)
            m.add("drums", x, t, level * g, pan=pan, room=0.1 if kit == "ohat" else 0.0)
        if fill:
            for s in range(8):  # snare 16ths over beats 3-4, timpani and toms answering
                m.add("drums", I["snare"][5 if s < 4 else 7 if s < 6 else 9].hit(length=0.3, decay=0.1),
                      B + 2 + s * 0.25, 0.22 + 0.05 * s, pan=0.15 * (-1) ** s, room=0.3)
            m.add("fx", timpani(48, length=0.5, decay=0.15), B + 3, 0.5, pan=-0.2, hall=0.15)
            m.add("fx", timpani(41, length=0.5, decay=0.15), B + 3.5, 0.55, pan=-0.2, hall=0.15)
            m.add("drums", I["tom"].hit(-2, length=0.4, decay=0.12), B + 3.25, 0.35, pan=0.3, room=0.3)
            m.add("drums", I["tom"].hit(-5, length=0.4, decay=0.12), B + 3.75, 0.35, pan=0.1, room=0.3)
        # bass: tuba staccato and a sine sub on the off-beat 8ths (16th pickups an octave up in drop B)
        root = ROOTS[ci]
        if half:
            m.add("bass", I["tuba_sus"].play(root, 3.8 * BEAT, 0.2), B, 0.6)
            m.add("bass", sub(root - 12, 3.8 * BEAT, drop=0.0, tau=3.0, level=0.2), B)
        else:
            for s in [0.5, 1.5, 2.5, 3.5] + ([1.75, 3.75] if big else []):
                if breath(B + s):
                    continue
                pickup = s in (1.75, 3.75)
                m.add("bass", I["tuba"].play(root + (12 if pickup else 0), 0.22, 0.04, soft=pickup), B + s, 0.75,
                      pan=0.05)
                if not pickup:
                    m.add("bass", sub(root - 12, 0.2, drop=0.0, tau=0.5, level=0.2), B + s)
        # held bed: horns and a trombone, sidechained to the kick
        if not breath(B):
            tutti(m, ci, B, 3.85, level=0.55 if big else 0.42, sus=True, release=0.12, hall=0.3, lp=3500,
                  voices={"hn": [c - 12 for c in CHORDS[ci]], "tbn": [ROOTS[ci] + 12]})
        # the riff: accents on the loudest layer, the rest (all of drop A but its first note) on the softer one
        for step, idx, length in RIFF:
            t = B + step / 4
            if breath(t):
                continue
            note = CHORDS[ci][idx]
            v = {"tpt": [note], "hn": [note - 12]}
            if big:
                v = {"tpt": [note, note + 12], "hn": [note - 12], "tbn": [note - 24 + (12 if note - 24 < 46 else 0)]}
            soft = step in (3, 10, 14) if big else step != 0
            tutti(m, ci, t, length / 4 * 0.85, level=0.9 if big else 0.7, hall=0.18, voices=v, human=10, soft=soft)
        if big:  # the lead: sustained trumpet with a staccato front and a trombone an octave below
            for step, note, length in MELODY[ci]:
                t = B + step / 4
                if breath(t):
                    continue
                d = length / 4 * 0.92 * BEAT
                t, g = m.human(t, 8)
                m.add("brass", I["tpt_sus"].play(note, d, 0.1), t, 0.55 * g, pan=-0.05, width=0.5, hall=0.3)
                m.add("brass", I["tpt"].play(note, min(d, 0.18), 0.05), t, 0.35 * g, pan=-0.05, width=0.5)
                m.add("brass", I["tbn_sus"].play(note - 12, d, 0.1), t, 0.3 * g, pan=0.35, width=0.5, hall=0.25)
    for a, b in m.breaths:
        if not B0 <= a < B0 + 4 * bars:
            continue
        for t in np.arange(np.ceil(a), b):  # stabs on every beat, a march snare under them
            ci = int(t - B0) // 4 % 4
            tutti(m, ci, t, 0.45, level=1.0 if big else 0.85, top=big, hall=0.25, human=10)
            m.add("drums", I["march"][3].hit(), t, 0.45, pan=0.05, room=0.3)
        m.gates.append((("bass", "bed"), a, b))
        if b < B0 + 4 * bars:  # the slam back
            crash(m, b, 1.0)
            if b not in m.kicks:
                m.kick(b)
    end = B0 + 4 * bars
    reverse_crash(m, stop_before(m.cut, end - 2, end), level=0.5 if nxt == "break" else 1.0)


def play_break(m, bar0, bars):
    """A held, dark horn chord, a muted heartbeat and echoing trumpet plucks; then a march roll, a timpani roll, a
    cymbal swell and a riser that stop dead where cuts.json asks for silence."""
    I = m.inst
    B0 = 4 * bar0
    end = stop_before(m.cut, B0, B0 + 4 * bars)
    impact(m, B0, 0.45, ring=2.0, decay=0.5)  # the fill lands here, then everything falls away
    crash(m, B0, 0.55, length=2.5, decay=0.6)
    m.kick(B0, 0.9)
    for i in range(bars):
        B = B0 + 4 * i
        ci = i % 4
        last = i == bars - 1
        tutti(m, ci, B, min(end, B + 4) - B - 0.1, level=0.2, sus=True, release=0.1, hall=0.45, lp=1800,
              voices={"hn": [c - 12 for c in CHORDS[ci]], "tuba": [ROOTS[ci]]})
        for k in ((1.5,) if i == 0 else (0, 1.5)):
            if B + k < end:
                m.add("drums", filt(I["kick"].hit(), "lowpass", 220), B + k, 0.35)
        for s in range(8):
            t = B + s * 0.5
            if t >= end - 0.25 or (last and s >= 4):
                continue
            note = CHORDS[ci][s % 3] + 12 * (s % 2)
            m.add("brass", filt(I["tpt"].play(note, 0.12, 0.05), "lowpass", 3000), t, 0.15,
                  pan=0.5 * (-1) ** s, width=0.4, hall=0.6)
    B1 = B0 + 4 * (bars - 1)
    snare_roll(m, B1, end, 0.2, 0.6, gain=0.4)
    timp_roll(m, B1, end, 0.3)
    swell(m, end, end - B1, 0.45)
    m.add("fx", noise_riser(end - B1, 0.3), B1)


def end_marks(bar0, bars):
    """The end section's march taps and final button (beats)."""
    if bars >= 3:
        tl = 4 * (bar0 + bars - 2)
        return [tl, tl + 1, tl + 2], tl + 3
    return [], 4 * (bar0 + 1)


def play_end(m, bar0, bars):
    """A huge hit on the downbeat whose chord rings; march taps and a final brass button; then it rings out.
    N >= 3 bars: taps on beats 1-3 of bar N-1 and the button on its beat 4. N == 2: the button on bar 2's downbeat."""
    I = m.inst
    B0 = 4 * bar0
    taps, button = end_marks(bar0, bars)
    ring = (taps[0] if taps else button) - B0  # beats the hit's chord rings
    impact(m, B0, 1.2, ring=ring * BEAT, decay=ring * BEAT / 4)
    crash(m, B0, 1.1, length=ring * BEAT, decay=ring * BEAT / 3.5)
    m.kick(B0, 1.1)
    m.add("fx", I["gong"].hit(length=ring * BEAT, decay=ring * BEAT / 4), B0, 0.25, pan=-0.3, hall=0.2)
    tutti(m, 0, B0, 0.6, level=1.2, top=True, hall=0.3)
    tutti(m, 0, B0, ring - 1.5, level=0.9, sus=True, release=0.3, hall=0.35,
          voices={"tpt": [68, 72, 77], "hn": [53, 56, 60], "tbn": [53, 60], "tuba": [41, 29]})
    for t in taps:
        m.add("drums", I["march"][3].hit(), t, 0.5, pan=0.05, room=0.35)
    tutti(m, 0, button, 0.4, level=1.2, top=True, release=0.06, hall=0.3)
    m.kick(button, 1.1)
    tail = (m.cut["beats"] - button) * BEAT - 0.05
    d = min(0.3, tail / 9)  # everything rings down below -60 dB by the end of the file
    m.add("fx", timpani(41, length=tail, decay=d), button, 0.7, pan=-0.1, hall=0.2)
    m.add("fx", timpani(53, length=tail, decay=d * 0.85), button, 0.35, pan=0.1, hall=0.2)
    m.add("fx", I["bd"].hit(length=tail, decay=d), button, 0.5, hall=0.2)
    crash(m, button, 0.45, length=tail, decay=d * 1.1)


# ---------------------------------------------------------------------------------------------- sound effects
# cuts.json sfx kinds: stamp, whoosh, click, key, swipe, impact, riser (len in beats), pop, thud.

def sfx_stamp(I):
    """A rubber stamp: a slapstick crack over a short, low concert-bass-drum thud."""
    slap = filt(I["slap"].hit(length=0.12, decay=0.035), "bandpass", [500, 6000])
    thud = filt(I["bd"].hit(length=0.25, decay=0.07), "lowpass", 900)
    x = np.zeros((max(len(slap), len(thud)), 2))
    x[:len(slap)] += slap * 0.45
    x[:len(thud)] += thud * 0.9
    return x


def sfx_click(I):
    return filt(I["wood"].hit(3.0, length=0.04, decay=0.008), "highpass", 1500) * 0.35


def sfx_key(I):
    return filt(I["stick"].hit(length=0.05, decay=0.012), "highpass", 800) * 0.35


def sfx_pop(I):
    return filt(I["wood_soft"].hit(5.0, length=0.08, decay=0.02), "highpass", 600) * 0.4


def sfx_thud(I):
    return filt(I["bd"].hit(length=0.35, decay=0.1), "lowpass", 400) * 0.8


def sfx_whoosh(I):
    x = noise_whoosh(0.42, 350, 4500, 0.3)
    rev = prep(I["crash"].files[0])[:len(x)][::-1]
    rev = filt(rev, "bandpass", [600, 7000]) * np.sin(np.pi * np.linspace(0, 1, len(rev)))[:, None]
    return np.concatenate([np.zeros((PRE, 2)), x + rev * 0.25])


def sfx_swipe(I):
    return np.concatenate([np.zeros((PRE, 2)), noise_whoosh(0.3, 900, 5500, 0.18)])


SFX = {"stamp": sfx_stamp, "click": sfx_click, "key": sfx_key, "pop": sfx_pop, "thud": sfx_thud,
       "whoosh": sfx_whoosh, "swipe": sfx_swipe}


def play_sfx(m, cue):
    kind, beat, level, pan = cue["kind"], cue["beat"], cue.get("gain", 1.0), cue.get("pan", 0.0)
    if kind == "impact":
        impact(m, beat, 0.8 * level, ring=1.2, decay=0.3)
    elif kind == "riser":
        m.add("sfx", noise_riser(cue.get("len", 1), 0.6 * level), beat, pan=pan)
    else:
        m.add("sfx", SFX[kind](m.inst), beat, level, pan=pan, room=cue.get("verb", 0.08))


# ---------------------------------------------------------------------------------------------- mastering

def make_ir(rt60, predelay, seed, hf_ratio=0.45, lf_ratio=1.1):
    """A stereo reverb impulse: decorrelated noise in three bands with their own decay, plus early reflections."""
    rng = np.random.default_rng(seed)
    n = int(rt60 * 1.3 * SR)
    t = np.arange(n) / SR
    x = rng.standard_normal((n, 2))
    lo = filt(x, "lowpass", 400)
    hi = filt(x, "highpass", 3500)
    mid = x - lo - hi
    ir = sum(b * (10 ** (-3 * t / (rt60 * r)))[:, None] for b, r in ((lo, lf_ratio), (mid, 1.0), (hi, hf_ratio)))
    ir *= np.clip(t / 0.012, 0, 1)[:, None]
    for k, (d, g) in enumerate([(0.007, 0.5), (0.011, 0.4), (0.017, 0.33), (0.023, 0.27), (0.031, 0.2)]):
        ir[int(d * SR), k % 2] += g * 8
        ir[int((d + 0.0013) * SR), 1 - k % 2] += g * 6
    ir = np.concatenate([np.zeros((int(predelay * SR), 2)), ir])
    return ir / np.sqrt((ir ** 2).sum(axis=0))


def sidechain(n, kicks, release=0.13):
    """1 - (duck shape) after each kick: 0 at the kick, back to 1 over ~3 release times."""
    g = np.ones(n)
    shape = 1 - np.exp(-np.arange(int(release * 5 * SR)) / SR / release)
    for k in kicks:
        i = at(k)
        j = min(n, i + len(shape))
        g[i:j] = np.minimum(g[i:j], shape[: j - i])
    return signal.sosfiltfilt(sos("lowpass", 90, 1), g)


def compress(x, thresh_db, ratio, attack=0.01, release=0.15):
    """A feed-forward RMS compressor (stereo linked)."""
    a = np.exp(-1 / (attack * SR))
    lvl = signal.lfilter([1 - a], [1, -a], (x ** 2).mean(axis=1))
    gr = np.maximum(0, 10 * np.log10(lvl + 1e-12) - thresh_db) * (1 - 1 / ratio)
    r = np.exp(-1 / (release * SR))
    gr = np.maximum(gr, signal.lfilter([1 - r], [1, -r], gr))
    return x * 10 ** (-gr / 20)[:, None]


def true_peak(x):
    """Per-sample peak of the 4x-oversampled signal (as ITU-R BS.1770 true peak)."""
    up = signal.resample_poly(x, 4, 1, axis=0)
    return np.abs(up).max(axis=1)[: 4 * len(x)].reshape(len(x), 4).max(axis=1)


def limit(x, ceiling_db, look=0.0015, release=0.06):
    """A true-peak limiter: 4x-oversampled peaks, gain ramped in over `look` before each one, exponential release."""
    for _ in range(6):
        over = np.maximum(0, 20 * np.log10(true_peak(x) + 1e-12) - ceiling_db)
        if over.max() <= 0:
            break
        L = int(look * SR)
        s = ndimage.uniform_filter1d(ndimage.maximum_filter1d(over, 2 * L + 1), L + 1)
        r = np.exp(-1 / (release * SR))
        gr = np.maximum(s, signal.lfilter([1 - r], [1, -r], s)) + 0.01
        x = x * 10 ** (-gr / 20)[:, None]
    return x


def k_weight(x):
    b1, a1 = [1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585]
    b2, a2 = [1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621]
    return signal.lfilter(b2, a2, signal.lfilter(b1, a1, x, axis=0), axis=0)


def lufs(x):
    """ITU-R BS.1770-4 integrated loudness (400 ms blocks, 75% overlap, absolute and relative gates)."""
    p = (k_weight(x) ** 2).sum(axis=1)
    c = np.concatenate([[0], np.cumsum(p)])
    block, hop = int(0.4 * SR), int(0.1 * SR)
    starts = np.arange(0, len(p) - block + 1, hop)
    ms = (c[starts + block] - c[starts]) / block
    ms = ms[ms > 10 ** ((-70 + 0.691) / 10)]
    rel = -0.691 + 10 * np.log10(ms.mean()) - 10
    ms = ms[(-0.691 + 10 * np.log10(ms)) > rel]
    return -0.691 + 10 * np.log10(ms.mean())


def silence(x, windows, fade=0.003):
    """Digital zero inside each [start, end) window (beats), with a short fade into it."""
    f = int(fade * SR)
    for a, b in windows:
        i, j = at(a), at(b)
        k = min(f, i)
        x[i - k:i] *= np.linspace(1, 0, k)[:, None]
        x[i:j] = 0.0
    return x


# ---------------------------------------------------------------------------------------------- render

def render(name):
    m = Mix(name)
    cut = m.cut
    beats = cut["beats"]
    bar = 0
    for kind, bars in cut["arrangement"]:  # beats the humaniser never moves
        m.protected.add(4 * bar)
        if kind == "end":
            taps, button = end_marks(bar, bars)
            m.protected.update(taps + [button])
        bar += bars
    m.protected.update(b for a, b in m.breaths)
    m.protected.update(a for a, b in m.breaths)
    m.protected.update(c["beat"] for c in cut.get("sfx", []))
    bar = 0
    kinds = [k for k, _ in cut["arrangement"]] + [None]
    for s, (kind, bars) in enumerate(cut["arrangement"]):
        if kind == "hook":
            play_hook(m, bar, bars)
        elif kind in ("dropA", "dropB"):
            play_drop(m, bar, bars, big=kind == "dropB", nxt=kinds[s + 1])
        elif kind == "break":
            play_break(m, bar, bars)
        elif kind == "end":
            play_end(m, bar, bars)
        else:
            raise ValueError(kind)
        bar += bars
    for cue in cut.get("sfx", []):
        play_sfx(m, cue)

    n, B = m.n, m.bus
    for buses, a, b, f0, f1 in m.sweeps:  # drop A: a lowpass that opens over its first two bars
        i, j = at(a), at(b)
        fc = f0 * (f1 / f0) ** ((np.arange(j - i) / (j - i)) ** 2)
        for k in buses:
            B[k][i:j] = lowpass_sweep(B[k][i:j], fc)
    ramp = int(0.005 * SR)
    for buses, a, b in m.gates:  # breaths: the bass and the bed stop, with 5 ms fades
        g = np.ones(n)
        i, j = at(a), at(b)
        g[i:j] = 0.0
        g[i - ramp:i] = np.linspace(1, 0, ramp)
        g[j - ramp:j] = np.linspace(0, 1, ramp)
        for k in buses:
            B[k] *= g[:, None]
    sc = sidechain(n, m.kicks)
    B["bass"] *= (1 - 0.8 * (1 - sc))[:, None]
    B["bed"] *= (1 - 0.6 * (1 - sc))[:, None]
    B["drums"] = filt(B["drums"], "highpass", 35)
    B["bass"] = filt(B["bass"], "lowpass", 2500)
    B["brass"] = compress(B["brass"], -22, 2.0, 0.008, 0.12)
    B["fx"] = shelf(B["fx"], 8000, -1.5)
    hall = signal.oaconvolve(m.hall * (1 - 0.4 * (1 - sc))[:, None], make_ir(1.7, 0.022, 1), axes=0)[:n]
    room = signal.oaconvolve(m.room, make_ir(0.6, 0.008, 2, hf_ratio=0.5), axes=0)[:n]
    hall = shelf(filt(filt(hall, "highpass", 220), "lowpass", 9500), 3000, -1.5)
    room = filt(filt(room, "highpass", 180), "lowpass", 8000)
    mix = (B["drums"] + B["bass"] * 0.8 + B["brass"] * 1.1 + B["bed"] * 0.8 + B["fx"] * 0.8 + B["sfx"] * 0.9
           + hall * 0.55 + room * 0.45)
    mix = shelf(filt(mix, "highpass", 25, 2), 10000, 1.5)[: at(beats)]
    ramp = int(0.01 * SR)
    for a, b, db in m.trims:  # mix automation, ramped over the 10 ms before each boundary
        g = np.ones(len(mix))
        i, j = at(a), min(at(b), len(mix))
        g[i:j] = 10 ** (db / 20)
        g[i - ramp:i] = np.linspace(1, 10 ** (db / 20), ramp)
        g[j - ramp:j] = np.linspace(10 ** (db / 20), 1, ramp)
        mix *= g[:, None]
    mix = silence(mix, cut.get("silence", []))

    # master: glue compression, then iterate the gain into the true-peak limiter until the loudness target holds
    target, tp = CUTS.get("lufs", -11.0), CUTS.get("truePeak", -1.0)
    mix = compress(mix, -16, 2.0, 0.015, 0.2)
    gain = target - lufs(mix)
    for _ in range(10):
        out = limit(mix * 10 ** (gain / 20), tp - 0.3)
        loud = lufs(out)
        if abs(loud - target) < 0.03:
            break
        gain += target - loud
    out = silence(out, cut.get("silence", []))
    f = int(0.02 * SR)  # only the last 20 ms are faded
    out[-f:] *= (np.linspace(1, 0, f) ** 2)[:, None]
    peak = 20 * np.log10(true_peak(out).max())
    if peak > tp - 0.1:
        out *= 10 ** ((tp - 0.1 - peak) / 20)
    write(os.path.join(ROOT, "public", "music", f"{name}.wav"), out)
    print(f"{name}: {beats * BEAT:.2f}s, {lufs(out):.2f} LUFS, true peak {20 * np.log10(true_peak(out).max()):.2f} dBTP"
          f", limiter input gain {gain:+.1f} dB")


def write(path, x):
    """48 kHz stereo 24-bit PCM, no dither (so silence stays digital zero)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    pcm = np.clip(np.round(x * 8388607), -8388608, 8388607).astype("<i4")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(3)
        w.setframerate(SR)
        w.writeframes(np.ascontiguousarray(pcm).view(np.uint8).reshape(-1, 4)[:, :3].tobytes())


if __name__ == "__main__":
    for cut_name in sys.argv[1:] or list(CUTS["cuts"].keys()):
        render(cut_name)
