import ExpoModulesCore
import MetalKit

/// Base for shader-backed views: a transparent MTKView that draws a single
/// full-screen triangle strip. Subclasses encode uniforms in `encode(_:size:)`.
class MetalSurface: ExpoView, MTKViewDelegate {
  static let device = MTLCreateSystemDefaultDevice()!
  static let queue = device.makeCommandQueue()!

  let metalView = MTKView(frame: .zero, device: MetalSurface.device)
  private var pipeline: MTLRenderPipelineState?

  /// Metal source compiled at runtime (kept as Swift strings so the pod needs no
  /// metallib build phase; `pnpm shaders:check` compiles them offline).
  class var shaderSource: String { fatalError("override") }
  class var fragmentName: String { fatalError("override") }
  /// True when the fragment already outputs premultiplied alpha.
  class var premultipliedOutput: Bool { false }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    metalView.delegate = self
    metalView.colorPixelFormat = .bgra8Unorm
    metalView.clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
    metalView.framebufferOnly = true
    metalView.layer?.isOpaque = false
    metalView.autoresizingMask = [.width, .height]
    addSubview(metalView)
    pipeline = Self.makePipeline()
    Self.live.append(Weak(self))
  }

  // MARK: DEV snapshots

  private struct Weak { weak var view: MetalSurface?; init(_ v: MetalSurface) { view = v } }
  private static var live: [Weak] = []

  /// Every shader view in a window, for `debugSnapshot`.
  static var instances: [MetalSurface] {
    live.removeAll { $0.view == nil }
    return live.compactMap(\.view)
  }

  /// Renders the current frame offscreen and writes a straight-alpha PNG (the window
  /// snapshot can't read CAMetalLayer contents). Uses the same pipeline and uniforms as a
  /// real frame; `encode` may advance a running clock to now, like any frame would.
  func writeSnapshot(to path: String) -> Bool {
    guard let pipeline, bounds.width > 0, bounds.height > 0 else { return false }
    let scale = window?.backingScaleFactor ?? 2
    let width = Int(bounds.width * scale), height = Int(bounds.height * scale)
    let desc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: width, height: height, mipmapped: false)
    desc.usage = [.renderTarget]
    desc.storageMode = .shared
    guard let texture = Self.device.makeTexture(descriptor: desc), let buffer = Self.queue.makeCommandBuffer() else { return false }
    let pass = MTLRenderPassDescriptor()
    pass.colorAttachments[0].texture = texture
    pass.colorAttachments[0].loadAction = .clear
    pass.colorAttachments[0].clearColor = metalView.clearColor
    pass.colorAttachments[0].storeAction = .store
    guard let encoder = buffer.makeRenderCommandEncoder(descriptor: pass) else { return false }
    encoder.setRenderPipelineState(pipeline)
    encode(encoder, size: SIMD2(Float(bounds.width), Float(bounds.height)))
    encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
    encoder.endEncoding()
    buffer.commit()
    buffer.waitUntilCompleted()
    var bytes = [UInt8](repeating: 0, count: width * height * 4)
    texture.getBytes(&bytes, bytesPerRow: width * 4, from: MTLRegionMake2D(0, 0, width, height), mipmapLevel: 0)
    // BGRA premultiplied → RGBA straight.
    for i in stride(from: 0, to: bytes.count, by: 4) {
      let a = bytes[i + 3]
      let unpremultiply = { (c: UInt8) -> UInt8 in a == 0 ? 0 : UInt8(min(255, (Int(c) * 255 + Int(a) / 2) / Int(a))) }
      let b = bytes[i], r = bytes[i + 2]
      bytes[i] = unpremultiply(r)
      bytes[i + 1] = unpremultiply(bytes[i + 1])
      bytes[i + 2] = unpremultiply(b)
    }
    guard let rep = NSBitmapImageRep(
      bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
      isPlanar: false, colorSpaceName: .deviceRGB, bitmapFormat: [.alphaNonpremultiplied], bytesPerRow: width * 4, bitsPerPixel: 32),
      let data = rep.bitmapData else { return false }
    bytes.withUnsafeBytes { data.update(from: $0.bindMemory(to: UInt8.self).baseAddress!, count: bytes.count) }
    guard let png = rep.representation(using: .png, properties: [:]) else { return false }
    return (try? png.write(to: URL(fileURLWithPath: path))) != nil
  }

  // Shader views are decoration: let clicks fall through to what's behind.
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  // RN macOS assigns frames directly and doesn't autoresize subviews.
  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    metalView.frame = bounds
  }

  private static var pipelines: [ObjectIdentifier: MTLRenderPipelineState] = [:]

  private static func makePipeline() -> MTLRenderPipelineState? {
    if let cached = pipelines[ObjectIdentifier(self)] { return cached }
    do {
      let library = try device.makeLibrary(source: fullscreenVertexSource + shaderSource, options: nil)
      let desc = MTLRenderPipelineDescriptor()
      desc.vertexFunction = library.makeFunction(name: "fullscreenVertex")
      desc.fragmentFunction = library.makeFunction(name: fragmentName)
      let attachment = desc.colorAttachments[0]!
      attachment.pixelFormat = .bgra8Unorm
      // Shaders output straight alpha; blending onto a cleared target yields the
      // premultiplied result Core Animation expects.
      attachment.isBlendingEnabled = true
      attachment.sourceRGBBlendFactor = premultipliedOutput ? .one : .sourceAlpha
      attachment.destinationRGBBlendFactor = .oneMinusSourceAlpha
      attachment.sourceAlphaBlendFactor = .one
      attachment.destinationAlphaBlendFactor = .oneMinusSourceAlpha
      let state = try device.makeRenderPipelineState(descriptor: desc)
      pipelines[ObjectIdentifier(self)] = state
      return state
    } catch {
      NSLog("[NetnyahooShaders] \(self) pipeline failed: \(error)")
      return nil
    }
  }

  func encode(_ encoder: MTLRenderCommandEncoder, size: SIMD2<Float>) {}

  func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

  func draw(in view: MTKView) {
    guard let pipeline,
          let pass = view.currentRenderPassDescriptor,
          let drawable = view.currentDrawable,
          let buffer = Self.queue.makeCommandBuffer(),
          let encoder = buffer.makeRenderCommandEncoder(descriptor: pass) else { return }
    encoder.setRenderPipelineState(pipeline)
    encode(encoder, size: SIMD2(Float(bounds.width), Float(bounds.height)))
    encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
    encoder.endEncoding()
    buffer.present(drawable)
    buffer.commit()
  }
}

