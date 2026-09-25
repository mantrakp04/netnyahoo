import ExpoModulesCore
import MetalKit

/// Dia's New Tab "wrap": a point light sweeps from below the command bar up to
/// its top edge (easeOutExpo), tracing the bar's border with a 1pt hairline and
/// a ~10pt halo, and rim-lighting the logo. Shader reconstructed from
/// `edgeLightFragment`; parameters from NewTabPageViewController (docs/dia-spec.md).
final class EdgeLightView: MetalSurface {
  var rectFrame = SIMD4<Float>(0, 0, 0, 0)
  var cornerRadius: Float = 20
  var lightStart = SIMD2<Float>(0, 0)
  var lightEnd = SIMD2<Float>(0, 0)
  var lightColor = SIMD4<Float>(1, 1, 1, 0.5)
  var logoFrame = SIMD4<Float>(0, 0, 0, 0)
  var animationDuration: Float = 1.0
  var animationDelay: Float = 0

  private var startTime = CACurrentMediaTime()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    metalView.preferredFramesPerSecond = 60
  }

  /// NewTabPageViewController.loadView skips the sweep to its end (time += 5, paused); the
  /// entrance then restarts it, except under Reduce Motion, which keeps the settled glow.
  func replay() {
    if WindowActivity.reduceMotion {
      startTime = CACurrentMediaTime() - Double(animationDelay + animationDuration + 5)
      metalView.isPaused = true
      metalView.enableSetNeedsDisplay = true
      metalView.needsDisplay = true
    } else {
      startTime = CACurrentMediaTime()
      metalView.enableSetNeedsDisplay = false
      metalView.isPaused = window == nil
    }
  }

  /// Props changed: a settled (paused) glow repaints at its new geometry.
  func redraw() {
    if metalView.isPaused { metalView.needsDisplay = true }
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window != nil { replay() } else { metalView.isPaused = true }
  }

  override class var premultipliedOutput: Bool { true }
  override class var fragmentName: String { "edgeLightFragment" }

  override func encode(_ encoder: MTLRenderCommandEncoder, size: SIMD2<Float>) {
    var resolution = size
    var time = Float(CACurrentMediaTime() - startTime)
    var duration = animationDuration
    var delay = animationDelay
    var rect = rectFrame
    var radius = cornerRadius
    var start = lightStart
    var end = lightEnd
    var color = lightColor
    var logo = logoFrame
    encoder.setFragmentBytes(&resolution, length: 8, index: 0)
    encoder.setFragmentBytes(&time, length: 4, index: 1)
    encoder.setFragmentBytes(&duration, length: 4, index: 2)
    encoder.setFragmentBytes(&delay, length: 4, index: 3)
    encoder.setFragmentBytes(&rect, length: 16, index: 4)
    encoder.setFragmentBytes(&radius, length: 4, index: 5)
    encoder.setFragmentBytes(&start, length: 8, index: 6)
    encoder.setFragmentBytes(&end, length: 8, index: 7)
    encoder.setFragmentBytes(&color, length: 16, index: 8)
    encoder.setFragmentBytes(&logo, length: 16, index: 9)
    // After the sweep the glow is static: one more frame, then draw only on demand.
    if time > animationDelay + animationDuration + 0.1, !metalView.isPaused {
      DispatchQueue.main.async { [weak self] in
        self?.metalView.isPaused = true
        self?.metalView.enableSetNeedsDisplay = true
      }
    }
  }

  override class var shaderSource: String { edgeLightSource }
}

