import ExpoModulesCore
import MetalKit

/// Dia's New Tab light: the command bar is treated as a rounded-rect area light
/// floating `lift` points above the page, and every pixel gets the analytic
/// irradiance of that emitter, tinted by a slowly scrolling, noise-warped
/// palette gradient.
///
/// Shader reconstructed from `breathingAreaLightFragment` (PowerUp metallib);
/// the per-frame animation below follows `BreathingAreaLightView.draw(in:)` and
/// `NewTabAreaLightView` recovered from the Dia binary (docs/dia-spec.md).
final class AreaLightView: MetalSurface {
  struct Params {
    var shapeFrame = SIMD4<Float>(0, 0, 0, 0)
    var cornerRadius: Float = 22
    var lift: Float = 10
    var intensity: Float = 4
    var falloff: Float = 1
    /// Emitter tilt in radians about [x, y].
    var tilt = SIMD2<Float>(5 * .pi / 180, 0)
    var noiseSeed = Float.random(in: 0..<1000)
    var introDelay: Double = 0.05
    var introDuration: Double = 0.4
    /// After this many seconds the scroll freezes and breathing has faded out.
    var animationDuration: Double = 60
  }

  /// Must match `AreaLightUniforms` in the shader (Metal alignment rules).
  private struct Uniforms {
    var shapeFrame: SIMD4<Float>
    var rotationTrig: SIMD4<Float>
    var viewSize: SIMD2<Float>
    var cornerRadius: Float
    var falloff: Float
    var noiseSeed: Float
    var lift: Float
    var time: Float
    var intensity: Float
    var numberOfColors: Int32
    var lightMode: Int32
  }

  var params = Params()
  /// Last encoded state, for debugging from JS (`AreaLightModule.debugState`).
  static var lastState: [String: Any] = [:]
  private var colors: [SIMD4<Float>] = AreaLightView.pink
  private var time: Double = 0
  private var lastTimestamp: CFTimeInterval?
  /// Dia's display link: created paused, run by `restart()` / `resume()`.
  private var clockEnabled = false
  private var driving = false
  private lazy var activity = WindowActivity { [weak self] in self?.windowStateChanged() }

