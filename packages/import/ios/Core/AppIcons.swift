import AppKit

/// Locates installed browser apps and renders their icons to PNGs the JS side can show with
/// a plain `<Image source={{ uri: "file://…" }}>`.
public enum AppIcons {
  public static func locate(_ bundleIds: [String]) -> URL? {
    for id in bundleIds {
      if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: id) { return url }
    }
    return nil
  }

  /// Writes a 64pt @2x PNG of the app's icon into `directory` (cached by browser id + app
  /// modification date) and returns its path.
  public static func png(for app: URL, id: String, directory: URL) -> String? {
    let stamp = (try? app.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate)
      .map { Int($0.timeIntervalSince1970) } ?? 0
    let file = directory.appendingPathComponent("\(id)-\(stamp).png")
    if FileManager.default.fileExists(atPath: file.path) { return file.path }

    let icon = NSWorkspace.shared.icon(forFile: app.path)
    let pixels = 128
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8,
                                     samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                     bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
    rep.size = NSSize(width: 64, height: 64)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    icon.draw(in: NSRect(x: 0, y: 0, width: 64, height: 64), from: .zero, operation: .copy, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    guard let png = rep.representation(using: .png, properties: [:]) else { return nil }
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      // Drop icons cached for an older version of the same app.
      for old in (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? [] where old.hasPrefix("\(id)-") {
        try? FileManager.default.removeItem(at: directory.appendingPathComponent(old))
      }
      try png.write(to: file, options: .atomic)
      return file.path
    } catch {
      return nil
    }
  }
}
