import AVFoundation
import QuartzCore

/// The onboarding intro's music (Dia plays a recorded piece under OnboardingIntro2; we can't ship
/// that). An original few bars, synthesized when the intro starts: open fifths swell in, a bell
/// rings as the icon lands, a rising pentatonic sparkle follows the wordmark letter by letter, the
/// harmony moves to Gmaj7 under the tagline, and it resolves on Dmaj9 with a breath of air as the
/// stage opens. The cue times come from the intro animation (components/onboarding/Intro.tsx), so
/// picture and sound stay in step.
final class IntroMusic {
  static let shared = IntroMusic()

  /// Seconds from the start of the intro.
  struct Cues {
    var icon = 0.25
    var letters = 1.2
    var letterStep = 0.055
    var letterCount = 9
    var tagline = 2.4
    var exit = 4.1
    var end = 4.75

    init(_ d: [String: Double]) {
      icon = d["icon"] ?? icon
      letters = d["letters"] ?? letters
      letterStep = d["letterStep"] ?? letterStep
      letterCount = Int(d["letterCount"] ?? Double(letterCount))
      tagline = d["tagline"] ?? tagline
      exit = d["exit"] ?? exit
      end = d["end"] ?? end
    }
  }

  private static let sampleRate = 44_100.0
  /// Overall level: it sits under the picture, never over it.
  private static let volume: Float = 0.55

  private var engine: AVAudioEngine?
  private var session = 0
  private var muted = false
  private var ramp: Timer?

