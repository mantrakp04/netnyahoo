import ExpoModulesCore
import MetalKit

/// The window background behind the tabs and content card.
///
/// With `vibrancy` (the browser window's own backdrop) it is Dia 1.50's window treatment
/// (`PlatformWindowViewController.backgroundBaseView` + `.backgroundOverlayTintView`, WindowTreatment
/// module; docs/dia-spec.md › Window translucency), built from plain AppKit views:
/// - an NSVisualEffectView blending the desktop behind the window (`WindowBackgroundBaseView`):
///   `.behindWindow`, `isEmphasized`, the default `.followsWindowActiveState`, material 29 (dark, a
///   private material) or `.hudWindow` (light). AppKit swaps it for an opaque fill while the window
///   is inactive or Reduce Transparency is on, so the window goes opaque exactly when Dia's does.
/// - over it (`WindowBackgroundOverlayTintView`): the
///   `WindowBackground/BaseTint` fill (black 0.4 / white 0.8), then, in a view at alpha 0.5 (dark) /
///   0.75 (light), a vertical gradient of the profile tint at `tintAlpha`: the tint at the top, the
///   tint with its HSL lightness raised by `tintLightness` at the bottom.
/// Nothing redraws per frame: the layers only change with the props and the appearance.
///
/// Without it (New Tab postcards) it's the older Metal backdrop: a two-stop gradient interpolated
/// in OKLab with film grain multiply-blended on top (Dia's ARC_WindowThemeUI `gradientFragment` +
/// `renderFragment`), redrawn only on resize and prop changes.
final class WindowBackdropView: MetalSurface {
  /// Must match `BackdropUniforms` in the shader.
  struct Uniforms {
    var labA = SIMD4<Float>(0.27, 0.02, 0.0, 1)
    var labB = SIMD4<Float>(0.23, 0.02, 0.0, 1)
    var viewSize = SIMD2<Float>(0, 0)
    var direction = SIMD2<Float>(0, 1)
    var grainOpacity: Float = 0.1
    var grainScale: Float = 1
    var pad = SIMD2<Float>(0, 0)
  }

  private var uniforms = Uniforms()
  private var treatment: WindowTreatmentView?
  private var tint = WindowTreatmentView.Tint()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    metalView.isPaused = true
    metalView.enableSetNeedsDisplay = true
  }

  func setColors(_ hex: [String]) {
    let rgba = hex.compactMap { SIMD4<Float>(hex: $0) }
    guard let first = rgba.first else { return }
    uniforms.labA = Self.oklab(first)
    uniforms.labB = Self.oklab(rgba.last ?? first)
    metalView.needsDisplay = true
  }

  func setVibrancy(_ on: Bool) {
    guard on != (treatment != nil) else { return }
    if on {
      let view = WindowTreatmentView(frame: bounds)
      view.tint = tint
      addSubview(view, positioned: .below, relativeTo: metalView)
      treatment = view
    } else {
      treatment?.removeFromSuperview()
      treatment = nil
    }
    // The Metal gradient is the non-vibrant backdrop; the treatment replaces it.
    metalView.isHidden = on
    if !on { metalView.needsDisplay = true }
  }

  func setTint(_ update: (inout WindowTreatmentView.Tint) -> Void) {
    update(&tint)
    treatment?.tint = tint
  }

  func setAngle(_ degrees: Double) {
    let r = Float(degrees) * .pi / 180
    uniforms.direction = SIMD2(sin(r), -cos(r)) // 0° = bottom→top, like CSS
    metalView.needsDisplay = true
  }

  func set(_ key: WritableKeyPath<Uniforms, Float>, _ value: Float) {
    uniforms[keyPath: key] = value
    metalView.needsDisplay = true
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    treatment?.frame = bounds
    if treatment == nil { metalView.needsDisplay = true }
  }

  override class var fragmentName: String { "backdropFragment" }

  override func encode(_ encoder: MTLRenderCommandEncoder, size: SIMD2<Float>) {
    uniforms.viewSize = size
    encoder.setFragmentBytes(&uniforms, length: MemoryLayout<Uniforms>.stride, index: 0)
  }

  /// sRGB → OKLab (Björn Ottosson), alpha passed through.
  static func oklab(_ c: SIMD4<Float>) -> SIMD4<Float> {
    func lin(_ x: Float) -> Float { x <= 0.04045 ? x / 12.92 : pow((x + 0.055) / 1.055, 2.4) }
    let r = lin(c.x), g = lin(c.y), b = lin(c.z)
    let l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    let m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    let s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return SIMD4(
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
      c.w)
  }

  override class var shaderSource: String { backdropSource }
}

