import ExpoModulesCore
import MetalKit

/// Dia's CommandBarPowerUpView: the power-up band (PowerUpBackgroundView), a faint, slightly
/// sheared wash of the theme palette that enters from the bottom of the New Tab page and
/// sweeps up past the command bar, plus, when the area light is off, the halo (HaloView) that
/// wraps the bar. Shaders reconstructed from `powerUpFragment` / `haloFragment` (docs/dia-spec.md).
final class PowerUpView: MetalSurface {
  var direction: Int32 = 0          // 0 = up (enters from the bottom)
  /// CommandBarPowerUpView.speed also sets the halo's.
  var speed: Float = 1.25 {
    didSet { halo?.speed = speed }
  }
  var delay: Float = 0
  var fadeOutStart: Float = 1.0
  var fadeOutDuration: Float = 2.0
  var origin: Float = 0.5
  /// The command bar's corner radius; the halo traces it at +2.
  var cornerRadius: Float = 20 {
    didSet { halo?.cornerRadius = cornerRadius + 2 }
  }
  /// Palette stops in OKLab (L, a, b, alpha), as the shader expects.
  private var colors: [SIMD4<Float>] = PowerUpView.oklab(PowerUpView.palettes["pink"]!)
  /// sRGB palette, for the halo.
  private var srgbColors: [SIMD4<Float>] = PowerUpView.palettes["pink"]!
  private var halo: HaloView?
  /// The rect the halo wraps (the command bar), in this view's coordinates.
  private var haloFrame: CGRect?

  /// CommandBarPowerUpView's per-hue tables (sRGB, converted to OKLab on upload). These are
  /// brighter than the area light's; `default` is used when there's no theme.
  static let palettes: [String: [SIMD4<Float>]] = [
    "pink": ["#FF6AFF", "#FE8097", "#FF9966", "#FCE0FF", "#FA62B1"],
    "purple": ["#7293FF", "#7D5DFF", "#E263FF", "#FF81EE", "#A585FF"],
    "red": ["#FD3131", "#FA607C", "#FDA733", "#FFEBC9", "#F55F5D"],
    "orange": ["#FFBB62", "#FE8026", "#FF7C5F", "#FFFCBE", "#FF9D00"],
    "yellow": ["#FFD11A", "#FFE23E", "#FFA144", "#F8FFB5", "#FFE30A"],
    "green": ["#90CE01", "#43CC60", "#0CD9EB", "#C3EEAF", "#9EDD73"],
    "blue": ["#4ACCFF", "#5FADFF", "#60F0CF", "#9CEEFF", "#72C1FF"],
    "default": ["#7E1731", "#334CB4", "#2D81FF", "#2D81FF", "#FFF268", "#F70305", "#FE64CD"],
  ].mapValues { $0.compactMap { SIMD4<Float>(hex: $0) } }

