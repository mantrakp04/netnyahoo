import AppKit
import ExpoModulesCore

/// URLs handed to the app (default browser, `open -a`, dock drops) before JS is
/// listening are buffered here; ShellModule drains them to "onOpenURLs".
public enum OpenURLInbox {
  static var pending: [String] = []
  static var deliver: (([String]) -> Void)?

  public static func receive(_ urls: [URL]) {
    let strings = urls.map { $0.isFileURL ? $0.absoluteString : $0.absoluteString }
    if let deliver { deliver(strings) } else { pending += strings }
  }
}

public class ShellModule: Module {
  static func documentURL(_ name: String) throws -> URL {
    let dir: URL
    if let custom = ProcessInfo.processInfo.environment["NETNYAHOO_DATA_DIR"] {
      // Dev override so several instances can run side by side.
      dir = URL(fileURLWithPath: custom, isDirectory: true)
    } else {
      let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      dir = base.appendingPathComponent(Bundle.main.bundleIdentifier ?? "Netnyahoo", isDirectory: true)
    }
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir.appendingPathComponent((name as NSString).lastPathComponent)
  }

  private var appearanceObservation: NSKeyValueObservation?
  /// App-state observers for the sidebar (see `observeForSidebar`).
  private var sidebarObservers: [(NotificationCenter, NSObjectProtocol)] = []
  private var flagsMonitor: Any?

