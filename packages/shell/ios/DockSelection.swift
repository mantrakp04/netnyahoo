import AppKit
import CoreImage
import ExpoModulesCore

public class DockSelectionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArcadiaDockSelection")

    AsyncFunction("iconTheme") { (uri: String?, emoji: String?) -> [String: Any]? in
      guard let image = IconSource(uri: uri, emoji: emoji)?.load() else { return nil }
      return IconTheme.generate(image)?.json
    }

    View(DockSelection.self) {
      Prop("image") { (view: DockSelection, v: String?) in view.source = IconSource(uri: v, emoji: view.source?.emoji) }
      Prop("emoji") { (view: DockSelection, v: String?) in view.source = IconSource(uri: view.source?.uri, emoji: v) }
      Prop("theme") { (view: DockSelection, v: String?) in view.kind = v ?? "" }
      Prop("fill") { (view: DockSelection, hex: String?) in view.fill = hex.flatMap(NSColor.init(hex:)) }
      Prop("stroke") { (view: DockSelection, hex: String?) in view.stroke = hex.flatMap(NSColor.init(hex:)) }
      Prop("cornerRadius") { (view: DockSelection, v: Double) in view.cornerRadius = v }
      Prop("strokeWidth") { (view: DockSelection, v: Double) in view.strokeWidth = v }
      Prop("dark") { (view: DockSelection, v: Bool) in view.dark = v }
      Prop("iconSize") { (view: DockSelection, v: Double) in view.iconSize = v }
      Prop("glass") { (view: DockSelection, v: Bool?) in view.glass = v ?? false }
    }
  }
}

struct IconSource: Equatable {
  let uri: String?
  let emoji: String?

  init?(uri: String?, emoji: String?) {
    guard uri?.isEmpty == false || emoji?.isEmpty == false else { return nil }
    self.uri = uri
    self.emoji = emoji
  }

  var key: String { emoji.map { "e:\($0)" } ?? "u:\(uri ?? "")" }

  func load() -> CGImage? {
    if let emoji, !emoji.isEmpty {
      let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: 32, pixelsHigh: 32, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
        isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
      guard let bitmap else { return nil }
      bitmap.size = NSSize(width: 16, height: 16)
      guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else { return nil }
      NSGraphicsContext.saveGraphicsState()
      NSGraphicsContext.current = context
      let text = NSAttributedString(string: emoji, attributes: [.font: NSFont.systemFont(ofSize: 16)])
      let size = text.size()
      text.draw(at: NSPoint(x: (16 - size.width) / 2, y: (16 - size.height) / 2))
      NSGraphicsContext.restoreGraphicsState()
      return bitmap.cgImage
    }
    guard let uri else { return nil }
    let image: NSImage?
    if uri.hasPrefix("data:") {
      let base64 = uri.split(separator: ",", maxSplits: 1).last.map(String.init) ?? ""
      image = Data(base64Encoded: base64).flatMap(NSImage.init(data:))
    } else if let url = URL(string: uri), url.isFileURL {
      image = NSImage(contentsOfFile: url.path)
    } else {
      image = nil
    }
    return image?.cgImage(forProposedRect: nil, context: nil, hints: nil)
  }
}

enum IconTheme {
  case blur
  case template(fill: CGColor, stroke: CGColor?)

  var json: [String: Any] {
    switch self {
    case .blur:
      return ["kind": "blur"]
    case let .template(fill, stroke):
      var out: [String: Any] = ["kind": "template", "fill": Self.hexString(fill)]
      if let stroke { out["stroke"] = Self.hexString(stroke) }
      return out
    }
  }

  static func generate(_ image: CGImage) -> IconTheme? {
    guard let space = image.colorSpace, space.model == .rgb else { return nil }
    let colors = opaquePixels(image, space: space)
    guard !colors.isEmpty else { return nil }
    let mean = colors.reduce(SIMD3<Double>(), +) / Double(colors.count)
    let spread = colors.reduce(0.0) { $0 + (($1 - mean) * ($1 - mean)).sum().squareRoot() } / Double(colors.count)
    if spread >= 0.055 { return .blur }
    guard let fill = CGColor(colorSpace: space, components: [mean.x, mean.y, mean.z, 1]) else { return nil }
    if luminance(fill) > 0.88 {
      return .template(fill: CGColor(gray: 0, alpha: 1), stroke: CGColor(gray: 1, alpha: 0.3))
    }
    return .template(fill: fill, stroke: nil)
  }