  /// Frame-counted clock (Dia adds 1/fps per frame); the band finishes at 3.75.
  private var time: Float = 0
  private let finishTime: Float = 3.75

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    metalView.preferredFramesPerSecond = 60
    // PowerUpBackgroundView puts a Core Animation gaussianBlur (inputRadius 24) on the
    // MTKView's layer; it's what turns the shader's hard stagger steps into soft wings.
    if let filterClass = NSClassFromString("CAFilter") as? NSObject.Type,
       let blur = filterClass.perform(NSSelectorFromString("filterWithType:"), with: "gaussianBlur")?
         .takeUnretainedValue() as? NSObject {
      blur.setValue(24, forKey: "inputRadius")
      metalView.layer?.filters = [blur]
    }
  }

  func setPalette(_ value: [String]) {
    let srgb: [SIMD4<Float>]
    if value.count == 1, let named = Self.palettes[value[0]] {
      srgb = named
    } else {
      srgb = value.compactMap { SIMD4<Float>(hex: $0) }
    }
    if !srgb.isEmpty {
      colors = Self.oklab(srgb)
      srgbColors = srgb
      halo?.setColors(srgb)
    }
  }

  /// CommandBarPowerUpView(showHalo:): the halo view spans `frame` outset by its 50pt inset.
  /// nil removes it (Dia shows it only while the area light is off).
  func setHaloFrame(_ frame: CGRect?) {
    haloFrame = frame
    if frame != nil, halo == nil {
      let view = HaloView()
      view.speed = speed
      view.cornerRadius = cornerRadius + 2
      view.setColors(srgbColors)
      addSubview(view)
      halo = view
    } else if frame == nil, let view = halo {
      view.removeFromSuperview()
      halo = nil
    }
    layoutHalo()
  }

  private func layoutHalo() {
    guard let halo, let haloFrame else { return }
    halo.frame = haloFrame.insetBy(dx: -CGFloat(halo.inset), dy: -CGFloat(halo.inset))
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    layoutHalo()
  }

  // RN lays out top-down; the halo frame arrives in those coordinates.
  override var isFlipped: Bool { true }

  /// Under Reduce Motion Dia never creates the band (the New Tab entrance is skipped).
  func replay() {
    time = 0
    metalView.isPaused = window == nil || WindowActivity.reduceMotion
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window != nil { replay() } else { metalView.isPaused = true }
  }

  static func oklab(_ colors: [SIMD4<Float>]) -> [SIMD4<Float>] {
    colors.map { WindowBackdropView.oklab($0) }
  }

  override class var premultipliedOutput: Bool { true }
  override class var fragmentName: String { "powerUpFragment" }

  override func encode(_ encoder: MTLRenderCommandEncoder, size: SIMD2<Float>) {
    var dir = direction
    var count = Int32(colors.count)
    var t = time
    var s = speed
    var d = delay
    var fStart = fadeOutStart
    var fDuration = fadeOutDuration
    var o = origin
    encoder.setFragmentBytes(&dir, length: 4, index: 0)
    encoder.setFragmentBytes(&count, length: 4, index: 1)
    colors.withUnsafeBytes { encoder.setFragmentBytes($0.baseAddress!, length: $0.count, index: 2) }
    encoder.setFragmentBytes(&t, length: 4, index: 3)
    encoder.setFragmentBytes(&s, length: 4, index: 4)
    encoder.setFragmentBytes(&d, length: 4, index: 5)
    encoder.setFragmentBytes(&fStart, length: 4, index: 6)
    encoder.setFragmentBytes(&fDuration, length: 4, index: 7)
    encoder.setFragmentBytes(&o, length: 4, index: 8)
    time += 1 / Float(max(metalView.preferredFramesPerSecond, 1))
    if time >= finishTime {
      DispatchQueue.main.async { [weak self] in self?.metalView.isPaused = true }
    }
  }

  override class var shaderSource: String { powerUpSource }
}

/// Dia's HaloView: a light that runs around the command bar's outline, from the bottom centre
/// up both sides to the top (easeOutExpo), with a noisy glow that tightens onto the edge.
/// CommandBarPowerUpView sets inset 50, delay 0.18 and cornerRadius +2; the rest are
/// HaloView's defaults. Shader reconstructed from `haloFragment` (docs/dia-spec.md).
final class HaloView: MetalSurface {
  var speed: Float = 1
  var delay: Float = 0.18
  /// The outline sits this far inside the view on every side.
  var inset: Float = 50
  var direction: Int32 = 0          // 0 = starts at the bottom centre
  var cornerRadius: Float = 18
  var fadeOutStart: Float = 1.0
  var fadeOutDuration: Float = 0.2
  /// Two sRGB stops, mixed by noise. Dia's default is #FF844F → #F773A5.
  private var colors: [SIMD4<Float>] = [SIMD4(1, 0.5176, 0.3098, 1), SIMD4(0.9686, 0.4510, 0.6471, 1)]