  /// Starts the piece as if it had begun at `requestedAt` (synthesis takes a moment; the
  /// animation doesn't wait for it). Muted still plays, silently, so unmuting joins in time.
  func play(cues: [String: Double], muted: Bool) {
    let requestedAt = CACurrentMediaTime()
    stopNow()
    session += 1
    let current = session
    self.muted = muted
    let cues = Cues(cues)
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      let buffer = Self.synthesize(cues)
      DispatchQueue.main.async {
        guard let self, self.session == current, let buffer else { return }
        self.start(buffer, offset: CACurrentMediaTime() - requestedAt, session: current)
      }
    }
  }

  func setMuted(_ muted: Bool) {
    self.muted = muted
    fade(to: muted ? 0 : Self.volume, duration: 0.25)
  }

  /// Fades out and releases the audio device.
  func stop(fade duration: Double) {
    guard engine != nil else { return }
    let current = session
    fade(to: 0, duration: duration) { [weak self] in
      if self?.session == current { self?.stopNow() }
    }
  }

  private func start(_ buffer: AVAudioPCMBuffer, offset: Double, session current: Int) {
    let frames = AVAudioFramePosition(max(0, offset) * Self.sampleRate)
    guard frames < AVAudioFramePosition(buffer.frameLength) else { return }
    let engine = AVAudioEngine()
    let player = AVAudioPlayerNode()
    let reverb = Self.reverb()
    Self.connect(engine, player, reverb, format: buffer.format)
    engine.mainMixerNode.outputVolume = muted ? 0 : Self.volume
    do {
      try engine.start()
    } catch {
      NSLog("[IntroMusic] couldn't start audio: \(error)")
      return
    }
    player.scheduleBuffer(Self.slice(buffer, from: frames), at: nil) { [weak self] in
      // Let the reverb tail ring out before letting go of the device.
      DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
        if self?.session == current { self?.stopNow() }
      }
    }
    player.play()
    self.engine = engine
  }

  private func stopNow() {
    ramp?.invalidate()
    ramp = nil
    engine?.stop()
    engine = nil
  }

  private func fade(to target: Float, duration: Double, then done: (() -> Void)? = nil) {
    ramp?.invalidate()
    guard let mixer = engine?.mainMixerNode else { return done?() ?? () }
    let from = mixer.outputVolume
    let start = CACurrentMediaTime()
    ramp = Timer.scheduledTimer(withTimeInterval: 1 / 60, repeats: true) { [weak self] timer in
      let t = duration > 0 ? min(1, (CACurrentMediaTime() - start) / duration) : 1
      // Equal-power-ish: ease the gain so the fade sounds even.
      let eased = Float(t * t * (3 - 2 * t))
      mixer.outputVolume = from + (target - from) * eased
      if t >= 1 {
        timer.invalidate()
        if self?.ramp === timer { self?.ramp = nil }
        done?()
      }
    }
  }

  private static func reverb() -> AVAudioUnitReverb {
    let reverb = AVAudioUnitReverb()
    reverb.loadFactoryPreset(.largeHall)
    reverb.wetDryMix = 32
    return reverb
  }

  private static func connect(_ engine: AVAudioEngine, _ player: AVAudioPlayerNode, _ reverb: AVAudioUnitReverb, format: AVAudioFormat) {
    engine.attach(player)
    engine.attach(reverb)
    engine.connect(player, to: reverb, format: format)
    engine.connect(reverb, to: engine.mainMixerNode, format: format)
  }

  private static func slice(_ buffer: AVAudioPCMBuffer, from frame: AVAudioFramePosition) -> AVAudioPCMBuffer {
    guard frame > 0 else { return buffer }
    let count = AVAudioFrameCount(AVAudioFramePosition(buffer.frameLength) - frame)
    let out = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: count)!
    out.frameLength = count
    // Joining late: a few milliseconds of fade-in so it doesn't start with a click.
    let fadeIn = min(Int(count), Int(0.06 * sampleRate))
    for ch in 0..<Int(buffer.format.channelCount) {
      let data = out.floatChannelData![ch]
      data.update(from: buffer.floatChannelData![ch] + Int(frame), count: Int(count))
      for i in 0..<fadeIn { data[i] *= Float(i) / Float(fadeIn) }
    }
    return out
  }

  // MARK: DEV

  /// DEV: renders the piece (through the same reverb) to an audio file, for checking it without
  /// playing anything out loud. Returns the duration in seconds, or nil on failure.
  static func render(cues: [String: Double], to path: String) -> Double? {
    guard let buffer = synthesize(Cues(cues)) else { return nil }
    let engine = AVAudioEngine()
    let player = AVAudioPlayerNode()
    connect(engine, player, reverb(), format: buffer.format)
    engine.mainMixerNode.outputVolume = volume
    do {
      try engine.enableManualRenderingMode(.offline, format: buffer.format, maximumFrameCount: 4096)
      try engine.start()
      player.scheduleBuffer(buffer, at: nil)
      player.play()
      let file = try AVAudioFile(forWriting: URL(fileURLWithPath: path), settings: buffer.format.settings)
      let chunk = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat, frameCapacity: 4096)!
      let total = AVAudioFramePosition(buffer.frameLength) + AVAudioFramePosition(2.5 * sampleRate)
      while engine.manualRenderingSampleTime < total {
        let frames = AVAudioFrameCount(min(4096, total - engine.manualRenderingSampleTime))
        guard try engine.renderOffline(frames, to: chunk) == .success else { break }
        try file.write(from: chunk)
      }
      engine.stop()
      return Double(total) / sampleRate
    } catch {
      NSLog("[IntroMusic] render failed: \(error)")
      return nil
    }
  }

  // MARK: Synthesis

  private static func synthesize(_ c: Cues) -> AVAudioPCMBuffer? {
    let sr = sampleRate
    let length = c.end + 4.5
    let n = Int(length * sr)
    guard let format = AVAudioFormat(standardFormatWithSampleRate: sr, channels: 2),
          let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(n)) else { return nil }
    buffer.frameLength = AVAudioFrameCount(n)
    let left = buffer.floatChannelData![0], right = buffer.floatChannelData![1]
    left.initialize(repeating: 0, count: n)
    right.initialize(repeating: 0, count: n)
    var mix = Mix(left: left, right: right, count: n, sr: sr)

    // Harmony: open fifths (D sus2) → Gmaj7 under the tagline → Dmaj9 as the stage opens.
    // Voiced from D3 up so laptop speakers carry it; the sub adds weight where there's a woofer.
    let d2 = 73.416, g2 = 97.999, d3 = 146.832, g3 = 195.998, a3 = 220.0, b3 = 246.942, d4 = 293.665
    let e4 = 329.628, fs4 = 369.994, a4 = 440.0, cs5 = 554.365, e5 = 659.255
    let first = c.tagline + 0.35, second = c.exit + 0.25
    for f in [d3, a3, e4, a4] { mix.pad(f, from: 0, to: first, attack: 1.8, release: 1.2, gain: 0.15) }
    for f in [g3, b3, d4, fs4] { mix.pad(f, from: c.tagline - 0.2, to: second, attack: 1.1, release: 1.0, gain: 0.14) }
    for f in [d3, a3, fs4, cs5, e5] { mix.pad(f, from: c.exit - 0.1, to: c.end + 1.2, attack: 0.6, release: 2.8, gain: 0.13) }
    mix.sine(d2, from: 0, to: first, attack: 2.0, release: 1.2, gain: 0.08)
    mix.sine(g2, from: c.tagline - 0.2, to: second, attack: 1.0, release: 1.0, gain: 0.07)
    mix.sine(d2, from: c.exit - 0.1, to: c.end + 1.2, attack: 0.6, release: 2.8, gain: 0.08)

    // The icon lands: a bell (A5 over D5).
    let land = c.icon + 0.35
    mix.bell(587.33, at: land, gain: 0.10, pan: -0.15)
    mix.bell(880.0, at: land + 0.012, gain: 0.07, pan: 0.2)

    // The wordmark writes itself: one pluck per letter, rising through D major pentatonic from A4.
    var midi = 69
    let pentatonic: Set<Int> = [2, 4, 6, 9, 11]
    for i in 0..<max(0, c.letterCount) {
      let freq = 440 * pow(2, Double(midi - 69) / 12)
      let pan = Float(i % 2 == 0 ? -0.35 : 0.35) * Float(0.4 + 0.6 * Double(i) / Double(max(1, c.letterCount - 1)))
      mix.pluck(freq, at: c.letters + Double(i) * c.letterStep + 0.03, gain: 0.075 - 0.003 * Float(i), pan: pan)
      repeat { midi += 1 } while !pentatonic.contains(midi % 12)
    }

    // The stage opens: a swell of air, then a closing chime on the resolution.
    mix.air(from: c.exit - 0.35, peak: c.end, to: c.end + 1.4, gain: 0.035)
    mix.bell(739.99, at: c.end - 0.05, gain: 0.06, pan: 0.25)
    mix.bell(1174.66, at: c.end + 0.03, gain: 0.04, pan: -0.25)

    mix.normalize(peak: 0.5)
    mix.fadeOut(last: 1.5)
    return buffer
  }
}