  public func definition() -> ModuleDefinition {
    Name("NetnyahooShell")
    Events("onCommand", "onOpenURLs", "onWindowEvent", "onAppEvent")

    OnCreate {
      _ = installTextFieldSelectAll
      _ = installScrollViewInsetFix
      DispatchQueue.main.async { [weak self] in
        MenuTarget.shared.handler = { command, arg, windowId in
          if command == "closeTab", WindowManager.shared.closeForeignKeyWindow() { return }
          self?.sendEvent("onCommand", ["command": command, "arg": arg as Any, "windowId": windowId as Any])
        }
        WindowManager.shared.emit = { name, body in self?.sendEvent(name, body) }
        NSApp.mainMenu = MainMenu.build()
        self?.appearanceObservation = NSApp.observe(\.effectiveAppearance) { _, _ in
          self?.sendEvent("onAppEvent", ["type": "appearance", "dark": ShellModule.isDark])
        }
        self?.observeForSidebar()
      }
    }

    OnDestroy { [weak self] in
      guard let self else { return }
      for (center, token) in self.sidebarObservers { center.removeObserver(token) }
      self.sidebarObservers = []
      if let monitor = self.flagsMonitor { NSEvent.removeMonitor(monitor) }
      self.flagsMonitor = nil
    }

    OnStartObserving("onAppEvent") {
      DispatchQueue.main.async { WindowManager.shared.appEventsObserved = true }
    }

    OnStartObserving("onOpenURLs") {
      DispatchQueue.main.async { [weak self] in
        OpenURLInbox.deliver = { urls in self?.sendEvent("onOpenURLs", ["urls": urls]) }
        if !OpenURLInbox.pending.isEmpty {
          let urls = OpenURLInbox.pending
          OpenURLInbox.pending = []
          OpenURLInbox.deliver?(urls)
        }
      }
    }

    // MARK: Windows

    /// False when running in an app build that predates multi-window support.
    Function("hasWindowHost") { WindowManager.shared.hasHost }

    AsyncFunction("openWindow") { (id: String, options: [String: Any]) in
      WindowManager.shared.open(
        id: id,
        frame: options["frame"] as? [Double],
        incognito: options["incognito"] as? Bool ?? false,
        title: options["title"] as? String ?? "",
        focus: options["focus"] as? Bool ?? true,
        kind: options["kind"] as? String ?? "browser",
        profile: options["profile"] as? String)
    }.runOnQueue(.main)

    AsyncFunction("closeWindow") { (id: String) in WindowManager.shared.close(id: id) }.runOnQueue(.main)
    /// The window's profile changed: that profile's Chrome window takes it over.
    AsyncFunction("setWindowProfile") { (id: String, profile: String, neighbours: [String]) in
      WindowManager.shared.setProfile(id: id, profile: profile, neighbours: neighbours)
    }.runOnQueue(.main)
    AsyncFunction("focusWindow") { (id: String) in WindowManager.shared.focus(id: id) }.runOnQueue(.main)
    AsyncFunction("setWindowTitle") { (id: String, title: String) in
      WindowManager.shared.setTitle(id: id, title: title)
    }.runOnQueue(.main)
    AsyncFunction("windowIds") { () -> [String] in Array(WindowManager.shared.windows.keys) }.runOnQueue(.main)
    AsyncFunction("keyWindowId") { () -> String? in WindowManager.shared.keyWindowId }.runOnQueue(.main)

    // MARK: App

    /// "auto" | "light" | "dark" (View › Appearance).
    AsyncFunction("setAppearance") { (mode: String) in
      NSApp.appearance = mode == "light" ? NSAppearance(named: .aqua) : mode == "dark" ? NSAppearance(named: .darkAqua) : nil
    }.runOnQueue(.main)

    AsyncFunction("isDarkAppearance") { () -> Bool in ShellModule.isDark }.runOnQueue(.main)

    AsyncFunction("setMenuState") { (state: [String: Any]) in
      MenuState.current = MenuState(state)
      MainMenu.refresh()
    }.runOnQueue(.main)

    /// Answers a `willQuit` app event once the session is saved.
    AsyncFunction("replyToTerminate") { (ok: Bool) in WindowManager.shared.replyToTerminate(ok) }.runOnQueue(.main)

    /// A sheet on the window (or an app-modal alert): { title, message, confirmTitle,
    /// cancelTitle, destructive, suppression, windowId } → { confirmed, suppressed }.
    AsyncFunction("confirm") { (options: [String: Any], promise: Promise) in
      let alert = ShellModule.alert(options)
      alert.addButton(withTitle: options["confirmTitle"] as? String ?? "OK")
      alert.addButton(withTitle: options["cancelTitle"] as? String ?? "Cancel")
      if options["destructive"] as? Bool == true { alert.buttons.first?.hasDestructiveAction = true }
      if let suppression = options["suppression"] as? String {
        alert.showsSuppressionButton = true
        alert.suppressionButton?.title = suppression
      }
      ShellModule.present(alert, windowId: options["windowId"] as? String) { response in
        promise.resolve([
          "confirmed": response == .alertFirstButtonReturn,
          "suppressed": alert.suppressionButton?.state == .on,
        ])
      }
    }.runOnQueue(.main)

    /// Text prompt: { title, message, value, placeholder, confirmTitle, windowId } → string | null.
    AsyncFunction("prompt") { (options: [String: Any], promise: Promise) in
      let alert = ShellModule.alert(options)
      alert.addButton(withTitle: options["confirmTitle"] as? String ?? "OK")
      alert.addButton(withTitle: "Cancel")
      let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
      field.stringValue = options["value"] as? String ?? ""
      field.placeholderString = options["placeholder"] as? String
      alert.accessoryView = field
      alert.window.initialFirstResponder = field
      ShellModule.present(alert, windowId: options["windowId"] as? String) { response in
        let text = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        promise.resolve(response == .alertFirstButtonReturn && !text.isEmpty ? text : nil)
      }
    }.runOnQueue(.main)

    /// Starts macOS dictation into the focused text field.
    Function("startDictation") {
      DispatchQueue.main.async { NSApp.sendAction(Selector(("startDictation:")), to: nil, from: nil) }
    }

    /// Open panel for local files; resolves with file:// URLs.
    AsyncFunction("pickFiles") { (promise: Promise) in
      let panel = NSOpenPanel()
      panel.allowsMultipleSelection = true
      panel.canChooseDirectories = false
      panel.begin { response in
        promise.resolve(response == .OK ? panel.urls.map(\.absoluteString) : [])
      }
    }.runOnQueue(.main)

    /// Small JSON documents (session, settings) in Application Support/<bundle id>/.
    Function("readDocument") { (name: String) -> String? in
      guard let url = try? ShellModule.documentURL(name) else { return nil }
      return try? String(contentsOf: url, encoding: .utf8)
    }

    Function("writeDocument") { (name: String, contents: String) in
      let url = try ShellModule.documentURL(name)
      try contents.write(to: url, atomically: true, encoding: .utf8)
    }

    Function("copyText") { (text: String) in
      DispatchQueue.main.async {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
      }
    }

    /// Native context menu at the pointer. Resolves with the chosen item's id, or nil.
    /// Items: { id, title, symbol?, swatch?, key?, modifiers?, enabled?, checked?, children? } | { separator }.
    AsyncFunction("showMenu") { (items: [[String: Any]], promise: Promise) in
      let target = MenuChoice()
      let menu = ShellModule.contextMenu(items, target: target)
      menu.popUp(positioning: nil, at: NSEvent.mouseLocation, in: nil)
      // The action is delivered before popUp returns; resolve on the next turn to be safe.
      DispatchQueue.main.async { promise.resolve(target.chosen) }
    }.runOnQueue(.main)

    View(WindowDragRegion.self) {}
  }