  /// Frame-counted clock (1/fps per frame); Dia pauses the view once it passes 2.
  private var time: Float = 0
  private let finishTime: Float = 2

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    metalView.preferredFramesPerSecond = 60
    metalView.isPaused = true
  }

  /// One colour is used for both stops (Dia 1.50 passes the single theme colour).
  func setColors(_ srgb: [SIMD4<Float>]) {
    guard let first = srgb.first else { return }
    colors = [first, srgb.count > 1 ? srgb[1] : first]
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    time = 0
    metalView.isPaused = window == nil || WindowActivity.reduceMotion
  }

  override class var premultipliedOutput: Bool { true }
  override class var fragmentName: String { "haloFragment" }

  override func encode(_ encoder: MTLRenderCommandEncoder, size: SIMD2<Float>) {
    var resolution = size
    var dir = direction
    var dark: Bool = effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
    var t = time
    var s = speed
    var d = delay
    var fStart = fadeOutStart
    var fDuration = fadeOutDuration
    var i = inset
    var r = cornerRadius
    encoder.setFragmentBytes(&resolution, length: 8, index: 0)
    encoder.setFragmentBytes(&dir, length: 4, index: 1)
    colors.withUnsafeBytes { encoder.setFragmentBytes($0.baseAddress!, length: $0.count, index: 2) }
    encoder.setFragmentBytes(&dark, length: 1, index: 3)
    encoder.setFragmentBytes(&t, length: 4, index: 4)
    encoder.setFragmentBytes(&s, length: 4, index: 5)
    encoder.setFragmentBytes(&d, length: 4, index: 6)
    encoder.setFragmentBytes(&fStart, length: 4, index: 7)
    encoder.setFragmentBytes(&fDuration, length: 4, index: 8)
    encoder.setFragmentBytes(&i, length: 4, index: 9)
    encoder.setFragmentBytes(&r, length: 4, index: 10)
    time += 1 / Float(max(metalView.preferredFramesPerSecond, 1))
    if time > finishTime {
      DispatchQueue.main.async { [weak self] in self?.metalView.isPaused = true }
    }
  }

  override class var shaderSource: String { haloSource }
}

