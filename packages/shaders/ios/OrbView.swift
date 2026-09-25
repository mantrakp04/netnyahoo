import ExpoModulesCore
import MetalKit

/// Dia's logo above the New Tab command bar: the 1.49 glass orb, or the 1.50 "Sunglow"
/// hand-painted mark in the profile colour. Static: redraws only on resize or
/// appearance/tint/variant change.
final class OrbView: MetalSurface {
  /// Must match `OrbUniforms` in the shader.
  struct Uniforms {
    var tint = SIMD4<Float>(0.95, 0.72, 0.82, 1)
    /// Painted: OKLab (L5, L50, L95) of the paint, and the style.
    var paintTone = SIMD4<Float>(0, 0, 0, 0)
    /// Painted: OKLab (a, b), stroke angle (radians), style amount.
    var paintChroma = SIMD4<Float>(0, 0, 0, 0)
    var viewSize = SIMD2<Float>(0, 0)
    var dark: Float = 1
    /// 0 = glass orb, 1 = painted.
    var painted: Float = 0
  }

  /// One painting per profile colour, light and dark, like Dia's `{colour}{,-dark}.png`.
  struct Paint {
    var tone: SIMD3<Float>
    var chroma: SIMD2<Float>
    var style: Float
    var angle: Float = 0
    var amount: Float = 0
  }

  /// Measured from the logo-sized middle (68.5/84) of each of Dia 1.50's paintings: OKLab
  /// lightness 5th/50th/95th percentiles and mean a/b. Style and stroke direction by eye.
  static let paints: [String: (light: Paint, dark: Paint)] = {
    func pair(_ l: SIMD3<Float>, _ lc: SIMD2<Float>, _ d: SIMD3<Float>, _ dc: SIMD2<Float>, style: Float, angle: Float = 0, amount: Float = 0) -> (Paint, Paint) {
      (Paint(tone: l, chroma: lc, style: style, angle: angle, amount: amount), Paint(tone: d, chroma: dc, style: style, angle: angle, amount: amount))
    }
    return [
      "neutral": pair([0.510, 0.663, 0.760], [0, 0], [0.360, 0.482, 0.573], [0, 0], style: 0, amount: 0.3),
      "red": pair([0.563, 0.675, 0.723], [0.0837, 0.0547], [0.365, 0.456, 0.500], [0.0705, 0.0471], style: 0, angle: .pi / 2, amount: 0.25),
      "orange": pair([0.710, 0.748, 0.778], [0.0605, 0.0706], [0.593, 0.606, 0.620], [0.0584, 0.0756], style: 3),
      "yellow": pair([0.747, 0.797, 0.844], [0.0238, 0.1130], [0.639, 0.695, 0.745], [0.0293, 0.1236], style: 2),
      "green": pair([0.513, 0.695, 0.839], [-0.0680, 0.0363], [0.348, 0.491, 0.647], [-0.0605, 0.0328], style: 0, angle: -0.55, amount: 1),
      "blue": pair([0.788, 0.836, 0.864], [-0.0051, -0.0353], [0.606, 0.666, 0.700], [-0.0080, -0.0499], style: 1),
      "pink": pair([0.726, 0.801, 0.865], [0.0334, 0.0118], [0.505, 0.583, 0.666], [0.0451, 0.0155], style: 4, amount: 0.4),
      "purple": pair([0.646, 0.737, 0.829], [0.0162, -0.0480], [0.457, 0.540, 0.644], [0.0180, -0.0571], style: 4, amount: 0.25),
    ]
  }()

  private var uniforms = Uniforms()
  private var paintName = "blue"

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    metalView.isPaused = true
    metalView.enableSetNeedsDisplay = true
  }

  func setTint(_ hex: String) {
    if let c = SIMD4<Float>(hex: hex) { uniforms.tint = c }
    metalView.needsDisplay = true
  }

  func setVariant(_ variant: String) {
    uniforms.painted = variant == "painted" ? 1 : 0
    metalView.needsDisplay = true
  }

  /// Dia's texture name for the profile colour (neutral, red, orange, yellow, green, blue, pink, purple).
  func setPaint(_ name: String) {
    paintName = Self.paints[name] == nil ? "blue" : name
    metalView.needsDisplay = true
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    metalView.needsDisplay = true
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    metalView.needsDisplay = true
  }

  override class var premultipliedOutput: Bool { true }
  override class var fragmentName: String { "orbFragment" }

  override func encode(_ encoder: MTLRenderCommandEncoder, size: SIMD2<Float>) {
    let dark = effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
    uniforms.viewSize = size
    uniforms.dark = dark ? 1 : 0
    // Like Dia, the "-dark" painting follows the view's appearance.
    if let pair = Self.paints[paintName] {
      let paint = dark ? pair.dark : pair.light
      uniforms.paintTone = SIMD4(paint.tone, paint.style)
      uniforms.paintChroma = SIMD4(paint.chroma.x, paint.chroma.y, paint.angle, paint.amount)
    }
    encoder.setFragmentBytes(&uniforms, length: MemoryLayout<Uniforms>.stride, index: 0)
  }

  override class var shaderSource: String { orbSource }
}