/// A stereo sum the voices write into. Voices loop over their own sample ranges with phase
/// accumulators and a wavetable, so this stays quick even in unoptimized (Debug) builds.
private struct Mix {
  let left: UnsafeMutablePointer<Float>
  let right: UnsafeMutablePointer<Float>
  let count: Int
  let sr: Double

  /// One cycle of a soft, warm tone (partials 1…8 at 1/n^1.7): a gentle saw without the buzz.
  static let table: [Float] = {
    let size = 4096
    var t = [Float](repeating: 0, count: size + 1)
    for i in 0...size {
      let x = 2 * Double.pi * Double(i) / Double(size)
      var v = 0.0
      for k in 1...8 { v += sin(Double(k) * x) / pow(Double(k), 1.7) }
      t[i] = Float(v / 1.5)
    }
    return t
  }()

  private func range(_ from: Double, _ to: Double) -> Range<Int> {
    let a = max(0, Int(from * sr)), b = min(count, Int(to * sr))
    return a..<max(a, b)
  }

  /// 0 → 1 over `attack`, holds, 1 → 0 over `release` after `to`; raised-cosine edges.
  private static func envelope(_ t: Double, length: Double, attack: Double, release: Double) -> Float {
    let s = { (x: Double) in Float(0.5 - 0.5 * cos(Double.pi * min(max(x, 0), 1))) }
    if t < attack { return s(t / attack) }
    if t > length { return 1 - s((t - length) / release) }
    return 1
  }

  /// A pad note: two slightly detuned wavetable voices (left / right) through a one-pole lowpass,
  /// with a slow shimmer.
  mutating func pad(_ freq: Double, from: Double, to: Double, attack: Double, release: Double, gain: Float) {
    let detune = pow(2, 4.0 / 1200)
    var phase = (Double.random(in: 0..<1), Double.random(in: 0..<1))
    let inc = (freq / detune / sr, freq * detune / sr)
    // Lowpass around 5× the fundamental, capped: warm, not dull.
    let cutoff = min(1600, freq * 5)
    let a = Float(1 - exp(-2 * Double.pi * cutoff / sr))
    var lp: (Float, Float) = (0, 0)
    let length = to - from
    let table = Mix.table
    let size = Double(table.count - 1)
    let lookup = { (x: Double) -> Float in
      let i = Int(x)
      let f = Float(x - Double(i))
      return table[i] + (table[i + 1] - table[i]) * f
    }
    for i in range(from, to + release) {
      let t = Double(i) / sr - from
      let env = Mix.envelope(t, length: length, attack: attack, release: release) * gain
      let shimmer = Float(1 + 0.04 * sin(2 * Double.pi * 0.23 * t + freq))
      let l = lookup(phase.0 * size), r = lookup(phase.1 * size)
      lp.0 += a * (l - lp.0)
      lp.1 += a * (r - lp.1)
      left[i] += lp.0 * env * shimmer
      right[i] += lp.1 * env * (2 - shimmer)
      phase.0 += inc.0; if phase.0 >= 1 { phase.0 -= 1 }
      phase.1 += inc.1; if phase.1 >= 1 { phase.1 -= 1 }
    }
  }