  private static func opaquePixels(_ image: CGImage, space: CGColorSpace) -> [SIMD3<Double>] {
    var width = Double(image.width), height = Double(image.height)
    let longest = max(width, height)
    if longest > 0, 32 / longest < 1 {
      width *= 32 / longest
      height *= 32 / longest
    }
    let w = Int(width), h = Int(height)
    guard w > 0, h > 0 else { return [] }
    var bytes = [UInt8](repeating: 0, count: w * h * 4)
    let drawn = bytes.withUnsafeMutableBytes { buffer -> Bool in
      guard let context = CGContext(
        data: buffer.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: space,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
      else { return false }
      context.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
      return true
    }
    guard drawn else { return [] }
    var colors: [SIMD3<Double>] = []
    for i in stride(from: 0, to: bytes.count, by: 4) where Double(bytes[i + 3]) / 255 >= 0.975 {
      colors.append(SIMD3(Double(bytes[i]), Double(bytes[i + 1]), Double(bytes[i + 2])) / 255)
    }
    return colors
  }

  private static func luminance(_ color: CGColor) -> Double {
    let c = (color.components ?? []).map(Double.init)
    guard c.count >= 3 else { return 0 }
    let linear = c.prefix(3).map { $0 <= 0.03928 ? $0 / 12.92 : pow(($0 + 0.055) / 1.055, 2.4) }
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
  }

  private static func hexString(_ color: CGColor) -> String {
    let srgb = color.converted(to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil) ?? color
    let c = (srgb.components ?? [0, 0, 0, 1]).map { Int((min(max($0, 0), 1) * 255).rounded()) }
    let rgba = c.count >= 4 ? c : [c[0], c[0], c[0], c.count > 1 ? c[1] : 255]
    return String(format: "#%02X%02X%02X%02X", rgba[0], rgba[1], rgba[2], rgba[3])
  }
}

private final class BlurredIcon {
  let plain: CGImage
  let darkRing: CGImage

  private static let cache = NSCache<NSString, BlurredIcon>()
  private static let context = CIContext()

  private init(plain: CGImage, darkRing: CGImage) {
    self.plain = plain
    self.darkRing = darkRing
  }

  static func of(_ source: IconSource) -> BlurredIcon? {
    if let cached = cache.object(forKey: source.key as NSString) { return cached }
    guard let image = source.load(), let plain = blur(image), let darkRing = colorControls(plain) else { return nil }
    let icon = BlurredIcon(plain: plain, darkRing: darkRing)
    cache.setObject(icon, forKey: source.key as NSString)
    return icon
  }

  private static func blur(_ image: CGImage) -> CGImage? {
    guard let filter = CIFilter(name: "CIGaussianBlur") else { return nil }
    filter.setValue(CIImage(cgImage: image), forKey: kCIInputImageKey)
    filter.setValue(5, forKey: kCIInputRadiusKey)
    guard let output = filter.outputImage else { return nil }
    return context.createCGImage(output, from: output.extent)
  }

  private static func colorControls(_ image: CGImage) -> CGImage? {
    guard let filter = CIFilter(name: "CIColorControls") else { return nil }
    filter.setValue(CIImage(cgImage: image), forKey: kCIInputImageKey)
    filter.setValue(2.0, forKey: kCIInputSaturationKey)
    filter.setValue(-0.1, forKey: kCIInputBrightnessKey)
    guard let output = filter.outputImage else { return nil }
    return context.createCGImage(output, from: output.extent)
  }
}

private enum GlassGlow {
  private static let cache = NSCache<NSString, CGImage>()