  /// Dia clears abandoned New Tab pages when you switch apps or lock the screen,
  /// and its ⌃Tab switcher commits when ⌃ is released.
  private func observeForSidebar() {
    let emit: (String) -> Void = { [weak self] type in self?.sendEvent("onAppEvent", ["type": type]) }
    // Not while a sheet or alert is up: the user is in the middle of something (e.g. a close warning).
    let quiet = { NSApp.modalWindow == nil && !NSApp.windows.contains { $0.attachedSheet != nil || $0.isSheet && $0.isVisible } }
    let workspace = NotificationCenter.default
    sidebarObservers.append((workspace, workspace.addObserver(forName: NSApplication.didResignActiveNotification, object: nil, queue: .main) { _ in
      if quiet() { emit("resignActive") }
    }))
    let distributed = DistributedNotificationCenter.default()
    sidebarObservers.append((distributed, distributed.addObserver(forName: .init("com.apple.screenIsLocked"), object: nil, queue: .main) { _ in
      if quiet() { emit("screenLocked") }
    }))
    var controlDown = false
    flagsMonitor = NSEvent.addLocalMonitorForEvents(matching: .flagsChanged) { event in
      let down = event.modifierFlags.contains(.control)
      if controlDown && !down { emit("controlReleased") }
      controlDown = down
      return event
    }
  }

  static var isDark: Bool {
    NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
  }

  static func alert(_ options: [String: Any]) -> NSAlert {
    let alert = NSAlert()
    alert.messageText = options["title"] as? String ?? ""
    alert.informativeText = options["message"] as? String ?? ""
    return alert
  }

  static func present(_ alert: NSAlert, windowId: String?, completion: @escaping (NSApplication.ModalResponse) -> Void) {
    if let window = windowId.flatMap({ WindowManager.shared.windows[$0] }), window.isVisible {
      alert.beginSheetModal(for: window, completionHandler: completion)
    } else {
      completion(alert.runModal())
    }
  }

  static func contextMenu(_ items: [[String: Any]], target: MenuChoice) -> NSMenu {
    let menu = NSMenu()
    menu.autoenablesItems = false
    let modifierNames: [String: NSEvent.ModifierFlags] = [
      "command": .command, "shift": .shift, "option": .option, "control": .control,
    ]
    for item in items {
      if item["separator"] as? Bool == true {
        menu.addItem(.separator())
        continue
      }
      let entry = NSMenuItem(title: item["title"] as? String ?? "", action: nil, keyEquivalent: item["key"] as? String ?? "")
      if let mods = item["modifiers"] as? [String] {
        entry.keyEquivalentModifierMask = NSEvent.ModifierFlags(mods.compactMap { modifierNames[$0] })
      }
      if let children = item["children"] as? [[String: Any]] {
        entry.submenu = contextMenu(children, target: target)
      } else {
        entry.action = #selector(MenuChoice.choose(_:))
        entry.target = target
        entry.representedObject = item["id"]
      }
      entry.isEnabled = item["enabled"] as? Bool ?? true
      entry.state = item["checked"] as? Bool == true ? .on : .off
      if let symbol = item["symbol"] as? String {
        entry.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
      } else if let hex = item["swatch"] as? String, let color = NSColor(hex: hex) {
        entry.image = swatch(color)
      }
      menu.addItem(entry)
    }
    return menu
  }