let backdropSource = """
struct BackdropUniforms {
  float4 labA;       // OKLab + alpha at the gradient start
  float4 labB;       // OKLab + alpha at the gradient end
  float2 viewSize;
  float2 direction;  // unit vector, uv space
  float grainOpacity;
  float grainScale;  // points per grain cell
  float2 pad;
};

// OKLab -> linear sRGB -> gamma sRGB. Same constants as Dia's gradientFragment.
static float3 oklabToSRGB(float3 lab) {
  float3 lms = float3(dot(lab, float3(1.0f, 0.3963377774f, 0.2158037573f)),
                      dot(lab, float3(1.0f, -0.1055613458f, -0.0638541728f)),
                      dot(lab, float3(1.0f, -0.0894841775f, -1.2914855480f)));
  lms = lms * lms * lms;
  float3 lin = float3(dot(lms, float3(4.0767416621f, -3.3077115913f, 0.2309699292f)),
                      dot(lms, float3(-1.2684380046f, 2.6097574011f, -0.3413193965f)),
                      dot(lms, float3(-0.0041960863f, -0.7034186147f, 1.7076147010f)));
  float3 a = abs(lin);
  float3 encoded = sign(lin) * (1.055f * pow(a, 1.0f / 2.4f) - 0.055f);
  return select(encoded, lin * 12.92f, a <= 0.0031308f);
}

static inline float grainHash(float2 p) {
  float3 p3 = fract(float3(p.xyx) * 0.1031f);
  p3 += dot(p3, p3.yzx + 33.33f);
  return fract((p3.x + p3.y) * p3.z);
}

fragment float4 backdropFragment(FullscreenOut in [[stage_in]],
                                 constant BackdropUniforms &u [[buffer(0)]]) {
  float t = saturate(dot(in.uv - 0.5f, u.direction) + 0.5f);
  float4 lab = mix(u.labA, u.labB, t);
  float3 base = oklabToSRGB(lab.xyz);

  // Multiply-blend a grey grain tile: base * (1 - a * (1 - g)).
  float2 cell = floor(in.uv * u.viewSize / max(u.grainScale, 0.25f));
  float g = grainHash(cell);
  float3 rgb = base * (1.0f - u.grainOpacity * (1.0f - g));
  return float4(saturate(rgb), lab.w);
}
"""

/// Dia 1.50's window background (see WindowBackdropView): a behind-window blur under a translucent
/// profile tint. Plain AppKit views and layers; nothing draws per frame.
final class WindowTreatmentView: NSView {
  struct Tint: Equatable {
    /// `BackgroundTintInfo.color`: the profile colour, a Display P3 colour (Dia lightens it in P3).
    var color = NSColor(displayP3Red: 0.5, green: 0.5, blue: 0.5, alpha: 1)
    /// `BackgroundTintInfo.gradientAlpha` ?? (isNeutralTheme ? 0.12 : 0.36).
    var alpha: CGFloat = 0.36
    /// `gradientLightnessDelta`: 0.25 with the New Tab rebrand, 0.4 without.
    var lightness: CGFloat = 0.25
  }

  var tint = Tint() { didSet { if tint != oldValue { updateTint() } } }

  private let blur = NSVisualEffectView()
  private let overlay = NSView()
  private let baseTint = CALayer()
  private let gradient = CAGradientLayer()