  /// Dia picks one of seven fixed 5-color tables by the theme's hue family.
  static let palettes: [String: [SIMD4<Float>]] = [
    "blue": ["#4691C3", "#4BA5B9", "#418CBE", "#48B6DA", "#55A2E4"],
    "red": ["#C1575C", "#C35F4B", "#B95058", "#DB463C", "#E16070"],
    "pink": ["#D37B8B", "#C387A0", "#C3738C", "#D27DA8", "#E37C94"],
    "orange": ["#D87249", "#D08C64", "#D26941", "#DA965A", "#DE7034"],
    "yellow": ["#E3AC38", "#F0BE55", "#EBB441", "#EEBB26", "#F3C93B"],
    "green": ["#3EB489", "#73B982", "#4BAA82", "#84C978", "#45BE74"],
    "purple": ["#7873AF", "#8C69AF", "#7D78B4", "#877ECB", "#856BD0"],
  ].mapValues { $0.compactMap { SIMD4<Float>(hex: $0) } }
  static let pink = palettes["pink"]!

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    // Dia drives this light from a 30 fps display link.
    metalView.preferredFramesPerSecond = 30
    metalView.isPaused = true
    metalView.enableSetNeedsDisplay = true
    alphaValue = 0.75
  }

  /// Either a palette name ("pink", "blue", …) or explicit hex stops.
  func setPalette(_ value: [String]) {
    if value.count == 1, let named = Self.palettes[value[0]] {
      colors = named
    } else {
      let parsed = value.compactMap { SIMD4<Float>(hex: $0) }
      colors = parsed.isEmpty ? Self.pink : parsed
    }
    redraw()
  }

  /// Prop changes redraw a paused light, like Dia's property setters (`setNeedsDisplay`).
  func redraw() {
    if !driving { metalView.needsDisplay = true }
  }

  /// The New Tab entrance (NewTabPageViewController): loadView skips the light 5s ahead, to its
  /// settled look; the entrance then restarts it from 0, but only when the window is key and
  /// Reduce Motion is off. Otherwise it waits, settled, for the window to become key.
  func replayIntro() {
    time = 5
    lastTimestamp = nil
    if activity.isKey && !WindowActivity.reduceMotion {
      time = 0
      clockEnabled = true
    } else {
      clockEnabled = false
    }
    updateDriving()
  }

  /// windowDidBecomeKey / windowDidResignKey: the clock resumes / pauses and the light is
  /// redrawn with the key scale `k`. Dia resumes even under Reduce Motion (the breathing then
  /// runs); we keep the light still there.
  private func windowStateChanged() {
    let key = activity.isKey
    if key != lastKey {
      lastKey = key
      clockEnabled = key && !WindowActivity.reduceMotion
    }
    updateDriving()
  }
  private var lastKey: Bool?

  /// Runs the MTKView at 30 fps while the clock runs and the window can be seen; otherwise it
  /// draws on demand, so a paused light still repaints when `k` or a prop changes.
  private func updateDriving() {
    let run = clockEnabled && window != nil && !isHidden && activity.isVisible && time < params.animationDuration
    if run && !driving { lastTimestamp = nil }
    driving = run
    metalView.enableSetNeedsDisplay = !run
    metalView.isPaused = !run
    if !run { metalView.needsDisplay = true }
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    activity.attach(to: window)
    lastKey = activity.isKey
    if window != nil { replayIntro() } else { clockEnabled = false; updateDriving() }
  }

  override var isHidden: Bool {
    didSet { updateDriving() }
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    redraw()
  }

  override class var fragmentName: String { "areaLightFragment" }

  private static func smooth(_ x: Double) -> Double {
    let t = min(max(x, 0), 1)
    return t * t * (3 - 2 * t)
  }

  override func encode(_ encoder: MTLRenderCommandEncoder, size: SIMD2<Float>) {
    if driving {
      let now = CACurrentMediaTime()
      if let last = lastTimestamp { time += now - last }
      lastTimestamp = now
    }
    let p = params
    let T = time
    let A = p.animationDuration
    // NewTabAreaLightView.layout: lift and tilt are halved while the window isn't key.
    let k: Float = activity.isKey ? 1 : 0.5

    // Intro: lift rises from 3pt to its resting height with a slight early dip.
    let e = max(T - p.introDelay, 0)
    let progress: Double
    let introFade: Double
    if p.introDuration > 0 {
      let t = min(max(e / p.introDuration, 0), 1)
      let u = 1 - (1 + 3 * t) * exp(-3 * t)
      progress = u * u * (3 - 2 * u) - 0.25 * (1 - t) * sin(.pi * t)
      introFade = Self.smooth(min(e / (0.25 * p.introDuration), 1))
    } else {
      progress = 1
      introFade = 1
    }
    let lift = 3 + (Double(k * p.lift) - 3) * progress

    // Colour scroll eases to a stop over the last quarter of the animation.
    let effectiveTime: Double
    if T <= 0.75 * A {
      effectiveTime = T
    } else {
      let x = min((T - 0.75 * A) / (0.25 * A), 1)
      effectiveTime = 0.75 * A + 0.25 * A * (x - x * x * x + 0.5 * x * x * x * x)
    }

    // Breathing: an asymmetric Gaussian bump every 6s, peaking at 2.19s.
    let phase = fmod(T, 6) / 6
    let sigma = phase < 0.365 ? 0.15 : 0.30
    let breath = exp(-pow(phase - 0.365, 2) / (2 * sigma * sigma))
    let fadeOut = 1 - Self.smooth(min(max((T / A - 0.75) * 4, 0), 1))
    let intensity = Double(p.intensity) * introFade * (1 + 0.5 * breath * fadeOut)

    let a = Float(progress) * k * p.tilt.x
    let b = Float(progress) * k * p.tilt.y
    let isDark = effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
    var uniforms = Uniforms(
      shapeFrame: p.shapeFrame,
      rotationTrig: SIMD4(cos(a), sin(a), cos(b), sin(b)),
      viewSize: size,
      cornerRadius: p.cornerRadius,
      falloff: p.falloff,
      noiseSeed: p.noiseSeed,
      lift: Float(max(lift, 0.001)),
      time: Float(effectiveTime),
      intensity: Float(intensity),
      numberOfColors: Int32(colors.count),
      lightMode: isDark ? 0 : 1
    )
    encoder.setFragmentBytes(&uniforms, length: MemoryLayout<Uniforms>.stride, index: 0)
    colors.withUnsafeBytes { encoder.setFragmentBytes($0.baseAddress!, length: $0.count, index: 1) }
    Self.lastState = [
      "T": T, "shapeFrame": [p.shapeFrame.x, p.shapeFrame.y, p.shapeFrame.z, p.shapeFrame.w].map(Double.init),
      "viewSize": [Double(size.x), Double(size.y)], "lift": Double(uniforms.lift), "intensity": Double(uniforms.intensity),
      "tiltDeg": Double(a) * 180 / .pi, "k": Double(k), "running": driving, "key": activity.isKey,
      "visible": activity.isVisible, "reduceMotion": WindowActivity.reduceMotion,
      "colors": colors.count, "drawable": [Double(metalView.drawableSize.width), Double(metalView.drawableSize.height)],
      "opaque": metalView.layer?.isOpaque ?? false, "frames": (Self.lastState["frames"] as? Int ?? 0) + 1,
    ]

    // Dia stops its display link once the animation has fully settled.
    if T >= A { DispatchQueue.main.async { [weak self] in self?.updateDriving() } }
  }

  override class var shaderSource: String { areaLightSource }
}