  /// A small filled circle, for colour choices in menus.
  static func swatch(_ color: NSColor) -> NSImage {
    NSImage(size: NSSize(width: 12, height: 12), flipped: false) { rect in
      color.setFill()
      NSBezierPath(ovalIn: rect.insetBy(dx: 0.5, dy: 0.5)).fill()
      NSColor.black.withAlphaComponent(0.15).setStroke()
      NSBezierPath(ovalIn: rect.insetBy(dx: 0.5, dy: 0.5)).stroke()
      return true
    }
  }
}

final class MenuChoice: NSObject {
  var chosen: String?
  @objc func choose(_ sender: NSMenuItem) { chosen = sender.representedObject as? String }
}

/// What the app delegate forwards to the shell.
public enum ShellApp {
  public static func shouldTerminate() -> NSApplication.TerminateReply { WindowManager.shared.shouldTerminate() }
  /// Dock icon clicked; `hasVisibleWindows` as AppKit reports it.
  public static func reopen(hasVisibleWindows: Bool) -> Bool {
    if !hasVisibleWindows { WindowManager.shared.reopen() }
    return true
  }
  public static func dockMenu() -> NSMenu { MainMenu.dockMenu() }
}

/// Single-line label that fades out at the trailing edge when it overflows,
/// like Dia's tab titles (no ellipsis).
public class FadeLabelModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NetnyahooFadeLabel")

    View(FadeLabel.self) {
      Prop("text") { (view: FadeLabel, v: String) in view.text = v }
      Prop("fontSize") { (view: FadeLabel, v: Double) in view.fontSize = v }
      Prop("weight") { (view: FadeLabel, v: String) in view.weight = v }
      Prop("color") { (view: FadeLabel, hex: String) in view.color = NSColor(hex: hex) ?? .labelColor }
      Prop("fadeWidth") { (view: FadeLabel, v: Double) in view.fadeWidth = v }
    }
  }
}

final class FadeLabel: ExpoView {
  private let field = NSTextField(labelWithString: "")
  private let fade = CAGradientLayer()

  var text = "" { didSet { update() } }
  var fontSize: Double = 13 { didSet { update() } }
  var weight = "regular" { didSet { update() } }
  var color: NSColor = .labelColor { didSet { field.textColor = color } }
  var fadeWidth: Double = 24 { didSet { relayout() } }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
    // macOS 14+ no longer clips subviews by default; the text field is wider
    // than the label when it overflows, so clip to our bounds.
    clipsToBounds = true
    field.lineBreakMode = .byClipping
    field.maximumNumberOfLines = 1
    field.cell?.truncatesLastVisibleLine = false
    field.isSelectable = false
    addSubview(field)
    fade.colors = [NSColor.black.cgColor, NSColor.black.cgColor, NSColor.clear.cgColor]
    fade.startPoint = CGPoint(x: 0, y: 0.5)
    fade.endPoint = CGPoint(x: 1, y: 0.5)
    update()
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    relayout()
  }

  private func update() {
    let weights: [String: NSFont.Weight] = [
      "light": .light, "regular": .regular, "medium": .medium, "semibold": .semibold, "bold": .bold,
    ]
    // Dia's TabContentView title uses the monospaced-digit system font.
    field.font = .monospacedDigitSystemFont(ofSize: fontSize, weight: weights[weight] ?? .regular)
    field.stringValue = text
    field.textColor = color
    relayout()
  }

  private func relayout() {
    let fitting = field.fittingSize
    field.frame = NSRect(x: 0, y: (bounds.height - fitting.height) / 2, width: max(bounds.width, fitting.width), height: fitting.height)
    // The mask lives on the text field's layer: RCTView resets `mask` on its own
    // backing layer during updates.
    field.wantsLayer = true
    guard bounds.width > 0, fitting.width > bounds.width + 0.5 else {
      field.layer?.mask = nil
      return
    }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    fade.frame = CGRect(x: 0, y: 0, width: bounds.width, height: field.frame.height)
    let start = max(0, 1 - fadeWidth / bounds.width)
    fade.locations = [0, NSNumber(value: start), 1]
    field.layer?.mask = fade
    CATransaction.commit()
  }
}

