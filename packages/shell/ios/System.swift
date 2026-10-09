import AppKit
import ExpoModulesCore
import UniformTypeIdentifiers
import ServiceManagement

public class SystemModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArcadiaSystem")

    // MARK: Default browser

    AsyncFunction("isDefaultBrowser") { () -> Bool in
      guard let probe = URL(string: "https://example.com"),
            let handler = NSWorkspace.shared.urlForApplication(toOpen: probe) else { return false }
      return handler.standardizedFileURL == Bundle.main.bundleURL.standardizedFileURL
    }.runOnQueue(.main)

    AsyncFunction("setAsDefaultBrowser") { (promise: Promise) in
      let app = Bundle.main.bundleURL
      NSWorkspace.shared.setDefaultApplication(at: app, toOpenURLsWithScheme: "http") { error in
        guard error == nil else { return promise.resolve(false) }
        NSWorkspace.shared.setDefaultApplication(at: app, toOpenURLsWithScheme: "https") { _ in
          DispatchQueue.main.async {
            let handler = URL(string: "https://example.com").flatMap(NSWorkspace.shared.urlForApplication(toOpen:))
            promise.resolve(handler?.standardizedFileURL == app.standardizedFileURL)
          }
        }
      }
    }.runOnQueue(.main)

    // MARK: Login item

    AsyncFunction("launchAtLoginStatus") { () -> String in
      switch SMAppService.mainApp.status {
      case .enabled: return "enabled"
      case .requiresApproval: return "requiresApproval"
      case .notFound: return "notFound"
      default: return "notRegistered"
      }
    }.runOnQueue(.main)

    AsyncFunction("setLaunchAtLogin") { (enabled: Bool) in
      if enabled {
        try SMAppService.mainApp.register()
      } else {
        try SMAppService.mainApp.unregister()
      }
    }.runOnQueue(.main)

    // MARK: Files

    Function("fileExists") { (path: String) -> Bool in FileManager.default.fileExists(atPath: path) }

    AsyncFunction("openFile") { (path: String) -> Bool in
      guard FileManager.default.fileExists(atPath: path) else { return false }
      return NSWorkspace.shared.open(URL(fileURLWithPath: path))
    }.runOnQueue(.main)

    AsyncFunction("revealFile") { (path: String) -> Bool in
      guard FileManager.default.fileExists(atPath: path) else { return false }
      NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
      return true
    }.runOnQueue(.main)

    AsyncFunction("moveToTrash") { (path: String) -> Bool in
      guard FileManager.default.fileExists(atPath: path) else { return false }
      do {
        try FileManager.default.trashItem(at: URL(fileURLWithPath: path), resultingItemURL: nil)
        return true
      } catch {
        return false
      }
    }.runOnQueue(.main)

    AsyncFunction("fileIcon") { (path: String, size: Double) -> String? in
      let icon = FileManager.default.fileExists(atPath: path)
        ? NSWorkspace.shared.icon(forFile: path)
        : NSWorkspace.shared.icon(for: .init(filenameExtension: (path as NSString).pathExtension) ?? .data)
      let points = CGFloat(size)
      let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: Int(points * 2), pixelsHigh: Int(points * 2), bitsPerSample: 8,
        samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
      guard let rep else { return nil }
      rep.size = NSSize(width: points, height: points)
      NSGraphicsContext.saveGraphicsState()
      NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
      icon.draw(in: NSRect(x: 0, y: 0, width: points, height: points))
      NSGraphicsContext.restoreGraphicsState()
      guard let png = rep.representation(using: .png, properties: [:]) else { return nil }
      return "data:image/png;base64,\(png.base64EncodedString())"
    }.runOnQueue(.main)

    AsyncFunction("appIcon") { (pid: Int, size: Double) -> String? in
      guard let icon = NSRunningApplication(processIdentifier: pid_t(pid))?.icon else { return nil }
      let points = CGFloat(size)
      guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: Int(points * 2), pixelsHigh: Int(points * 2), bitsPerSample: 8,
        samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
      else { return nil }
      rep.size = NSSize(width: points, height: points)
      NSGraphicsContext.saveGraphicsState()
      NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
      icon.draw(in: NSRect(x: 0, y: 0, width: points, height: points))
      NSGraphicsContext.restoreGraphicsState()
      guard let png = rep.representation(using: .png, properties: [:]) else { return nil }
      return "data:image/png;base64,\(png.base64EncodedString())"
    }.runOnQueue(.main)

    // MARK: Feedback

    Function("hapticTick") {
      DispatchQueue.main.async { NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .now) }
    }

    // MARK: Menus

    AsyncFunction("menuShortcuts") { () -> [[String: Any]] in MainMenu.shortcutList() }.runOnQueue(.main)

    AsyncFunction("recordShortcut") { (promise: Promise) in ShortcutRecorder.shared.record(promise) }.runOnQueue(.main)
    AsyncFunction("cancelRecording") { ShortcutRecorder.shared.finish(nil) }.runOnQueue(.main)
  }
}