// Straight-alpha output: rgb = light colour, a = strength (blended sourceAlpha, like Dia's pipeline).
let areaLightSource = """
struct AreaLightUniforms {
  float4 shapeFrame;    // emitter rect (x, y, w, h) in points, top-left origin
  float4 rotationTrig;  // (cos a, sin a, cos b, sin b): tilt about X by a, then Y by b
  float2 viewSize;      // points
  float cornerRadius;
  float falloff;        // 2 = inverse square; also shapes the output curve
  float noiseSeed;
  float lift;           // emitter height above the page, points
  float time;           // seconds
  float intensity;
  int numberOfColors;
  int lightMode;        // 1 = light appearance, 0 = dark (HDR + filmic tonemap)
};

// Wrapping multi-stop gradient lookup with smoothstep blending between stops.
static float3 samplePalette(constant float4 *stops, int count, float pos) {
  int n = max(count, 1);
  float scaled = fract(pos) * float(n);
  int i0 = min(int(floor(scaled)), n - 1);
  int i1 = (i0 + 1) % n;
  return mix(stops[i0], stops[i1], smoothstep(0.0f, 1.0f, scaled - float(i0))).rgb;
}

// IQ sin-hash gradient.
static inline float2 hashGradient(float2 p) {
  p = float2(dot(p, float2(127.1f, 311.7f)), dot(p, float2(269.5f, 183.3f)));
  return -1.0f + 2.0f * fract(sin(p) * 43758.5453f);
}

// IQ 2D simplex noise, roughly [-1, 1].
static float simplex2D(float2 p) {
  const float K1 = 0.366025404f; // (sqrt(3) - 1) / 2
  const float K2 = 0.211324865f; // (3 - sqrt(3)) / 6
  float2 i = floor(p + (p.x + p.y) * K1);
  float2 a = p - i + (i.x + i.y) * K2;
  float2 o = (a.x > a.y) ? float2(1, 0) : float2(0, 1);
  float2 b = a - o + K2;
  float2 c = a - 1.0f + 2.0f * K2;
  float3 h = max(0.5f - float3(dot(a, a), dot(b, b), dot(c, c)), 0.0f);
  float3 n = h * h * h * h * float3(dot(a, hashGradient(i)), dot(b, hashGradient(i + o)), dot(c, hashGradient(i + 1.0f)));
  return dot(n, float3(70.0f));
}

// Dave Hoskins hash12 (hash without sine).
static inline float hash12(float2 p) {
  float3 p3 = fract(float3(p.xyx) * 0.1031f);
  p3 += dot(p3, p3.yzx + 33.33f);
  return fract((p3.x + p3.y) * p3.z);
}

// Uniform [0,1) -> triangular PDF in [-1, 1].
static inline float triangularNoise(float u) {
  float r = u * 2.0f;
  return (u < 0.5f) ? sqrt(r) - 1.0f : 1.0f - sqrt(2.0f - r);
}

// One corner term of the solid angle subtended by an axis-aligned rectangle.
static inline float rectCornerTerm(float x, float y, float h) {
  float r = sqrt(h * h + x * x + y * y);
  return (r < 1e-4f) ? 0.0f : atan((x * y) / (r * h));
}

// Closed-form irradiance (solid angle / 2pi) of a rectangle with half size
// `hs`, seen from in-plane offset p at perpendicular distance `height`.
static float rectangleIrradiance(float2 p, float2 hs, float height) {
  float h = max(height, 1e-3f);
  float x1 = -(hs.x + p.x), x2 = hs.x - p.x;
  float y1 = -(hs.y + p.y), y2 = hs.y - p.y;
  float sum = rectCornerTerm(x2, y2, h) - (rectCornerTerm(x1, y2, h) + rectCornerTerm(x2, y1, h)) + rectCornerTerm(x1, y1, h);
  return sum * 0.159154943f; // 1 / (2pi)
}

// Rounded corners remove (1 - pi/4) of each r x r corner square.
static float roundedRectIrradiance(float2 p, float2 hs, float radius, float height) {
  float r = min(radius, min(hs.x, hs.y));
  float full = rectangleIrradiance(p, hs, height);
  if (r < 0.5f) return full;
  float2 inner = hs - r;
  float2 q = abs(p) - inner;
  float inCorner = step(0.0f, q.x) * step(0.0f, q.y);
  float cornerDist = length(max(q, 0.0f));
  float cornerHalf = r * 0.5f;
  float2 cornerCenter = sign(p) * (inner + cornerHalf);
  float cornerE = rectangleIrradiance(p - cornerCenter, float2(cornerHalf), height);
  float outsideArc = smoothstep(r - 1.0f, r + 1.0f, cornerDist);
  return max(full - inCorner * 0.214601837f * cornerE * outsideArc, 0.0f);
}

// Hable / Uncharted 2 filmic curve, white point 11.2.
static inline float3 hableCurve(float3 x) {
  const float A = 0.15f, B = 0.50f, C = 0.10f, D = 0.20f, E = 0.02f, F = 0.30f;
  return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;
}
static inline float3 hableTonemap(float3 x) { return saturate(hableCurve(x) * 1.37906432f); }

fragment float4 areaLightFragment(FullscreenOut in [[stage_in]],
                                  constant AreaLightUniforms &u [[buffer(0)]],
                                  constant float4 *colors [[buffer(1)]]) {
  float lift = max(u.lift, 1e-3f);
  float cosA = u.rotationTrig.x, sinA = u.rotationTrig.y;
  float cosB = u.rotationTrig.z, sinB = u.rotationTrig.w;

  float2 pixel = u.viewSize * in.uv;
  float2 hs = u.shapeFrame.zw * 0.5f;
  if (hs.x <= 0.0f || hs.y <= 0.0f) return float4(0.0f);
  float2 d = pixel - (u.shapeFrame.xy + hs);

  // Pixels behind the tilted emitter plane get nothing.
  float planeOffset = (d.y * sinA - cosA * sinB * d.x) / max(cosB * cosA, 1e-3f);
  if (lift - planeOffset <= 0.0f) return float4(0.0f);

  // Into the emitter's frame: v = Ry(b) * Rx(a) * (d.x, d.y, -lift).
  float zA = d.y * sinA - cosA * lift;
  float2 local = float2(zA * sinB + d.x * cosB, d.y * cosA + sinA * lift);
  float height = max(abs(d.y * sinA * cosB - (d.x * sinB + cosA * cosB * lift)), 1e-3f);

  float irradiance = roundedRectIrradiance(local, hs, u.cornerRadius, height);

  // Distance to the emitter surface; reshape inverse-square into 1/d^falloff.
  float r = min(u.cornerRadius, min(hs.x, hs.y));
  float2 q = abs(local) - hs + r;
  float sdf = min(max(q.x, q.y), 0.0f) + length(max(q, 0.0f)) - r;
  float outside = max(sdf, 0.0f);
  float dist = max(sqrt(outside * outside + height * height), 1e-4f);
  float light = irradiance * (height * height) / (dist * dist);
  if (u.falloff != 2.0f && outside > 0.0f) light *= pow(height / dist, u.falloff - 2.0f);

  // Emitter colour: diagonal palette gradient scrolling every 20s, warped by simplex noise.
  float edgeFade = saturate(outside / hs.x);
  float2 shapeUV = (clamp(local, -hs, hs) + hs) / u.shapeFrame.z;
  float2 noiseP = shapeUV * 0.75f - u.time * 0.05f + u.noiseSeed * float2(17.3f, 31.7f);
  float warp = (1.0f - edgeFade) * 0.125f * simplex2D(noiseP);
  float gradPos = shapeUV.x * 0.9f + shapeUV.y * 0.1f - u.time * 0.05f + warp;
  float3 color = samplePalette(colors, u.numberOfColors, gradPos);

  float alpha;
  if (u.lightMode != 0) {
    alpha = saturate(pow(u.intensity * light, u.falloff * 0.3f));
  } else {
    float3 hdr = pow(light, u.falloff * 0.3f) * color * u.intensity;
    color = hableTonemap(hdr);
    alpha = saturate(dot(color, float3(0.2126f, 0.7152f, 0.0722f)));
  }

  // Fade out near the top (50pt) and bottom (200pt) of the view.
  alpha *= smoothstep(0.0f, 50.0f, pixel.y) * smoothstep(0.0f, 200.0f, u.viewSize.y - pixel.y);

  // +-3/255 triangular dither against banding in the soft falloff.
  float dither = triangularNoise(hash12(pixel)) * (3.0f / 255.0f);
  return float4(color + dither, saturate(alpha + dither));
}
"""