/// Dia's tab loading spinner (TabUI `ActivitySpinnerView`, in a tab row's trailing slot):
/// a faint track ring and a 72% arc, both 1.5pt wide on an ellipse inset 1.25pt, in
/// secondaryLabelColor (the track at alpha 0.18), turning once per 1.88 s. Dia 1.50 animates
/// `transform.rotation.z` 0 → −2π in its unflipped (y-up) view, which is clockwise on screen;
/// 1.49 used +2π, counter-clockwise.
public class ActivitySpinnerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NetnyahooActivitySpinner")

    View(ActivitySpinner.self) {}
  }
}

final class ActivitySpinner: ExpoView {
  private let track = CAShapeLayer()
  private let ring = CAShapeLayer()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
    for shape in [track, ring] {
      shape.fillColor = nil
      shape.lineWidth = 1.5
    }
    ring.lineCap = .round
    ring.strokeStart = 0
    ring.strokeEnd = 0.72
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    relayout()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    relayout()
    spin()
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    recolor()
  }

  /// Sublayers, not the backing layer: RCTView resets its own layer's properties on updates.
  private func relayout() {
    guard let layer else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    for shape in [track, ring] where shape.superlayer !== layer { layer.addSublayer(shape) }
    let path = CGPath(ellipseIn: bounds.insetBy(dx: 1.25, dy: 1.25), transform: nil)
    for shape in [track, ring] {
      shape.frame = bounds
      shape.path = path
    }
    CATransaction.commit()
    recolor()
  }

  private func recolor() {
    effectiveAppearance.performAsCurrentDrawingAppearance {
      track.strokeColor = NSColor.secondaryLabelColor.withAlphaComponent(0.18).cgColor
      ring.strokeColor = NSColor.secondaryLabelColor.cgColor
    }
  }

  /// Removed when the view leaves its window, so re-added on every move.
  private func spin() {
    guard window != nil, ring.animation(forKey: "activityRotation") == nil else { return }
    let turn = CABasicAnimation(keyPath: "transform.rotation.z")
    turn.fromValue = 0
    // Dia's −2π is in y-up coordinates; this view is flipped (y-down), where the same on-screen
    // turn is +2π.
    turn.toValue = isFlipped ? 2 * Double.pi : -2 * Double.pi
    turn.duration = 1.88
    turn.repeatCount = .infinity
    turn.timingFunction = CAMediaTimingFunction(name: .linear)
    turn.isRemovedOnCompletion = false
    ring.add(turn, forKey: "activityRotation")
  }
}

// One view per module: on the legacy architecture Expo's view-manager adapter
// instantiates a module's first view class for every view it declares.
public class SymbolModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NetnyahooSymbol")

    View(SymbolView.self) {
      Prop("name") { (view: SymbolView, name: String) in view.name = name }
      Prop("size") { (view: SymbolView, size: Double) in view.pointSize = size }
      Prop("weight") { (view: SymbolView, weight: String) in view.weight = weight }
      Prop("color") { (view: SymbolView, hex: String) in view.tint = NSColor(hex: hex) }
    }
  }
}

/// Transparent area that drags the window (and zooms on double-click),
/// used for the sidebar header and empty toolbar space.
final class WindowDragRegion: ExpoView {
  override var mouseDownCanMoveWindow: Bool {
    get { true }
    set {}
  }

  override func mouseDown(with event: NSEvent) {
    if event.clickCount == 2 {
      let action = UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") ?? "Maximize"
      action == "Minimize" ? window?.performMiniaturize(nil) : window?.performZoom(nil)
      return
    }
    window?.performDrag(with: event)
  }
}

/// SF Symbol glyph, tinted. Used for all toolbar/sidebar icons.
final class SymbolView: ExpoView {
  private let imageView = NSImageView()
  var name = "questionmark" { didSet { update() } }
  var pointSize: Double = 14 { didSet { update() } }
  var weight = "regular" { didSet { update() } }
  var tint: NSColor? { didSet { imageView.contentTintColor = tint } }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    imageView.imageScaling = .scaleNone
    imageView.autoresizingMask = [.width, .height]
    addSubview(imageView)
    update()
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  // RN macOS assigns frames directly and doesn't autoresize subviews.
  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    imageView.frame = bounds
  }

  private func update() {
    let weights: [String: NSFont.Weight] = [
      "light": .light, "regular": .regular, "medium": .medium, "semibold": .semibold, "bold": .bold,
    ]
    let config = NSImage.SymbolConfiguration(pointSize: pointSize, weight: weights[weight] ?? .regular)
    imageView.image = NSImage(systemSymbolName: name, accessibilityDescription: nil)?.withSymbolConfiguration(config)
  }
}