  mutating func sine(_ freq: Double, from: Double, to: Double, attack: Double, release: Double, gain: Float) {
    let length = to - from
    for i in range(from, to + release) {
      let t = Double(i) / sr - from
      let v = Float(sin(2 * Double.pi * freq * t)) * Mix.envelope(t, length: length, attack: attack, release: release) * gain
      left[i] += v
      right[i] += v
    }
  }

  /// FM bell: an inharmonic modulator (×1.4) whose index decays faster than the tone.
  mutating func bell(_ freq: Double, at start: Double, gain: Float, pan: Float) {
    let (gl, gr) = Mix.pan(pan)
    for i in range(start, start + 4.5) {
      let t = Double(i) / sr - start
      let index = 2.6 * exp(-t / 0.35)
      let v = sin(2 * Double.pi * freq * t + index * sin(2 * Double.pi * freq * 1.4 * t))
      let env = Float(min(1, t / 0.004) * exp(-t / 1.4)) * gain
      left[i] += Float(v) * env * gl
      right[i] += Float(v) * env * gr
    }
  }

  /// A short, round pluck (sine with a touch of 2nd and 3rd harmonic).
  mutating func pluck(_ freq: Double, at start: Double, gain: Float, pan: Float) {
    let (gl, gr) = Mix.pan(pan)
    for i in range(start, start + 2.0) {
      let t = Double(i) / sr - start
      let x = 2 * Double.pi * freq * t
      let v = sin(x) + 0.25 * sin(2 * x) * exp(-t / 0.12) + 0.08 * sin(3 * x) * exp(-t / 0.06)
      let env = Float(min(1, t / 0.005) * exp(-t / 0.42)) * gain
      left[i] += Float(v) * env * gl
      right[i] += Float(v) * env * gr
    }
  }

  /// Filtered noise that swells to `peak` while its filter opens, then dies away.
  mutating func air(from: Double, peak: Double, to: Double, gain: Float) {
    var seed: UInt32 = 0x9E37_79B9
    var lp: (Float, Float) = (0, 0)
    let noise = { () -> Float in
      seed = seed &* 1_664_525 &+ 1_013_904_223
      return Float(seed >> 8) / Float(1 << 23) - 1
    }
    for i in range(from, to) {
      let t = Double(i) / sr
      let rise = t < peak ? (t - from) / (peak - from) : 1 - (t - peak) / (to - peak)
      let shape = Float(max(0, rise) * max(0, rise))
      let cutoff = 250 + 2800 * Double(shape)
      let a = Float(1 - exp(-2 * Double.pi * cutoff / sr))
      lp.0 += a * (noise() - lp.0)
      lp.1 += a * (noise() - lp.1)
      left[i] += lp.0 * shape * gain
      right[i] += lp.1 * shape * gain
    }
  }

  mutating func normalize(peak target: Float) {
    var peak: Float = 0
    for i in 0..<count { peak = max(peak, abs(left[i]), abs(right[i])) }
    guard peak > 0 else { return }
    let k = target / peak
    for i in 0..<count {
      left[i] *= k
      right[i] *= k
    }
  }

  mutating func fadeOut(last seconds: Double) {
    let frames = min(count, Int(seconds * sr))
    for j in 0..<frames {
      let i = count - frames + j
      let g = Float(0.5 + 0.5 * cos(Double.pi * Double(j) / Double(frames)))
      left[i] *= g
      right[i] *= g
    }
  }

  /// Constant-power pan, -1 (left) … 1 (right).
  private static func pan(_ p: Float) -> (Float, Float) {
    let angle = Double(p + 1) * Double.pi / 4
    return (Float(cos(angle)), Float(sin(angle)))
  }
}