let fullscreenVertexSource = """
#include <metal_stdlib>
using namespace metal;

struct FullscreenOut {
  float4 position [[position]];
  float2 uv; // (0,0) = top-left
};

vertex FullscreenOut fullscreenVertex(uint vid [[vertex_id]]) {
  const float2 positions[4] = { float2(-1, -1), float2(1, -1), float2(-1, 1), float2(1, 1) };
  const float2 uvs[4] = { float2(0, 1), float2(1, 1), float2(0, 0), float2(1, 0) };
  FullscreenOut out;
  out.position = float4(positions[vid], 0, 1);
  out.uv = uvs[vid];
  return out;
}

"""

extension SIMD4 where Scalar == Float {
  /// `#RRGGBB` / `#RRGGBBAA` → sRGB components.
  init?(hex: String) {
    var s = hex.trimmingCharacters(in: .whitespaces)
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 6 || s.count == 8, let v = UInt64(s, radix: 16) else { return nil }
    let rgba = s.count == 6 ? (v << 8) | 0xFF : v
    self.init(
      Float((rgba >> 24) & 0xFF) / 255, Float((rgba >> 16) & 0xFF) / 255,
      Float((rgba >> 8) & 0xFF) / 255, Float(rgba & 0xFF) / 255)
  }
}

/// The host window's state as Dia's shader views read it (docs/dia-spec.md):
/// - `isKey`: NewTabAreaLightView scales lift and tilt by `isKeyWindow ? 1 : 0.5`, and pauses
///   its clock on resign-key / resumes it on become-key.
/// - `isActive`: WindowThemeBackgroundViewMetal treats a window as active when it, or any of its
///   parent windows, is key or main (it re-checks on every key/main notification).
/// - `isVisible`: false while the window is minimised, fully covered or on another Space.
final class WindowActivity {
  /// DEV: forces key/active (and visible) so key vs non-key renders can be compared while the
  /// app can't take focus. nil = the real state. `NETNYAHOO_SHADERS_FORCE_KEY=1` sets it at
  /// launch (recordings of an `open -g` instance, whose windows are never key).
  static var override: Bool? = ProcessInfo.processInfo.environment["NETNYAHOO_SHADERS_FORCE_KEY"] == "1" ? true : nil {
    didSet { NotificationCenter.default.post(name: changed, object: nil) }
  }
  /// DEV: forces Reduce Motion on or off; nil = the system setting.
  static var reduceMotionOverride: Bool?
  static let changed = Notification.Name("NetnyahooShadersWindowActivityChanged")

  static var reduceMotion: Bool {
    reduceMotionOverride ?? NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
  }

  private(set) weak var window: NSWindow?
  private var tokens: [NSObjectProtocol] = []
  private let onChange: () -> Void

  init(onChange: @escaping () -> Void) {
    self.onChange = onChange
  }

  deinit { detach() }

  var isKey: Bool { Self.override ?? window?.isKeyWindow ?? false }

  var isActive: Bool {
    if let forced = Self.override { return forced }
    var w = window
    while let current = w {
      if current.isKeyWindow || current.isMainWindow { return true }
      w = current.parent
    }
    return false
  }

  var isVisible: Bool {
    if Self.override == true { return true }
    return window?.occlusionState.contains(.visible) ?? false
  }

  func attach(to window: NSWindow?) {
    guard window !== self.window else { return }
    detach()
    self.window = window
    guard let window else { return }
    let center = NotificationCenter.default
    let handler: (Notification) -> Void = { [weak self] _ in self?.onChange() }
    // Any window's key/main change can flip a parent chain's state (sheets, child panels).
    for name in [NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification,
                 NSWindow.didBecomeMainNotification, NSWindow.didResignMainNotification] {
      tokens.append(center.addObserver(forName: name, object: nil, queue: .main, using: handler))
    }
    tokens.append(center.addObserver(forName: NSWindow.didChangeOcclusionStateNotification, object: window, queue: .main, using: handler))
    tokens.append(center.addObserver(forName: Self.changed, object: nil, queue: .main, using: handler))
  }

  private func detach() {
    for token in tokens { NotificationCenter.default.removeObserver(token) }
    tokens = []
  }
}