  static func of(_ source: IconSource, blurred: CGImage) -> CGImage? {
    if let cached = cache.object(forKey: source.key as NSString) { return cached }
    let scale = min(1, 64 / Double(max(blurred.width, blurred.height, 1)))
    let w = max(1, Int(Double(blurred.width) * scale)), h = max(1, Int(Double(blurred.height) * scale))
    guard let context = CGContext(
      data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
      let data = context.data
    else { return nil }
    context.draw(blurred, in: CGRect(x: 0, y: 0, width: w, height: h))
    let bytes = data.bindMemory(to: UInt8.self, capacity: w * h * 4)
    for i in stride(from: 0, to: w * h * 4, by: 4) {
      let a = Double(bytes[i + 3]) / 255
      guard a > 0 else { continue }
      let (rgb, strength) = glow(SIMD3(Double(bytes[i]), Double(bytes[i + 1]), Double(bytes[i + 2])) / 255 / a)
      let alpha = a * strength
      for k in 0..<3 { bytes[i + k] = UInt8((rgb[k] * alpha * 255).rounded()) }
      bytes[i + 3] = UInt8((alpha * 255).rounded())
    }
    guard let image = context.makeImage() else { return nil }
    cache.setObject(image, forKey: source.key as NSString)
    return image
  }

  static func of(_ color: NSColor) -> CGColor? {
    guard let c = color.usingColorSpace(.sRGB) else { return nil }
    let (rgb, strength) = glow(SIMD3(Double(c.redComponent), Double(c.greenComponent), Double(c.blueComponent)))
    return strength > 0 ? CGColor(srgbRed: rgb.x, green: rgb.y, blue: rgb.z, alpha: strength) : nil
  }

  private static func glow(_ rgb: SIMD3<Double>) -> (SIMD3<Double>, Double) {
    let top = rgb.max(), chroma = top - rgb.min()
    guard top > 0 else { return (.zero, 0) }
    let bright = rgb / top
    return (bright + (SIMD3(repeating: 1) - bright) * 0.35, min(1, chroma * 1.5))
  }
}

private enum TemplateIcon {
  private static let cache = NSCache<NSString, CGImage>()

  static func of(_ source: IconSource) -> CGImage? {
    if let cached = cache.object(forKey: source.key as NSString) { return cached }
    guard let image = source.load(),
      let context = CGContext(
        data: nil, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }
    let rect = CGRect(x: 0, y: 0, width: image.width, height: image.height)
    context.draw(image, in: rect)
    context.setBlendMode(.sourceIn)
    context.setFillColor(.white)
    context.fill(rect)
    guard let white = context.makeImage() else { return nil }
    cache.setObject(white, forKey: source.key as NSString)
    return white
  }
}

final class DockSelection: ExpoView {
  var source: IconSource? { didSet { if source != oldValue { apply() } } }
  var kind = "" { didSet { apply() } }
  var fill: NSColor? { didSet { apply() } }
  var stroke: NSColor? { didSet { apply() } }
  var cornerRadius: Double = 10 { didSet { apply() } }
  var strokeWidth: Double = 3 { didSet { apply() } }
  var dark = true { didSet { apply() } }
  var iconSize: Double = 16 { didSet { apply() } }
  var glass = false { didSet { if glass != oldValue { apply() } } }

  private let tile = CALayer()
  private let background = CALayer()
  private let tint = CALayer()
  private let ring = CALayer()
  private let ringImage = CALayer()
  private let ringMask = CALayer()
  private let icon = CALayer()
  private let lift = CALayer()
  private let liftMask = CAShapeLayer()
  private let hue = CALayer()
  private let hueImage = CALayer()
  private let sheen = CAGradientLayer()
  private let rim = CAGradientLayer()
  private let rimMask = CALayer()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
    layerUsesCoreImageFilters = true
    tile.masksToBounds = true
    tile.addSublayer(background)
    tile.addSublayer(tint)
    tint.opacity = 0.22
    for layer in [tint, ringImage] {
      layer.contentsGravity = .resizeAspectFill
      layer.masksToBounds = true
    }
    ring.addSublayer(ringImage)
    ringMask.borderColor = NSColor.white.cgColor
    liftMask.fillRule = .evenOdd
    lift.mask = liftMask
    lift.shadowColor = NSColor.black.cgColor
    lift.shadowRadius = 3
    hue.masksToBounds = true
    hue.addSublayer(hueImage)
    hueImage.contentsGravity = .resizeAspectFill
    sheen.masksToBounds = true
    rimMask.borderColor = NSColor.white.cgColor
    rim.mask = rimMask
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    apply()
  }

  override func layout() {
    super.layout()
    apply()
  }

  override func updateLayer() {
    super.updateLayer()
    apply()
  }

  override func viewDidChangeBackingProperties() {
    super.viewDidChangeBackingProperties()
    apply()
  }