final class ShortcutRecorder {
  static let shared = ShortcutRecorder()
  private var monitor: Any?
  private var promise: Promise?

  func record(_ promise: Promise) {
    finish(nil)
    self.promise = promise
    monitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .leftMouseDown, .rightMouseDown]) { [weak self] event in
      guard let self else { return event }
      guard event.type == .keyDown else {
        self.finish(nil)
        return event
      }
      let flags = event.modifierFlags.intersection([.command, .option, .control, .shift, .function])
      if event.keyCode == 53, flags.subtracting(.function).isEmpty {
        self.finish(nil)
        return nil
      }
      let key = (event.characters(byApplyingModifiers: []) ?? event.charactersIgnoringModifiers ?? "").lowercased()
      guard !key.isEmpty else { return nil }
      var mods: [String] = []
      if flags.contains(.control) { mods.append("control") }
      if flags.contains(.option) { mods.append("option") }
      if flags.contains(.shift) { mods.append("shift") }
      if flags.contains(.command) { mods.append("command") }
      if flags.contains(.function), let scalar = key.unicodeScalars.first, scalar.value < 0xF700 { mods.append("function") }
      self.finish(["key": key, "modifiers": mods])
      return nil
    }
  }

  func finish(_ result: [String: Any]?) {
    if let monitor { NSEvent.removeMonitor(monitor) }
    monitor = nil
    let pending = promise
    promise = nil
    pending?.resolve(result)
  }
}

public class FileDragModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArcadiaFileDrag")

    View(FileDragView.self) {
      Events("onMiddleClick")
      Prop("path") { (view: FileDragView, path: String?) in view.path = path }
    }
  }
}

final class FileDragView: ExpoView, NSDraggingSource {
  var path: String?
  let onMiddleClick = EventDispatcher()
  private var downAt: NSPoint?

  override func otherMouseUp(with event: NSEvent) {
    guard event.buttonNumber == 2 else { return super.otherMouseUp(with: event) }
    let flags = event.modifierFlags
    onMiddleClick(["shiftKey": flags.contains(.shift), "altKey": flags.contains(.option), "metaKey": flags.contains(.command)])
  }

  override func mouseDown(with event: NSEvent) {
    downAt = event.locationInWindow
    super.mouseDown(with: event)
  }

  override func mouseDragged(with event: NSEvent) {
    guard let start = downAt, let path, FileManager.default.fileExists(atPath: path) else {
      return super.mouseDragged(with: event)
    }
    let p = event.locationInWindow
    guard hypot(p.x - start.x, p.y - start.y) > 4 else { return }
    downAt = nil
    let url = URL(fileURLWithPath: path)
    let item = NSDraggingItem(pasteboardWriter: url as NSURL)
    let icon = NSWorkspace.shared.icon(forFile: path)
    let local = convert(event.locationInWindow, from: nil)
    item.setDraggingFrame(NSRect(x: local.x - 16, y: local.y - 16, width: 32, height: 32), contents: icon)
    beginDraggingSession(with: [item], event: event, source: self)
  }

  override func mouseUp(with event: NSEvent) {
    downAt = nil
    super.mouseUp(with: event)
  }

  func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation {
    context == .outsideApplication ? [.copy, .generic] : []
  }
}
