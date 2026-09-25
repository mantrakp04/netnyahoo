import AppKit
import CoreImage

/// Alternate app icons (Settings › Appearance). The choice is applied to the Dock tile while
/// the app runs (`NSApp.applicationIconImage`) and remembered across launches; while it isn't
/// running, the Dock tile plug-in (packages/shell/docktile, which also compiles this file) draws
/// it. Variants are drawn from the bundle's icon: on a squircle plate in a few colours, and monochrome.
enum AppIcons {
  struct Variant {
    let id: String
    let name: String
    /// Plate colour behind the artwork; nil = the bare icon.
    let plate: (top: NSColor, bottom: NSColor)?
    let mono: Bool
  }

  static let defaultsKey = "NNAppIcon"
  /// Distributed notification the Dock tile plug-in listens for (`<bundle id>.AppIconChanged`, userInfo `icon`).
  static func changedNotification(bundleId: String) -> Notification.Name { .init("\(bundleId).AppIconChanged") }

  static let variants: [Variant] = [
    Variant(id: "default", name: "Default", plate: nil, mono: false),
    Variant(id: "midnight", name: "Midnight", plate: (NSColor(srgbRed: 0.20, green: 0.19, blue: 0.22, alpha: 1), NSColor(srgbRed: 0.07, green: 0.07, blue: 0.08, alpha: 1)), mono: false),
    Variant(id: "daylight", name: "Daylight", plate: (NSColor(srgbRed: 1, green: 1, blue: 1, alpha: 1), NSColor(srgbRed: 0.90, green: 0.90, blue: 0.91, alpha: 1)), mono: false),
    Variant(id: "plum", name: "Plum", plate: (NSColor(srgbRed: 0.83, green: 0.56, blue: 0.68, alpha: 1), NSColor(srgbRed: 0.52, green: 0.28, blue: 0.40, alpha: 1)), mono: false),
    Variant(id: "ocean", name: "Ocean", plate: (NSColor(srgbRed: 0.45, green: 0.70, blue: 0.93, alpha: 1), NSColor(srgbRed: 0.16, green: 0.36, blue: 0.70, alpha: 1)), mono: false),
    Variant(id: "mono", name: "Mono", plate: nil, mono: true),
    Variant(id: "noir", name: "Noir", plate: (NSColor(srgbRed: 0.16, green: 0.16, blue: 0.16, alpha: 1), NSColor(srgbRed: 0.03, green: 0.03, blue: 0.03, alpha: 1)), mono: true),
  ]

  static var current: String {
    let id = UserDefaults.standard.string(forKey: defaultsKey) ?? "default"
    return variants.contains { $0.id == id } ? id : "default"
  }

  /// Re-applies the remembered icon; call once at launch.
  static func restore() {
    if current != "default" { apply(current) }
  }

  static func set(_ id: String) {
    guard variants.contains(where: { $0.id == id }) else { return }
    UserDefaults.standard.set(id, forKey: defaultsKey)
    apply(id)
    // The plug-in runs in the Dock's process and keeps the icon after we quit.
    if let bundleId = Bundle.main.bundleIdentifier {
      DistributedNotificationCenter.default().postNotificationName(
        changedNotification(bundleId: bundleId), object: nil, userInfo: ["icon": id], deliverImmediately: true)
    }
  }

  private static func apply(_ id: String) {
    // nil restores the bundle icon (and its proper Dock rendering).
    NSApp.applicationIconImage = id == "default" ? nil : image(id, size: 512)
  }

  private static var cache: [String: NSImage] = [:]

  /// The artwork every variant starts from (the plug-in sets the app bundle's).
  /// (Not `applicationIconName`: that's whatever variant is showing.)
  static var base: NSImage = NSImage(named: "AppIcon") ?? NSWorkspace.shared.icon(forFile: Bundle.main.bundlePath) {
    didSet { cache.removeAll() }
  }