extension NSColor {
  /// `#RRGGBB` or `#RRGGBBAA`.
  convenience init?(hex: String) {
    var s = hex.trimmingCharacters(in: .whitespaces)
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 6 || s.count == 8, let v = UInt64(s, radix: 16) else { return nil }
    let rgba = s.count == 6 ? (v << 8) | 0xFF : v
    self.init(
      srgbRed: CGFloat((rgba >> 24) & 0xFF) / 255, green: CGFloat((rgba >> 16) & 0xFF) / 255,
      blue: CGFloat((rgba >> 8) & 0xFF) / 255, alpha: CGFloat(rgba & 0xFF) / 255)
  }
}

/// react-native-macos implements TextInput's `selectTextOnFocus` by sending
/// `-selectAll:` to its NSTextField subclass, which only answers `-selectText:`
/// (Swift sees `selectAll(_:)` as an unimplemented optional NSResponder method).
let installTextFieldSelectAll: Void = {
  let block: @convention(block) (NSTextField, Any?) -> Void = { field, sender in field.selectText(sender) }
  class_addMethod(NSTextField.self, #selector(NSText.selectAll(_:)), imp_implementationWithBlock(block), "v@:@")
}()

/// Legacy-arch RCTScrollView leaves NSScrollView's automaticallyAdjustsContentInsets on, so a
/// scroll view that reaches under the (full-size-content) titlebar silently gains a top inset
/// that React Native doesn't know about. The Fabric scroll view turns it off; do the same here.
let installScrollViewInsetFix: Void = {
  guard let cls = NSClassFromString("RCTCustomScrollView"),
        let method = class_getInstanceMethod(cls, #selector(NSView.init(frame:))) else { return }
  typealias Init = @convention(c) (AnyObject, Selector, NSRect) -> AnyObject
  let original = unsafeBitCast(method_getImplementation(method), to: Init.self)
  let block: @convention(block) (AnyObject, NSRect) -> AnyObject = { receiver, frame in
    let view = original(receiver, #selector(NSView.init(frame:)), frame)
    (view as? NSScrollView)?.automaticallyAdjustsContentInsets = false
    return view
  }
  let imp = imp_implementationWithBlock(block)
  // Only ever patch RCTCustomScrollView itself, never an inherited NSScrollView implementation.
  if !class_addMethod(cls, #selector(NSView.init(frame:)), imp, method_getTypeEncoding(method)) {
    method_setImplementation(method, imp)
  }
}()

/// Wrapper that reports secondary clicks (right-click / ctrl-click) to JS.
/// react-native-macos has no context-menu event of its own.
public class ContextMenuAreaModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NetnyahooContextMenuArea")

    View(ContextMenuArea.self) {
      Events("onContextMenu")
      Prop("captureDescendants") { (view: ContextMenuArea, on: Bool) in view.captureDescendants = on }
    }
  }
}

final class ContextMenuArea: ExpoView {
  let onContextMenu = EventDispatcher()
  /// Also take right-clicks aimed at descendants that have their own menu (a text field's
  /// Cut/Copy/Paste), so the area's menu replaces it. Left clicks still reach them.
  var captureDescendants = false

  override func hitTest(_ point: NSPoint) -> NSView? {
    let hit = super.hitTest(point)
    guard captureDescendants, hit != nil, let event = NSApp.currentEvent else { return hit }
    let secondary = event.type == .rightMouseDown || (event.type == .leftMouseDown && event.modifierFlags.contains(.control))
    return secondary ? self : hit
  }

  override func rightMouseDown(with event: NSEvent) {
    onContextMenu([:])
  }

  override func mouseDown(with event: NSEvent) {
    if event.modifierFlags.contains(.control) {
      onContextMenu([:])
      return
    }
    super.mouseDown(with: event)
  }

  override func menu(for event: NSEvent) -> NSMenu? { nil }
}

/// A rounded surface with fill, hairline border and a layer shadow, drawn natively.
/// react-native-macos's own shadow support (`-[RCTView didUpdateShadow]`) crashes
/// when shadow props are re-applied, so every shadowed surface in the UI uses this.
/// An NSVisualEffectView (blur + material tint) sized to the RN view, with rounded corners.
/// Dia's New Tab command bar sits on `.hudWindow` blended `.withinWindow`.
public class VisualEffectModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NetnyahooVisualEffect")

    View(VisualEffect.self) {
      Prop("material") { (view: VisualEffect, name: String) in view.setMaterial(name) }
      Prop("blendingMode") { (view: VisualEffect, name: String) in
        view.effect.blendingMode = name == "behindWindow" ? .behindWindow : .withinWindow
      }
      Prop("cornerRadius") { (view: VisualEffect, v: Double) in view.cornerRadius = v }
    }
  }
}