let edgeLightSource = """
// Full-screen quad, drawn as a 4-vertex triangle strip.


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Hermite smoothstep that is well defined for edge0 > edge1 (the shader uses
// "reversed" smoothsteps such as smoothstep(1, 0, x)). Identical math to the
// compiled code: t = clamp((x - e0) / (e1 - e0)), t*t*(3 - 2t).
static inline float smoothstepAny(float e0, float e1, float x) {
    float t = clamp((x - e0) / (e1 - e0), 0.0f, 1.0f);
    return t * t * (3.0f - 2.0f * t);
}

// easeOutExpo: 1 - 2^(-10 t), exactly 1 at t == 1.
static inline float easeOutExpo(float t) {
    return (t == 1.0f) ? 1.0f : 1.0f - pow(2.0f, -10.0f * t);
}

// Signed distance to a "squircle" rounded box (superellipse corners, n = 4.5).
// q = abs(p) - halfSize + r   (corner-local coordinates)
// Inside/straight-edge regions use the ordinary box distance; the corner
// region uses the L^4.5 norm instead of the Euclidean norm, which gives the
// continuous-curvature (Apple-style) corner.
static float squircleBoxSDF(float2 q, float r) {
    bool inX = q.x <= 0.0f;
    bool inY = q.y <= 0.0f;
    if (inX && inY) return max(q.x, q.y) - r;
    if (inX)        return q.y - r;
    if (inY)        return q.x - r;
    float2 k = pow(q / r, float2(4.5f));
    return (pow(k.x + k.y, 0.222222224f /* 1/4.5 */) - 1.0f) * r;
}

// Outward normal of the squircle box, matching the branch structure above.
// s = sign(p) (quadrant of the sample point).
static float2 squircleBoxNormal(float2 q, float r, float2 s) {
    bool inX = q.x <= 0.0f;
    bool inY = q.y <= 0.0f;
    if (inX && inY) {
        // Interior: nearest straight edge.
        return (q.x > q.y) ? float2(s.x, 0.0f) : float2(0.0f, s.y);
    }
    if (inX) return float2(0.0f, s.y);
    if (inY) return float2(s.x, 0.0f);
    // Corner: gradient of the L^4.5 norm.
    float2 g = pow(max(q, float2(9.99999975e-05f)) / r, float2(3.5f)) * s / r;
    return normalize(g);
}

// Inigo Quilez polynomial smooth subtraction: removes shape b from shape a
// with a blend radius k.  (mix(a, -b, h) + k h (1 - h))
static inline float smoothSubtract(float a, float b, float k, thread float &h) {
    h = clamp(0.5f - 0.5f * (b + a) / k, 0.0f, 1.0f);
    return mix(a, -b, h) + k * h * (1.0f - h);
}

// ---------------------------------------------------------------------------
// Fragment
// ---------------------------------------------------------------------------

fragment float4 edgeLightFragment(FullscreenOut in              [[stage_in]],
                                  constant float2 &resolution         [[buffer(0)]],
                                  constant float  &time               [[buffer(1)]],
                                  constant float  &animationDuration  [[buffer(2)]],
                                  constant float  &animationDelay     [[buffer(3)]],
                                  constant float4 &rectFrame          [[buffer(4)]],
                                  constant float  &cornerRadius       [[buffer(5)]],
                                  constant float2 &lightStart         [[buffer(6)]],
                                  constant float2 &lightEnd           [[buffer(7)]],
                                  constant float4 &lightColor         [[buffer(8)]],
                                  constant float4 &diaLogoFrame       [[buffer(9)]])
{
    // ---- Rect in normalized units (1.0 == min half extent) -----------------
    float2 rectCenter = rectFrame.xy + rectFrame.zw * 0.5f;
    float2 halfSize   = rectFrame.zw * 0.5f;
    float  scale      = min(halfSize.x, halfSize.y);

    float2 pixel = resolution * in.uv;
    float2 p     = (pixel - rectCenter) / scale;   // normalized position
    float2 hs    = halfSize / scale;               // normalized half size
    float  r     = cornerRadius * 2.0f / scale;    // squircle radius (2x the CA radius)

    float2 q = abs(p) - hs + r;
    float  d = squircleBoxSDF(q, r);                // normalized signed distance

    // ---- Animation progress (sweep of the light from lightStart to lightEnd)
    float progress = 1.0f;
    if (animationDuration > 0.0f) {
        progress = max(time - animationDelay, 0.0f) / animationDuration;
    }
    float ease = easeOutExpo(clamp(progress, 0.0f, 1.0f));

    float2 n        = squircleBoxNormal(q, r, sign(p));
    float2 lightPos = mix(lightStart, lightEnd, float2(ease));   // view points

    // ---- Rect edge lighting ------------------------------------------------
    // Vector from the sample to the light, both in [-1,1] box space.
    float2 toLight = (lightPos - rectCenter) / (hs * scale) - p / hs;
    float  lightDist = length(toLight);
    float2 edgeN     = normalize(n * hs);
    float2 lightDir  = (lightDist > 0.00100000005f) ? toLight / lightDist : float2(0.0f);
    float  facing    = max(0.0f, dot(edgeN, lightDir));

    float atten   = pow(1.0f - smoothstepAny(0.0f, 2.0f, lightDist), 1.5f);
    float lit     = mix(atten * 0.5f, atten, sqrt(facing));    // back side gets half
    float glowLit = mix(0.0500000007f, 1.0f, lit);             // glow never fully off

    float absD = abs(d);
    float core = smoothstepAny(1.0f  / scale, 0.0f, absD) * lit;      // ~1pt hairline
    float glow = smoothstepAny(10.0f / scale, 0.0f, absD) * glowLit;  // ~10pt halo
    float edge = clamp(core + pow(glow, 2.0f) * 0.200000003f, 0.0f, 1.0f) * ease;

    float  edgeAlpha = lightColor.a * clamp(edge, 0.0f, 1.0f);
    float4 edgeColor = float4(lightColor.rgb * edgeAlpha, edgeAlpha);

    // ---- Dia logo rim light ------------------------------------------------
    // Logo shape = circle(r = size/2) minus a circle(r = size) centred 1.25*size
    // below it, smooth-subtracted with k = 0.05*size -> a crescent/"smile" cap.
    float2 logoCenter = diaLogoFrame.xy + diaLogoFrame.zw * 0.5f;
    float  logoSize   = min(diaLogoFrame.z, diaLogoFrame.w);
    float  logoRadius = logoSize * 0.5f;
    float  logoBlend  = logoSize * 0.0500000007f;

    float2 lp    = pixel - logoCenter;
    float  lenA  = length(lp);
    float  dA    = lenA - logoRadius;
    float2 bp    = lp - float2(0.0f, logoSize * 1.25f);
    float  lenB  = length(bp);
    float  dB    = lenB - logoSize;
    float  h;
    float  logoSDF = smoothSubtract(dA, dB, logoBlend, h);      // in points

    // Light position relative to the logo, y flipped to y-up, in logo radii.
    float2 lv       = (lightPos - logoCenter) * float2(1.0f, -1.0f) / logoRadius;
    float  lvLen    = length(lv);
    float2 lvDir    = (lvLen > 0.00100000005f) ? lv / lvLen : float2(0.0f);
    float  logoFade  = 1.0f - smoothstepAny(0.0f, 6.0f, lvLen);
    float  logoAtten = logoFade * sqrt(logoFade);                // ^1.5

    // Normal of the smooth-subtracted shape (blend of the two circle normals).
    float2 nA = (lenA > 9.99999975e-05f) ? lp / lenA : float2(0.0f,  1.0f);
    float2 nB = (lenB > 9.99999975e-05f) ? bp / lenB : float2(0.0f, -1.0f);
    float2 logoN = normalize(mix(nA, -nB, float2(h)) * float2(1.0f, -1.0f));

    // Directional term fades in as the light moves away from the logo centre.
    float logoFacing = mix(1.0f, max(0.0f, dot(logoN, -lvDir)),
                           smoothstepAny(0.0f, 1.5f, lvLen));
    float logoLit = logoFacing * logoAtten;

    float insideLogo = (logoSDF <= 0.0f) ? 1.0f : 0.0f;
    float rim   = smoothstepAny(1.0f, 0.0f, abs(logoSDF)) * logoLit;               // 1pt rim
    float inner = smoothstepAny(10.0f, 0.0f, max(-logoSDF, 0.0f)) * logoLit * insideLogo; // 10pt inner glow
    float logo  = clamp(rim + pow(inner, 2.0f) * 0.200000003f, 0.0f, 1.0f)
                + insideLogo * logoAtten * 0.0500000007f;               // faint fill

    float  logoAlpha = clamp(logo * ease, 0.0f, 1.0f) * lightColor.a;
    float4 logoColor = float4(lightColor.rgb * logoAlpha, logoAlpha);

    // Premultiplied "over": edge on top of logo.
    return edgeColor + logoColor * (1.0f - edgeAlpha);
}
"""