let haloSource = """
// Simplex noise with Dave Hoskins' hash33 (4th-power kernel, scaled by 31.316).
static inline float3 haloHash33(float3 p) {
    float3 p3 = fract(p * float3(0.1031f, 0.11369f, 0.13787f));
    p3 += dot(p3, p3.yxz + 19.19f);
    return -1.0f + 2.0f * fract((p3.xxy + p3.yzz) * p3.zyx);
}

static float haloNoise(float3 p) {
    const float F3 = 0.333333343f, G3 = 0.166666672f;
    float3 s = floor(p + (p.x + p.y + p.z) * F3);
    float3 x = p - s + (s.x + s.y + s.z) * G3;
    float3 e = select(float3(0.0f), float3(1.0f), x - x.yzx >= 0.0f);
    float3 i1 = e * (1.0f - e.zxy);
    float3 i2 = 1.0f - e.zxy * (1.0f - e);
    float3 x1 = x - i1 + G3;
    float3 x2 = x - i2 + 2.0f * G3;
    float3 x3 = x - 0.5f;
    float4 w = max(0.6f - float4(dot(x, x), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0f);
    w = pow(w, float4(4.0f));
    float4 d = float4(dot(x, haloHash33(s)), dot(x1, haloHash33(s + i1)),
                      dot(x2, haloHash33(s + i2)), dot(x3, haloHash33(s + 1.0f)));
    return dot(float4(31.316f), d * w);
}

// Premultiplied output. The outline is the view inset by `inset` on every side.
fragment float4 haloFragment(FullscreenOut in                 [[stage_in]],
                             constant float2 &resolution      [[buffer(0)]],
                             constant int    &direction       [[buffer(1)]],
                             constant float4 *colors          [[buffer(2)]],
                             constant bool   &isDark          [[buffer(3)]],
                             constant float  &time            [[buffer(4)]],
                             constant float  &speed           [[buffer(5)]],
                             constant float  &delay           [[buffer(6)]],
                             constant float  &fadeOutStart    [[buffer(7)]],
                             constant float  &fadeOutDuration [[buffer(8)]],
                             constant float  &inset           [[buffer(9)]],
                             constant float  &cornerRadius    [[buffer(10)]])
{
    // Normalized space: the short axis spans [-1, 1].
    float aspect = resolution.x / resolution.y;
    float2 p = (in.uv - 0.5f) * 2.0f;
    p.x *= aspect;
    float inset2 = inset * 2.0f;
    float hx = 1.0f - inset2 / resolution.x;
    float hy = 1.0f - inset2 / resolution.y;
    float2 halfSize = aspect > 1.0f ? float2(hx * aspect, hy) : float2(hx, hy / aspect);
    float r = cornerRadius / min(resolution.x - inset2, resolution.y - inset2);
    float dist = abs(length(max(abs(p) - halfSize + r, 0.0f)) - r);

    // The lit arc: angle 0 at the bottom centre (direction 0), 1 at the top, both sides at once.
    float t = speed * 0.8f * time - delay;
    float sweep = (t == 1.0f) ? 1.25f : (1.0f - pow(2.0f, -10.0f * t)) * 1.25f;
    float2 n = p / halfSize;
    float angle = atan2(n.y, n.x);
    if (angle < 0.0f) angle += 6.28318548f;
    float offset = direction == 1 ? 1.57079637f : direction == 2 ? 3.14159274f : direction == 3 ? 4.71238899f : 0.0f;
    float around = fmod(1.25f - fmod(offset + angle, 6.28318548f) * 0.159154937f, 1.0f);
    if (around > 0.5f) around = 1.0f - around;
    around *= 2.0f;
    float arc = smoothstep(0.0f, 1.0f, clamp((abs(around - sweep) - 0.22f) * -4.54545450f, 0.0f, 1.0f));

    float line = smoothstep(0.0f, 1.0f, clamp((dist - 0.025f) * -40.0f, 0.0f, 1.0f)) * arc * (isDark ? 0.4f : 1.0f);

    // Glow: a noisy band around the outline that narrows from ~0.95 to nothing as t → 1.
    float nz = haloNoise(float3(p * 0.5f, time)) + 0.5f;
    float glowWidth = mix(0.1f, 0.2f, nz);
    float shrink = (1.0f - t) * 0.95f;
    float g1 = shrink == 0.0f ? 0.0f : clamp((dist - shrink) / -shrink, 0.0f, 1.0f);
    float g2 = clamp((dist - glowWidth) / -glowWidth, 0.0f, 1.0f);
    float g = g1 * g2;
    float glow = g * g * (isDark ? 0.1f : 0.12f) * arc * (3.0f - 2.0f * g1) * (3.0f - 2.0f * g2);

    float alpha = mix(colors[0].a, colors[1].a, nz) * clamp(glow + line, 0.0f, 1.0f);
    if (t > fadeOutStart) {
        alpha *= 1.0f - clamp((t - fadeOutStart) / fadeOutDuration, 0.0f, 1.0f);
    }
    float3 rgb = clamp(mix(colors[0].rgb, colors[1].rgb, nz) + line, 0.0f, 1.0f);
    return float4(rgb * alpha, alpha);
}
"""