  private func apply() {
    guard let layer else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    defer { CATransaction.commit() }
    // RCTView resets backing-layer styles; draw in sublayers.
    if tile.superlayer !== layer {
      layer.insertSublayer(tile, at: 0)
      layer.insertSublayer(ring, above: tile)
      layer.insertSublayer(icon, above: ring)
      layer.insertSublayer(lift, below: tile)
      layer.insertSublayer(hue, above: icon)
      layer.insertSublayer(sheen, above: hue)
      layer.insertSublayer(rim, above: sheen)
    }
    for dia in [tile, ring, icon] { dia.isHidden = glass }
    for glassLayer in [lift, hue, sheen, rim] { glassLayer.isHidden = !glass }
    let radius = min(cornerRadius, bounds.width / 2)
    let scale = window?.backingScaleFactor ?? 2
    let width = (strokeWidth * scale).rounded() / scale
    let big = bounds.insetBy(dx: -bounds.width * 0.75, dy: -bounds.height * 0.75)
    if glass { return applyGlass(radius: radius, rimWidth: width, big: big) }
    for shape in [tile, ring, ringMask] {
      shape.frame = bounds
      shape.cornerRadius = radius
      shape.cornerCurve = .continuous
    }
    background.frame = bounds
    tint.frame = big
    ringImage.frame = big
    ringMask.borderWidth = width
    icon.frame = CGRect(x: (bounds.width - iconSize) / 2, y: (bounds.height - iconSize) / 2, width: iconSize, height: iconSize)
    icon.contents = kind == "template" ? source.flatMap(TemplateIcon.of) : nil

    let blurred = kind == "blur" ? source.flatMap(BlurredIcon.of) : nil
    if let blurred {
      background.backgroundColor = glass ? nil : NSColor.white.withAlphaComponent(dark ? 0.2 : 1).cgColor
      tint.contents = blurred.plain
      tint.isHidden = false
      ring.mask = ringMask
      ring.backgroundColor = (dark ? NSColor.black : NSColor.white).cgColor
      ring.borderWidth = 0
      ring.compositingFilter = nil
      ringImage.contents = dark ? blurred.darkRing : blurred.plain
      ringImage.opacity = dark ? 0.75 : 1
      ringImage.isHidden = false
    } else {
      background.backgroundColor = glass ? nil : fill?.cgColor
      tint.contents = nil
      tint.isHidden = true
      ring.mask = nil
      ring.backgroundColor = nil
      ring.borderWidth = width
      ring.borderColor = (stroke ?? .white).cgColor
      ring.compositingFilter = stroke == nil ? CIFilter(name: "CISoftLightBlendMode") : nil
      ringImage.contents = nil
      ringImage.isHidden = true
    }
  }

  private func applyGlass(radius: CGFloat, rimWidth: CGFloat, big: CGRect) {
    // RN views are flipped: y = 0 is the top.
    let flipped = layer?.isGeometryFlipped == true || isFlipped
    let top = CGPoint(x: 0.5, y: flipped ? 0 : 1)
    let bottom = CGPoint(x: 0.5, y: flipped ? 1 : 0)
    for shape in [hue, sheen, rim, rimMask] {
      shape.frame = bounds
      shape.cornerRadius = radius
      shape.cornerCurve = .continuous
    }

    let shape = CGPath(roundedRect: bounds, cornerWidth: radius, cornerHeight: radius, transform: nil)
    lift.frame = bounds
    lift.shadowPath = shape
    lift.shadowOpacity = dark ? 0.5 : 0.2
    lift.shadowOffset = CGSize(width: 0, height: flipped ? 1 : -1)
    let outside = CGMutablePath()
    outside.addRect(bounds.insetBy(dx: -12, dy: -12))
    outside.addPath(shape)
    liftMask.frame = bounds
    liftMask.path = outside

    let glow = kind == "blur" ? source.flatMap { source in BlurredIcon.of(source).flatMap { GlassGlow.of(source, blurred: $0.plain) } } : nil
    let color = kind == "template" ? fill.flatMap(GlassGlow.of) : nil
    hueImage.frame = big.offsetBy(dx: -bounds.minX, dy: -bounds.minY)
    hueImage.contents = glow
    hue.backgroundColor = color
    hue.isHidden = glow == nil && color == nil
    hue.opacity = dark ? 0.35 : 0.3

    sheen.colors = [NSColor.white.withAlphaComponent(dark ? 0.12 : 0.4).cgColor, NSColor.white.withAlphaComponent(0).cgColor]
    sheen.locations = [0, 0.6]
    sheen.startPoint = top
    sheen.endPoint = bottom

    rimMask.borderWidth = rimWidth
    rim.colors = [
      NSColor.white.withAlphaComponent(dark ? 0.5 : 1).cgColor,
      NSColor.white.withAlphaComponent(dark ? 0.14 : 0.55).cgColor,
    ]
    rim.startPoint = top
    rim.endPoint = bottom
  }
}
