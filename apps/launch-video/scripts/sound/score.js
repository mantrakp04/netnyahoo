// The launch video's score and effects, synthesized with WebAudio (OfflineAudioContext), timed to
// src/timeline.ts. A pompous campaign-ad march (brass, snare, timpani) under the opener and pledges,
// a record scratch and power-down at "And when the Wi-Fi dies", a game-show clock under "Find him.",
// a triumphant sting under "Impeach Chrome." with the INCUMBENT stamp as the hard hit, and a snare
// roll in the bridge that lands on frame 0's fanfare.
//
// renderScore(B, total, fps, sampleRate) renders the timeline twice and returns the second pass, so
// every tail that crosses the loop point is already in the first samples (the loop is seamless).
// Runs in a browser (scripts/make-sound.mjs loads it into headless Chromium).
async function renderScore(B, TOTAL, FPS, SR) {
  const T = TOTAL / FPS;
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * T * 2), SR);

  // ---- buses: music → reverb send, all → master compressor
  const master = ctx.createDynamicsCompressor();
  Object.assign(master, {});
  master.threshold.value = -16;
  master.ratio.value = 3;
  master.attack.value = 0.01;
  master.release.value = 0.2;
  master.connect(ctx.destination);
  const dry = ctx.createGain();
  dry.gain.value = 0.9;
  dry.connect(master);
  const verb = ctx.createConvolver();
  verb.buffer = hall(2.4);
  const verbOut = ctx.createGain();
  verbOut.gain.value = 0.32;
  verb.connect(verbOut).connect(master);
  const bus = (send = 0.5) => {
    const g = ctx.createGain();
    g.connect(dry);
    const s = ctx.createGain();
    s.gain.value = send;
    g.connect(s).connect(verb);
    return g;
  };
  const brassBus = bus(0.55);
  const drumBus = bus(0.35);
  const fxBus = bus(0.2);

  function hall(secs) {
    const n = Math.floor(SR * secs);
    const b = ctx.createBuffer(2, n, SR);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        lp += 0.35 * ((Math.random() * 2 - 1) - lp); // darker tail
        d[i] = lp * Math.exp(-t * 3.2) * (t < 0.012 ? t / 0.012 : 1);
      }
    }
    return b;
  }
  let noiseBuf = null;
  function noise() {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, SR * 3, SR);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    return s;
  }
  const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);
  const N = (name) => {
    const m = name.match(/^([A-G])(b|#)?(-?\d)$/);
    const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === "b" ? -1 : m[2] === "#" ? 1 : 0);
    return 12 * (+m[3] + 1) + base;
  };

  // ---- instruments
  // Brass: three detuned saws per note through a filter that opens on the attack (the "blat").
  function brass(t, dur, note, vel = 1, { bright = 2600, attack = 0.05, out = brassBus, vib = true } = {}) {
    const f = hz(note);
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.Q.value = 1.2;
    filt.frequency.setValueAtTime(f * 1.5, t);
    filt.frequency.linearRampToValueAtTime(Math.min(bright * vel, 9000), t + attack + 0.04);
    filt.frequency.setTargetAtTime(Math.min(bright * 0.7 * vel, 7000), t + attack + 0.05, 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.11 * vel, t + attack);
    g.gain.setTargetAtTime(0.085 * vel, t + attack, 0.15);
    g.gain.setTargetAtTime(0, t + dur, 0.08);
    const pan = ctx.createStereoPanner();
    pan.pan.value = ((note % 7) - 3) * 0.08;
    filt.connect(g).connect(pan).connect(out);
    for (const cents of [-7, 0, 6]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.detune.value = cents;
      if (vib) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 5.2;
        const depth = ctx.createGain();
        depth.gain.setValueAtTime(0, t);
        depth.gain.linearRampToValueAtTime(8, t + 0.45);
        lfo.connect(depth).connect(o.detune);
        lfo.start(t);
        lfo.stop(t + dur + 0.5);
      }
      o.connect(filt);
      o.start(t);
      o.stop(t + dur + 0.5);
    }
  }
  // Trumpet lead: brighter, a little square in it, more vibrato.
  function trumpet(t, dur, note, vel = 1) {
    brass(t, dur, note, vel * 1.25, { bright: 4200, attack: 0.035 });
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.value = hz(note);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 2200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.03 * vel, t + 0.03);
    g.gain.setTargetAtTime(0, t + dur, 0.06);
    o.connect(f).connect(g).connect(brassBus);
    o.start(t);
    o.stop(t + dur + 0.4);
  }
  function chord(t, dur, notes, vel = 1, opts) {
    for (const n of notes) brass(t, dur, N(n), vel, opts);
  }
  // Tuba-ish bass: saw + sine, low-passed.
  function tuba(t, dur, note, vel = 1) {
    const f = hz(note);
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 520;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.2 * vel, t + 0.03);
    g.gain.setTargetAtTime(0.12 * vel, t + 0.05, 0.1);
    g.gain.setTargetAtTime(0, t + dur, 0.05);
    filt.connect(g).connect(brassBus);
    for (const [type, amp] of [["sawtooth", 0.6], ["sine", 1]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const a = ctx.createGain();
      a.gain.value = amp;
      o.connect(a).connect(filt);
      o.start(t);
      o.stop(t + dur + 0.4);
    }
  }
  function snare(t, vel = 1) {
    const n = noise();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2400;
    bp.Q.value = 0.7;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 700;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    n.connect(bp).connect(hp).connect(g).connect(drumBus);
    n.start(t, Math.random() * 2);
    n.stop(t + 0.2);
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(230, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.05);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.25 * vel, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    o.connect(og).connect(drumBus);
    o.start(t);
    o.stop(t + 0.1);
  }
  function roll(t0, t1, v0, v1, rate = 16) {
    for (let t = t0; t < t1; t += 1 / rate) snare(t, v0 + (v1 - v0) * ((t - t0) / (t1 - t0)) * 1);
  }
  function timpani(t, note = N("Bb1"), vel = 1) {
    const o = ctx.createOscillator();
    o.type = "sine";
    const f = hz(note);
    o.frequency.setValueAtTime(f * 1.5, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    o.connect(g).connect(drumBus);
    o.start(t);
    o.stop(t + 1.7);
    const o2 = ctx.createOscillator();
    o2.frequency.value = f * 1.52;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.25 * vel, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    o2.connect(g2).connect(drumBus);
    o2.start(t);
    o2.stop(t + 0.7);
    const n = noise();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 400;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.6 * vel, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    n.connect(lp).connect(ng).connect(drumBus);
    n.start(t, Math.random() * 2);
    n.stop(t + 0.15);
  }
  function crash(t, vel = 1, len = 2.2) {
    const n = noise();
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 4500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.28 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    n.connect(hp).connect(g).connect(drumBus);
    n.start(t, Math.random() * 2);
    n.stop(t + len);
  }
  function cymbalSwell(t0, t1, vel = 1) {
    const n = noise();
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 5000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.16 * vel, t1);
    g.gain.linearRampToValueAtTime(0, t1 + 0.02);
    n.connect(hp).connect(g).connect(drumBus);
    n.start(t0, Math.random() * 2);
    n.stop(t1 + 0.05);
  }
  function whoosh(t, dur, vel = 1, reverse = false) {
    const n = noise();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.2;
    const [a, b] = reverse ? [4000, 300] : [300, 4000];
    bp.frequency.setValueAtTime(a, t);
    bp.frequency.exponentialRampToValueAtTime(b, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35 * vel, t + dur * (reverse ? 0.85 : 0.4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(bp).connect(g).connect(fxBus);
    n.start(t, Math.random() * 2);
    n.stop(t + dur + 0.05);
  }
  function thud(t, vel = 1) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g).connect(fxBus);
    o.start(t);
    o.stop(t + 0.4);
  }
  function scratch(t) {
    const n = noise();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 6;
    bp.frequency.setValueAtTime(600, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + 0.09);
    bp.frequency.exponentialRampToValueAtTime(400, t + 0.26);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.9, t + 0.02);
    g.gain.setValueAtTime(0.9, t + 0.22);
    g.gain.linearRampToValueAtTime(0, t + 0.28);
    n.connect(bp).connect(g).connect(fxBus);
    n.start(t, Math.random() * 2);
    n.stop(t + 0.3);
  }
  function powerDown(t) {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(hz(N("Bb3")), t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.9);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(3000, t);
    f.frequency.exponentialRampToValueAtTime(120, t + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.linearRampToValueAtTime(0, t + 0.95);
    o.connect(f).connect(g).connect(fxBus);
    o.start(t);
    o.stop(t + 1);
  }
  function tick(t, hi) {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = hi ? 1850 : 1320;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    o.connect(g).connect(fxBus);
    o.start(t);
    o.stop(t + 0.06);
    const n = noise();
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 3000;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.45, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.018);
    n.connect(hp).connect(ng).connect(fxBus);
    n.start(t, Math.random() * 2);
    n.stop(t + 0.02);
  }
  // Dead air after the power-down: a dim mains hum, so the drop reads as "off", not as a glitch.
  function hum(t0, t1) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.05, t0 + 0.3);
    g.gain.setValueAtTime(0.05, t1 - 0.2);
    g.gain.linearRampToValueAtTime(0, t1);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 400;
    f.connect(g).connect(fxBus);
    for (const [fr, a] of [[60, 1], [120, 0.5], [180, 0.25]]) {
      const o = ctx.createOscillator();
      o.frequency.value = fr;
      const og = ctx.createGain();
      og.gain.value = a;
      o.connect(og).connect(f);
      o.start(t0);
      o.stop(t1 + 0.05);
    }
  }
  // A low pulse under the clock (tension).
  function pulse(t, note) {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = hz(note);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(700, t);
    f.frequency.exponentialRampToValueAtTime(120, t + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(f).connect(g).connect(brassBus);
    o.start(t);
    o.stop(t + 0.45);
  }

  // ---- the score, twice
  for (const pass of [0, 1]) {
    const at = (frame) => pass * T + frame / FPS;
    const beat = 0.5; // 120 bpm; a bar is a pledge (60 frames)
    const bar = (i) => at(B.opener.from + 39 + i * 60); // bar 0 starts at frame 39; pledges start on bars 2…5

    // Frame 0: the fanfare. A crash, timpani and the tonic chord, a trumpet call over it.
    crash(at(0), 1);
    timpani(at(0), N("Bb1"), 1);
    chord(at(0), 1.25, ["Bb2", "F3", "Bb3", "D4", "F4"], 0.9);
    tuba(at(0), 1.2, N("Bb1"));
    trumpet(at(0.1 * FPS), 0.2, N("F4"), 0.9);
    trumpet(at(0.35 * FPS), 0.2, N("F4"), 0.9);
    trumpet(at(0.6 * FPS), 0.62, N("Bb4"), 1);
    roll(at(0.9 * FPS), bar(0), 0.25, 0.55);

    // Bars 0–5: the march. [chord, bass root, melody [note, beats]…]
    const bars = [
      [["F3", "Bb3", "D4"], "Bb1", [["D5", 1], ["C5", 0.5], ["Bb4", 0.5], ["F4", 2]]],
      [["G3", "Bb3", "Eb4"], "Eb2", [["Eb5", 1], ["D5", 1], ["C5", 1], ["F4", 1]], ["A3", "C4", "F4"], "F1"],
      [["F3", "Bb3", "D4"], "Bb1", [["Bb4", 1.5], ["C5", 0.5], ["D5", 2]]],
      [["G3", "Bb3", "D4"], "G1", [["G5", 1], ["F5", 1], ["D5", 2]]],
      [["G3", "Bb3", "Eb4"], "Eb2", [["Eb5", 1], ["D5", 0.5], ["C5", 0.5], ["Bb4", 2]]],
      [["A3", "C4", "Eb4", "F4"], "F1", [["C5", 1], ["D5", 1], ["Eb5", 1], ["F5", 1]]],
    ];
    bars.forEach(([ch, root, mel, ch2, root2], i) => {
      const t0 = bar(i);
      const lift = 0.8 + i * 0.05; // it keeps building
      timpani(t0, N(root) + (N(root) < N("F1") ? 12 : 0), 0.7 * lift);
      if (i === 2) crash(t0, 0.7);
      for (let b = 0; b < 4; b++) {
        const t = t0 + b * beat;
        const c = ch2 && b >= 2 ? ch2 : ch;
        const r = root2 && b >= 2 ? root2 : root;
        if (b % 2 === 0) tuba(t, 0.34, N(r) + (b === 2 ? 7 : 0), lift);
        else chord(t, 0.2, c, 0.55 * lift, { bright: 1800, vib: false });
        snare(t, 0.35 * lift);
        snare(t + beat * 0.75, 0.18 * lift);
      }
      roll(t0 + 3 * beat, t0 + 4 * beat, 0.15 * lift, 0.4 * lift, i === 5 ? 24 : 16);
      let tb = t0;
      for (const [n, len] of mel) {
        trumpet(tb, len * beat * 0.92, N(n), 0.75 * lift);
        tb += len * beat;
      }
    });
    // The toolbar folds away (pledge 1).
    whoosh(at(B.toolbar.from + 30), 0.45, 0.6, true);

    // The Wi-Fi dies: the record scratches, everything powers down, then a low hum.
    scratch(at(B.offline.from) - 0.04);
    powerDown(at(B.offline.from) + 0.1);
    thud(at(B.offline.from + 2), 0.7);
    hum(at(B.offline.from) + 0.7, at(B.find.from));
    // "Find him.": a game-show clock, and a pulse under it.
    whoosh(at(B.find.from) - 0.1, 0.35, 0.5);
    for (let i = 0; i < B.find.dur; i += 7.5) {
      tick(at(B.find.from + i), Math.round(i / 7.5) % 2 === 0);
      if (Math.round(i / 7.5) % 2 === 0) pulse(at(B.find.from + i), N("Bb1") + (Math.round(i / 15) % 2 ? 1 : 0));
    }
    cymbalSwell(at(B.find.to - 22), at(B.cta.from), 1);

    // "Impeach Chrome.": the full sting…
    const c = at(B.cta.from);
    crash(c, 1.1, 3);
    timpani(c, N("Bb1"), 1.1);
    tuba(c, 0.9, N("Bb1"), 1.2);
    chord(c, 0.8, ["Bb2", "F3", "Bb3", "D4", "F4", "Bb4"], 1.1);
    trumpet(c + 0.05, 0.25, N("F5"), 1);
    trumpet(c + 0.3, 0.25, N("F5"), 1);
    trumpet(c + 0.55, 0.3, N("Bb5"), 1.05);
    roll(c + 0.4, at(B.cta.from + 26), 0.2, 0.7, 20);
    // …and the INCUMBENT stamp: an orchestra hit.
    const s = at(B.cta.from + 26);
    thud(s, 1.4);
    timpani(s, N("Bb1"), 1.3);
    snare(s, 1.2);
    crash(s, 1.2, 3.2);
    chord(s, 1.9, ["Bb1", "Bb2", "F3", "Bb3", "D4", "F4", "Bb4", "D5"], 1.15, { attack: 0.02, bright: 5200 });
    tuba(s, 1.8, N("Bb1"), 1.3);
    trumpet(s + 0.02, 1.8, N("D5"), 1);
    trumpet(s + 0.02, 1.8, N("F5"), 0.9);

    // The bridge: a snare roll back into the fanfare (frame 0 of the next pass).
    whoosh(at(B.bridge.from + 1), 0.8, 0.7, true);
    roll(at(B.bridge.from + 2), at(B.bridge.to), 0.08, 0.6, 20);
    cymbalSwell(at(B.bridge.from + 6), at(B.bridge.to), 0.8);
  }

  const buf = await ctx.startRendering();
  // Keep the second pass: [T, 2T).
  const start = Math.round(T * SR);
  const len = Math.round(T * SR);
  return [0, 1].map((c) => buf.getChannelData(c).slice(start, start + len));
}