let powerUpSource = """
// Full-screen quad, drawn as a 4-vertex triangle strip (IR: @_ZL9positions /
// @_ZL3uvs).


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// easeOutExpo: 1 - 2^(-10 t), exactly 1 at t == 1.
static inline float easeOutExpo(float t) {
    return (t == 1.0f) ? 1.0f : 1.0f - pow(2.0f, -10.0f * t);
}

// easeInOutQuart.
static inline float easeInOutQuart(float t) {
    return (t < 0.5f) ? 8.0f * t * t * t * t
                      : 1.0f - pow(-2.0f * t + 2.0f, 4.0f) * 0.5f;
}

// Piecewise-linear remap of the cross axis that moves the midpoint 0.5 to
// (1 - o) while keeping 0 -> 0 and 1 -> 1.
static inline float shiftCenter(float v, float o) {
    float mid = 1.0f - o;
    return (v <= 0.5f) ? v * 2.0f * mid
                       : mid + o * 2.0f * (v - 0.5f);
}

// OKLab -> linear sRGB (Björn Ottosson's matrices).
static inline float3 oklabToLinearSRGB(float3 lab) {
    float3 lms = float3(dot(lab, float3(1.0f,  0.396337777f,   0.215803757f)),
                        dot(lab, float3(1.0f, -0.105561346f,  -0.0638541728f)),
                        dot(lab, float3(1.0f, -0.0894841775f, -1.29148555f)));
    lms = pow(lms, float3(3.0f));
    return float3(dot(lms, float3( 4.0767417f,     -3.3077116f,    0.230969936f)),
                  dot(lms, float3(-1.26843798f,     2.60975742f,  -0.341319382f)),
                  dot(lms, float3(-0.00419608643f, -0.703418612f,  1.70761466f)));
}

// Linear -> sRGB transfer, sign-preserving.
static inline float linearToSRGB(float c) {
    float ac = abs(c);
    if (ac <= 0.00313080009f) {
        return c * 12.9200001f;
    }
    return sign(c) * (pow(ac, 0.416666657f) * 1.05499995f - 0.0549999997f);
}

// Evenly spaced palette lookup, smoothstep between neighbouring stops.
static inline float4 samplePalette(constant float4 *colors, int n1, float v) {
    float f  = float(n1) * v;
    int   i  = int(floor(f));
    float4 a = colors[i];
    float4 b = colors[min(i + 1, n1)];
    return mix(a, b, smoothstep(0.0f, 1.0f, f - float(i)));
}

// Soft rectangular window in the remapped uv space, built from one fade pair
// per screen axis (x: left/right, y: top/bottom).
//   width  : cross-axis fade width on both sides (0.45)
//   start  : fade-in at the origin end of the travel axis (0.2)
//   end    : fade-out at the far end of the travel axis (0.15)
//   skew   : cross-axis shear per unit of the travel axis (0.25)
// Directions 0/2 travel along y, 1/3 along x; 2 and 1 read the travel axis
// flipped (1 - uv).
float mask(float2 uv, float width, float start, float end, float skew, int direction) {
    float left, right, top, bottom;
    if (direction == 0 || direction == 2) {
        float k = (uv.y - 0.5f) * skew;
        left  = smoothstep(0.0f, width, uv.x + k);
        right = 1.0f - smoothstep(1.0f - width, 1.0f, uv.x - k);
        if (direction == 0) {
            top    = smoothstep(0.0f, start, uv.y);
            bottom = 1.0f - smoothstep(1.0f - end, 1.0f, uv.y);
        } else {
            top    = 1.0f - smoothstep(1.0f - end, 1.0f, 1.0f - uv.y);
            bottom = smoothstep(0.0f, start, 1.0f - uv.y);
        }
    } else {
        float k = (uv.x - 0.5f) * skew;
        top    = smoothstep(0.0f, width, uv.y + k);
        bottom = 1.0f - smoothstep(1.0f - width, 1.0f, uv.y - k);
        if (direction == 1) {
            left  = 1.0f - smoothstep(1.0f - end, 1.0f, 1.0f - uv.x);
            right = smoothstep(0.0f, start, 1.0f - uv.x);
        } else {
            left  = smoothstep(0.0f, start, uv.x);
            right = 1.0f - smoothstep(1.0f - end, 1.0f, uv.x);
        }
    }
    return left * right * top * bottom;
}

// Palette sweep. `progress` is the speed-scaled time; returns sRGB + alpha.
float4 gradient(float2 uv, constant float4 *colors, int numberOfColors,
                float progress, int direction)
{
    // Stagger: the middle of the cross axis lags behind the sides.
    float c = (direction == 0 || direction == 2) ? uv.x : uv.y;
    float p;
    if (c >= 0.200000003f && c < 0.400000006f) {
        p = progress - 0.0250000004f;
    } else if (c >= 0.400000006f && c < 0.600000024f) {
        p = progress - 0.0500000007f;
    } else {
        p = (c >= 0.600000024f && c < 0.800000012f) ? progress - 0.0250000004f : progress;
    }
    p = clamp(p, 0.0f, 1.0f);

    float head = 1.0f - easeInOutQuart(p) * 0.949999988f;   // 1 -> 0.05

    float crossPos, alongPos;
    switch (direction) {
        case 0:  crossPos = uv.x; alongPos = uv.y;        break;
        case 2:  crossPos = uv.x; alongPos = 1.0f - uv.y; break;
        case 1:  crossPos = uv.y; alongPos = 1.0f - uv.x; break;
        default: crossPos = uv.y; alongPos = uv.x;        break;
    }
    float along = alongPos * 0.400000006f;
    float bend  = (1.0f - pow(abs(crossPos - 0.5f) + 0.5f, 5.0f)) * -0.0500000007f;

    int   n1    = numberOfColors - 1;
    bool  past  = along > head;
    float v     = past ? 1.0f : max(bend + along / head, 0.0f);
    float4 col  = samplePalette(colors, n1, v);
    col.a *= p * 0.5f + 0.5f;

    if (past) {
        float4 trail = samplePalette(colors, n1, max(bend + along, 0.0f));
        trail.a *= p * 0.5f;
        float edge = easeOutExpo(1.0f - p) * 0.0500000007f;
        col = mix(col, trail, clamp((along - head) / edge, 0.0f, 1.0f));
    }

    float3 lin = oklabToLinearSRGB(col.rgb);
    return float4(linearToSRGB(lin.r), linearToSRGB(lin.g), linearToSRGB(lin.b),
                  col.a * 0.100000001f);
}

// ---------------------------------------------------------------------------
// Fragment
// ---------------------------------------------------------------------------

fragment float4 powerUpFragment(FullscreenOut in                 [[stage_in]],
                                constant int    &direction       [[buffer(0)]],
                                constant int    &numberOfColors  [[buffer(1)]],
                                constant float4 *colors          [[buffer(2)]],
                                constant float  &time            [[buffer(3)]],
                                constant float  &speed           [[buffer(4)]],
                                constant float  &delay           [[buffer(5)]],
                                constant float  &fadeOutStart    [[buffer(6)]],
                                constant float  &fadeOutDuration [[buffer(7)]],
                                constant float  &origin          [[buffer(8)]])
{
    if ((uint)direction >= 4u) {
        return float4(0.0f);
    }

    // The band's centre starts at `origin` and slides to the middle over the
    // first 2/3 s of (unscaled) time.
    float o = mix(origin, 0.5f, clamp(time * 1.5f, 0.0f, 1.0f));

    // Remap texCoords: travel axis compressed to 80 % of the view, cross axis
    // re-centred on `o`.
    float2 uv;
    switch (direction) {
        case 0:
            uv = float2(shiftCenter(in.uv.x, o),
                        clamp((in.uv.y - 0.200000003f) * 1.25f, 0.0f, 1.0f));
            break;
        case 2:
            uv = float2(shiftCenter(in.uv.x, o),
                        1.0f - clamp((0.800000012f - in.uv.y) * 1.25f, 0.0f, 1.0f));
            break;
        case 1:
            uv = float2(clamp((0.800000012f - in.uv.x) * 1.25f, 0.0f, 1.0f),
                        shiftCenter(in.uv.y, o));
            break;
        default:
            uv = float2(1.0f - clamp((in.uv.x - 0.200000003f) * 1.25f, 0.0f, 1.0f),
                        shiftCenter(in.uv.y, o));
            break;
    }

    float t = time * 0.75f * speed + 0.449999988f - delay;

    float4 col = gradient(uv, colors, numberOfColors, t, direction);
    float  m   = mask(uv, 0.449999988f, 0.200000003f, 0.150000006f, 0.25f, direction);
    col.a = col.a * m * clamp(time * 10.0f, 0.0f, 1.0f);   // 0.1 s fade-in

    if (t > fadeOutStart) {
        col.a *= 1.0f - clamp((t - fadeOutStart) / fadeOutDuration, 0.0f, 1.0f);
    }
    return float4(col.rgb * col.a, col.a);
}
"""