  override init(frame: NSRect) {
    super.init(frame: frame)
    blur.blendingMode = .behindWindow
    blur.isEmphasized = true
    updateState()
    NotificationCenter.default.addObserver(self, selector: #selector(updateState), name: WindowActivity.changed, object: nil)
    overlay.wantsLayer = true
    overlay.layer?.addSublayer(baseTint)
    overlay.layer?.addSublayer(gradient)
    // Bottom (y 0 in the unflipped overlay) → top: the lightened tint, then the tint.
    gradient.startPoint = CGPoint(x: 0.5, y: 0)
    gradient.endPoint = CGPoint(x: 0.5, y: 1)
    for layer in [baseTint, gradient] as [CALayer] {
      layer.actions = ["bounds": NSNull(), "position": NSNull(), "backgroundColor": NSNull(), "colors": NSNull(), "opacity": NSNull()]
    }
    addSubview(blur)
    addSubview(overlay)
    updateAppearance()
    updateTint()
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func layout() {
    super.layout()
    blur.frame = bounds
    overlay.frame = bounds
    baseTint.frame = overlay.bounds
    gradient.frame = overlay.bounds
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    needsLayout = true
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    updateAppearance()
  }

  /// DEV: `WindowActivity.override` (NETNYAHOO_SHADERS_FORCE_KEY) shows the key look in a
  /// background instance, whose windows are never key.
  @objc private func updateState() {
    blur.state = WindowActivity.override == true ? .active : .followsWindowActiveState
  }

  private var isDark: Bool { effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua }

  /// `WindowBackgroundBaseView.updateLayer` and `WindowBackgroundOverlayTintView.updateLayer`.
  private func updateAppearance() {
    let dark = isDark
    blur.material = NSVisualEffectView.Material(rawValue: dark ? 29 : 13) ?? .hudWindow
    gradient.opacity = dark ? 0.5 : 0.75
    baseTint.backgroundColor = (dark ? NSColor(white: 0, alpha: 0.4) : NSColor(white: 1, alpha: 0.8)).cgColor
  }

  private func updateTint() {
    let color = tint.color.usingColorSpace(.displayP3) ?? tint.color
    let lighter = Self.adjustingLightness(color, by: tint.lightness)
    gradient.colors = [lighter, color].map { $0.withAlphaComponent(tint.alpha).cgColor }
  }

  /// The colour with its HSL lightness raised by `delta` (clamped to 0…1), as Dia's colour helper
  /// does it: HSL in the colour's own (Display P3) space.
  static func adjustingLightness(_ c: NSColor, by delta: CGFloat) -> NSColor {
    let r = c.redComponent, g = c.greenComponent, b = c.blueComponent
    let maxC = max(r, g, b), minC = min(r, g, b)
    var h: CGFloat = 0, s: CGFloat = 0
    let l = (maxC + minC) / 2
    if maxC != minC {
      let d = maxC - minC
      s = l > 0.5 ? d / (2 - maxC - minC) : d / (maxC + minC)
      h = maxC == r ? (g - b) / d + (g < b ? 6 : 0) : maxC == g ? (b - r) / d + 2 : (r - g) / d + 4
      h /= 6
    }
    let l2 = min(max(l + delta, 0), 1)
    func channel(_ p: CGFloat, _ q: CGFloat, _ t0: CGFloat) -> CGFloat {
      var t = t0
      if t < 0 { t += 1 }
      if t > 1 { t -= 1 }
      if t < 1.0 / 6 { return p + (q - p) * 6 * t }
      if t < 0.5 { return q }
      if t < 2.0 / 3 { return p + (q - p) * (2.0 / 3 - t) * 6 }
      return p
    }
    if s == 0 { return NSColor(displayP3Red: l2, green: l2, blue: l2, alpha: c.alphaComponent) }
    let q = l2 < 0.5 ? l2 * (1 + s) : l2 + s - l2 * s
    let p = 2 * l2 - q
    return NSColor(displayP3Red: channel(p, q, h + 1.0 / 3), green: channel(p, q, h), blue: channel(p, q, h - 1.0 / 3), alpha: c.alphaComponent)
  }
}