final class VisualEffect: ExpoView {
  let effect = NSVisualEffectView()
  var cornerRadius: Double = 0 { didSet { applyCorners() } }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    effect.state = .active
    effect.blendingMode = .withinWindow
    effect.material = .hudWindow
    effect.wantsLayer = true
    addSubview(effect)
  }

  func setMaterial(_ name: String) {
    let materials: [String: NSVisualEffectView.Material] = [
      "hudWindow": .hudWindow, "popover": .popover, "menu": .menu, "sidebar": .sidebar,
      "headerView": .headerView, "sheet": .sheet, "windowBackground": .windowBackground,
      "underWindowBackground": .underWindowBackground, "contentBackground": .contentBackground,
      "fullScreenUI": .fullScreenUI, "toolTip": .toolTip, "titlebar": .titlebar, "selection": .selection,
    ]
    effect.material = materials[name] ?? .hudWindow
  }

  private func applyCorners() {
    effect.layer?.cornerRadius = cornerRadius
    effect.layer?.cornerCurve = .continuous
    effect.layer?.masksToBounds = cornerRadius > 0
  }

  // RN macOS doesn't autoresize subviews.
  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    effect.frame = bounds
    applyCorners()
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

public class SurfaceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NetnyahooSurface")

    View(Surface.self) {
      Prop("fill") { (view: Surface, hex: String?) in view.surfaceFill = hex.flatMap(NSColor.init(hex:)) }
      Prop("cornerRadius") { (view: Surface, v: Double) in view.surfaceRadius = v }
      Prop("borderColor") { (view: Surface, hex: String?) in view.surfaceBorderColor = hex.flatMap(NSColor.init(hex:)) }
      Prop("borderWidth") { (view: Surface, v: Double) in view.surfaceBorderWidth = v }
      Prop("borderColors") { (view: Surface, hexes: [String]?) in view.surfaceBorderColors = (hexes ?? []).compactMap(NSColor.init(hex:)) }
      // Not `shadow*`: Surface is an RCTView, and RN's view manager would also hand those to
      // -[RCTView setShadow…:], whose didUpdateShadow crashes when they're re-applied.
      Prop("surfaceShadowColor") { (view: Surface, hex: String?) in view.surfaceShadowColor = hex.flatMap(NSColor.init(hex:)) }
      Prop("surfaceShadowOpacity") { (view: Surface, v: Double) in view.surfaceShadowOpacity = v }
      Prop("surfaceShadowRadius") { (view: Surface, v: Double) in view.surfaceShadowRadius = v }
      Prop("surfaceShadowOffset") { (view: Surface, v: [Double]) in view.surfaceShadowOffset = v.count == 2 ? CGSize(width: v[0], height: v[1]) : .zero }
    }
  }
}

final class Surface: ExpoView {
  var surfaceFill: NSColor? { didSet { apply() } }
  var surfaceRadius: Double = 0 { didSet { apply() } }
  var surfaceBorderColor: NSColor? { didSet { apply() } }
  var surfaceBorderWidth: Double = 0 { didSet { apply() } }
  /// Top → bottom gradient for the border (Dia's selected tab uses a 1pt gradient stroke).
  var surfaceBorderColors: [NSColor] = [] { didSet { apply() } }
  var surfaceShadowColor: NSColor? { didSet { apply() } }
  var surfaceShadowOpacity: Double = 0 { didSet { apply() } }
  var surfaceShadowRadius: Double = 0 { didSet { apply() } }
  var surfaceShadowOffset: CGSize = .zero { didSet { apply() } }