let orbSource = """
struct OrbUniforms {
  float4 tint;         // glass: unused, kept for theme hooks
  float4 paintTone;    // painted: OKLab lightness 5th/50th/95th percentiles, style
  float4 paintChroma;  // painted: OKLab a, b, stroke angle (radians), style amount
  float2 viewSize;     // points; the logo box outset by `orbPad` on every side
  float dark;
  float painted;       // 0 = glass orb (1.49), 1 = painted mark (1.50)
};

constant float orbPad = 2.0f;

// Same smooth subtraction as Dia's edge-light logo SDF, so the rim light traces this outline.
static inline float orbSmoothSubtract(float a, float b, float k) {
  float h = clamp(0.5f - 0.5f * (b + a) / k, 0.0f, 1.0f);
  return mix(a, -b, h) + k * h * (1.0f - h);
}

static inline float paintHash(float2 p) {
  p = fract(p * float2(123.34f, 456.21f));
  p += dot(p, p + 45.32f);
  return fract(p.x * p.y);
}

static inline float paintNoise(float2 p) {
  float2 i = floor(p), f = fract(p);
  float2 w = f * f * (3.0f - 2.0f * f);
  float a = paintHash(i), b = paintHash(i + float2(1, 0)), c = paintHash(i + float2(0, 1)), d = paintHash(i + float2(1, 1));
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

static inline float paintFbm(float2 p) {
  float v = 0.0f, a = 0.5f;
  for (int i = 0; i < 5; i++) { v += a * paintNoise(p); p = p * 2.03f + 17.1f; a *= 0.5f; }
  return v / 0.96875f;
}

static inline float3 paintFromOKLab(float3 lab) {
  float3 lms = float3(lab.x + 0.3963377774f * lab.y + 0.2158037573f * lab.z,
                      lab.x - 0.1055613458f * lab.y - 0.0638541728f * lab.z,
                      lab.x - 0.0894841775f * lab.y - 1.2914855480f * lab.z);
  lms = lms * lms * lms;
  float3 c = saturate(float3(4.0767416621f * lms.x - 3.3077115913f * lms.y + 0.2309699292f * lms.z,
                             -1.2684380046f * lms.x + 2.6097574011f * lms.y - 0.3413193965f * lms.z,
                             -0.0041960863f * lms.x - 0.7034186147f * lms.y + 1.7076147010f * lms.z));
  return select(c * 12.92f, 1.055f * pow(c, 1.0f / 2.4f) - 0.055f, c > 0.0031308f);
}

// Brush strokes along `ang` (radians), bending with a slow warp; bristle streaks inside.
static inline float paintStrokes(float2 q, float ang, float bend) {
  float2 w = q + 0.08f * bend * float2(paintNoise(q * 2.3f + 7.0f) - 0.5f, paintNoise(q * 2.3f + 19.0f) - 0.5f);
  float a = ang + bend * (paintNoise(q * 1.3f + 3.0f) - 0.5f);
  float2 dir = float2(cos(a), sin(a));
  float across = dot(w, float2(-dir.y, dir.x)), along = dot(w, dir);
  return 0.4f * paintNoise(float2(across * 11.0f, along * 1.4f))
       + 0.3f * paintNoise(float2(across * 42.0f + 3.0f, along * 3.0f))
       + 0.3f * paintNoise(float2(across * 150.0f + 11.0f, along * 7.0f));
}

// Canvas weave: a fine two-way thread pattern.
static inline float paintCanvas(float2 q) {
  float2 t = q * 95.0f;
  return 0.5f + 0.25f * sin(t.x * 6.2831f) * sin(t.y * 6.2831f + paintNoise(t * 0.2f) * 3.0f);
}

// Dia 1.50 paints its New Tab mark per profile colour (BoostBrowser_PowerUp.bundle's
// {colour}{,-dark}.png, aspect-filled into the 84pt icon view and masked to the logo). We don't
// ship that artwork; this paints a stand-in per colour: the texture's character (style), its OKLab
// lightness percentiles and mean chroma, measured from the logo-sized middle of each painting.
// Styles: 0 brush strokes, 1 cloudy wash, 2 impasto, 3 matte, 4 mottled canvas.
static inline float3 paintedMark(float2 q, float4 tone, float4 chroma) {
  int style = int(tone.w + 0.5f);
  float v;
  if (style == 0) {
    v = paintStrokes(q, chroma.z, chroma.w);
  } else if (style == 1) {
    v = paintFbm(q * 3.0f + 5.0f);
  } else if (style == 2) {
    float h = paintFbm(q * 5.0f + 2.0f);
    float e = 0.015f;
    float hx = paintFbm((q + float2(e, 0.0f)) * 5.0f + 2.0f), hy = paintFbm((q + float2(0.0f, e)) * 5.0f + 2.0f);
    v = 0.5f + (hy - h) * 3.5f - (hx - h) * 1.8f + 0.4f * (paintFbm(q * 2.0f) - 0.5f);   // lit from the top left
  } else if (style == 3) {
    v = 0.7f * paintFbm(q * 2.5f + 9.0f) + 0.3f * paintNoise(q * 60.0f);
  } else {
    v = (1.0f - chroma.w) * paintFbm(q * 5.0f + 13.0f) + chroma.w * paintCanvas(q);
  }
  v = saturate((v - 0.28f) / 0.44f);
  float L = v < 0.5f ? mix(tone.x, tone.y, v * 2.0f) : mix(tone.y, tone.z, v * 2.0f - 1.0f);
  return paintFromOKLab(float3(L, chroma.x, chroma.y));
}

// Dia's glass logo: a circle of diameter s minus a circle of radius s centred 1.25·s below,
// smooth-subtracted with k = 0.05·s. Shading measured from Dia (dark, plum): a clear bubble
// that's ~5% pink-white in the middle, rising Fresnel-like to ~24% at the silhouette, a crisp
// 1pt rim, and a soft white highlight at 0.86R toward the upper right.
fragment float4 orbFragment(FullscreenOut in [[stage_in]],
                            constant OrbUniforms &u [[buffer(0)]]) {
  float2 p = in.uv * u.viewSize;
  float s = u.viewSize.x - 2.0f * orbPad;
  float R = s * 0.5f;
  float2 c = float2(u.viewSize.x * 0.5f, orbPad + R);
  float2 lp = p - c;
  float dA = length(lp) - R;
  float dB = length(lp - float2(0.0f, 1.25f * s)) - s;
  float sdf = orbSmoothSubtract(dA, dB, 0.05f * s);           // points, < 0 inside
  float coverage = 1.0f - smoothstep(-0.5f, 0.5f, sdf);
  if (coverage <= 0.0f) return float4(0.0f);
  if (u.painted > 0.5f) return float4(paintedMark(lp / s, u.paintTone, u.paintChroma), 1.0f) * coverage;

  float d = max(-sdf, 0.0f) / R;                               // depth from the edge, in radii
  float fresnel = 0.05f + 0.14f * exp(-d / 0.06f) + 0.10f * exp(-d / 0.28f);
  float rim = 1.0f - smoothstep(0.0f, 1.25f, abs(sdf));        // ~1pt line on the outline

  // Highlight: elongated along the rim, centred at 0.86R, 52° above the +x axis.
  float2 q = lp / R;
  float2 dir = float2(cos(0.908f), -sin(0.908f));
  float along = dot(q, float2(-dir.y, dir.x));
  float radial = dot(q, dir) - 0.86f;
  float spec = exp(-(radial * radial) / (2.0f * 0.075f * 0.075f) - (along * along) / (2.0f * 0.2f * 0.2f));

  float3 glass = u.dark > 0.5f ? float3(1.0f, 0.83f, 0.93f) : float3(1.0f);
  float a = saturate(fresnel + rim * 0.12f);
  float as = saturate(spec * 0.36f);
  // Premultiplied: glass, then the white highlight over it.
  float3 rgb = glass * a * (1.0f - as) + float3(1.0f, 0.98f, 0.99f) * as;
  float alpha = a + as - a * as;
  return float4(rgb, alpha) * coverage;
}
"""