  static func image(_ id: String, size: CGFloat) -> NSImage? {
    let key = "\(id)@\(size)"
    if let hit = cache[key] { return hit }
    guard let variant = variants.first(where: { $0.id == id }) else { return nil }
    let artwork = variant.mono ? monochrome(base) : base
    let image = NSImage(size: NSSize(width: size, height: size), flipped: false) { rect in
      guard let plate = variant.plate else {
        artwork.draw(in: rect)
        return true
      }
      // macOS icon grid: an 824/1024 squircle, centred, with a soft drop shadow.
      let inset = rect.width * 100 / 1024
      let body = rect.insetBy(dx: inset, dy: inset)
      let path = NSBezierPath(roundedRect: body, xRadius: body.width * 0.225, yRadius: body.width * 0.225)
      NSGraphicsContext.saveGraphicsState()
      let shadow = NSShadow()
      shadow.shadowColor = NSColor.black.withAlphaComponent(0.3)
      shadow.shadowBlurRadius = rect.width * 10 / 1024
      shadow.shadowOffset = NSSize(width: 0, height: -rect.width * 6 / 1024)
      shadow.set()
      plate.bottom.setFill()
      path.fill()
      NSGraphicsContext.restoreGraphicsState()
      NSGradient(starting: plate.top, ending: plate.bottom)?.draw(in: path, angle: -90)
      NSColor.white.withAlphaComponent(0.12).setStroke()
      path.lineWidth = max(1, rect.width / 512)
      path.stroke()
      // The artwork sits inside the plate, a little smaller than the bare icon.
      path.addClip()
      artwork.draw(in: body.insetBy(dx: body.width * 0.06, dy: body.width * 0.06))
      return true
    }
    cache[key] = image
    return image
  }

  private static func monochrome(_ image: NSImage) -> NSImage {
    guard let tiff = image.tiffRepresentation, let input = CIImage(data: tiff),
          let filter = CIFilter(name: "CIPhotoEffectNoir") else { return image }
    filter.setValue(input, forKey: kCIInputImageKey)
    guard let output = filter.outputImage else { return image }
    let rep = NSCIImageRep(ciImage: output)
    let result = NSImage(size: rep.size)
    result.addRepresentation(rep)
    return result
  }

  /// PNG data URL for the Appearance pane's picker.
  static func preview(_ id: String, size: CGFloat) -> String? {
    guard let image = image(id, size: size * 2),
          let tiff = image.tiffRepresentation,
          let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else { return nil }
    return "data:image/png;base64,\(png.base64EncodedString())"
  }
}

/// "Add to Dock" (onboarding). There's no API for it: the Dock's own preferences get a new
/// tile and the Dock restarts to pick it up, as other apps do.
enum DockTile {
  private static let domain = "com.apple.dock" as CFString
  private static let key = "persistent-apps" as CFString

  private static var tiles: [[String: Any]] {
    CFPreferencesCopyAppValue(key, domain) as? [[String: Any]] ?? []
  }

  static var isInDock: Bool {
    let bundleId = Bundle.main.bundleIdentifier
    let path = Bundle.main.bundleURL.standardizedFileURL.path
    return tiles.contains { tile in
      let data = tile["tile-data"] as? [String: Any]
      if let id = data?["bundle-identifier"] as? String, id == bundleId { return true }
      let file = (data?["file-data"] as? [String: Any])?["_CFURLString"] as? String
      return file.flatMap(URL.init(string:))?.standardizedFileURL.path == path
    }
  }

  @discardableResult
  static func add() -> Bool {
    guard !isInDock else { return true }
    let tile: [String: Any] = [
      "tile-type": "file-tile",
      "tile-data": [
        "bundle-identifier": Bundle.main.bundleIdentifier ?? "",
        "file-label": ProcessInfo.processInfo.processName,
        "file-type": 41,
        "file-data": ["_CFURLString": Bundle.main.bundleURL.absoluteString, "_CFURLStringType": 15],
      ] as [String: Any],
    ]
    CFPreferencesSetAppValue(key, (tiles + [tile]) as CFArray, domain)
    guard CFPreferencesAppSynchronize(domain) else { return false }
    // The Dock only reads persistent-apps when it starts.
    let restart = Process()
    restart.executableURL = URL(fileURLWithPath: "/usr/bin/killall")
    restart.arguments = ["Dock"]
    try? restart.run()
    return true
  }
}