  /// Drawn on its own sublayer: RCTView re-applies background/border/radius to
  /// its backing layer in updateLayer, which would overwrite ours.
  private let plate = CALayer()
  /// The shadow lives on its own layer, masked to the outside of the shape, so a
  /// translucent fill doesn't show the shadow through it.
  private let shadowLayer = CALayer()
  private let shadowMask = CAShapeLayer()
  private let borderGradient = CAGradientLayer()
  private let borderStroke = CAShapeLayer()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
  }

  override func layout() {
    super.layout()
    apply()
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    apply()
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    apply()
  }

  override func updateLayer() {
    super.updateLayer()
    apply()
  }

  private func apply() {
    guard let layer else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    // Sublayer order (bottom → top): shadow, plate (fill), gradient border, RN content.
    if borderGradient.superlayer !== layer {
      layer.insertSublayer(borderGradient, at: 0)
      borderStroke.fillColor = nil
      borderStroke.strokeColor = NSColor.black.cgColor
      borderGradient.mask = borderStroke
    }
    if plate.superlayer !== layer {
      layer.insertSublayer(plate, at: 0)
      layer.insertSublayer(shadowLayer, below: plate)
      shadowMask.fillRule = .evenOdd
      shadowLayer.mask = shadowMask
    }
    layer.masksToBounds = false
    plate.frame = bounds
    plate.cornerRadius = surfaceRadius
    plate.cornerCurve = .continuous
    plate.backgroundColor = surfaceFill?.cgColor
    plate.borderColor = surfaceBorderColor?.cgColor
    plate.borderWidth = surfaceBorderWidth

    // Gradient border: a stroked path masking a vertical gradient, above the plate.
    if surfaceBorderColors.count >= 2, surfaceBorderWidth > 0 {
      borderGradient.isHidden = false
      borderGradient.frame = bounds
      borderGradient.colors = surfaceBorderColors.map(\.cgColor)
      // RN views are flipped: y=0 is the top.
      let flipped = layer.isGeometryFlipped || isFlipped
      borderGradient.startPoint = CGPoint(x: 0.5, y: flipped ? 0 : 1)
      borderGradient.endPoint = CGPoint(x: 0.5, y: flipped ? 1 : 0)
      let inset = surfaceBorderWidth / 2
      borderStroke.frame = bounds
      borderStroke.lineWidth = surfaceBorderWidth
      borderStroke.path = CGPath(
        roundedRect: bounds.insetBy(dx: inset, dy: inset),
        cornerWidth: max(surfaceRadius - inset, 0), cornerHeight: max(surfaceRadius - inset, 0), transform: nil)
      plate.borderWidth = 0
    } else {
      borderGradient.isHidden = true
    }

    let shape = CGPath(roundedRect: bounds, cornerWidth: surfaceRadius, cornerHeight: surfaceRadius, transform: nil)
    shadowLayer.frame = bounds
    if let shadowColor = surfaceShadowColor, surfaceShadowOpacity > 0 {
      shadowLayer.shadowColor = shadowColor.cgColor
      shadowLayer.shadowOpacity = Float(surfaceShadowOpacity)
      shadowLayer.shadowRadius = surfaceShadowRadius
      // RN views are flipped; positive y should move the shadow down on screen.
      shadowLayer.shadowOffset = CGSize(width: surfaceShadowOffset.width, height: layer.isGeometryFlipped || isFlipped ? surfaceShadowOffset.height : -surfaceShadowOffset.height)
      shadowLayer.shadowPath = shape
      let outset = surfaceShadowRadius * 3 + abs(surfaceShadowOffset.height) + abs(surfaceShadowOffset.width) + 4
      let mask = CGMutablePath()
      mask.addRect(bounds.insetBy(dx: -outset, dy: -outset))
      mask.addPath(shape)
      shadowMask.frame = bounds
      shadowMask.path = mask
      shadowLayer.isHidden = false
    } else {
      shadowLayer.isHidden = true
    }
    CATransaction.commit()
  }
}
