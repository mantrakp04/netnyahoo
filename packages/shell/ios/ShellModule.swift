import AppKit
import ExpoModulesCore

public enum OpenURLInbox {
  static var pending: [String] = []
  static var deliver: (([String]) -> Void)?

  public static func receive(_ urls: [URL]) {
    let strings = urls.map { $0.isFileURL ? $0.absoluteString : $0.absoluteString }
    if let deliver { deliver(strings) } else { pending += strings }
  }
}

/// JS saves (the session and history run to megabytes) land on a background queue instead of blocking the JS
/// thread for the write. A read sees the newest save of a document even before it's on disk, a save never lands
/// after a newer one of the same document, and quitting waits for the queue. A save that fails stays staged (reads
/// still see it) and is retried; `done` hears when a save (or a newer one of the same document) is on disk, or why
/// it couldn't be written.
enum DocumentStore {
  typealias Done = (Error?) -> Void
  private struct Staged {
    let url: URL
    let generation: UInt64
    let contents: String
    var waiters: [Done]
  }

  private static let queue = DispatchQueue(label: "arcadia.documents", qos: .utility)
  private static let lock = NSLock()
  private static var staged: [String: Staged] = [:]
  private static var generation: UInt64 = 0
  // Quit Without Saving: what is saved stays as it is; a save JS makes from now on is dropped.
  private static var closed = false
  private static let flushOnQuit = NotificationCenter.default.addObserver(
    forName: NSApplication.willTerminateNotification, object: nil, queue: nil
  ) { _ in flush() }

  static func read(_ name: String) -> String? {
    guard let url = try? ShellModule.documentURL(name) else { return nil }
    lock.lock()
    let pending = staged[url.lastPathComponent]?.contents
    lock.unlock()
    return pending ?? (try? String(contentsOf: url, encoding: .utf8))
  }

  static func write(_ name: String, _ contents: String, done: Done? = nil) throws {
    _ = flushOnQuit
    let url = try ShellModule.documentURL(name)
    let key = url.lastPathComponent
    lock.lock()
    if closed {
      lock.unlock()
      done?(CocoaError(.fileWriteNoPermission))
      return
    }
    generation += 1
    let mine = generation
    // Callers still waiting on an older save of this document wait for this one, which supersedes it.
    staged[key] = Staged(url: url, generation: mine, contents: contents, waiters: (staged[key]?.waiters ?? []) + (done.map { [$0] } ?? []))
    lock.unlock()
    queue.async { land(key, mine, attempt: 0) }
  }

  // Deletes the document, and any save of it still waiting.
  static func remove(_ name: String) throws {
    let url = try ShellModule.documentURL(name)
    lock.lock()
    if closed { return lock.unlock() }
    generation += 1
    let waiters = staged.removeValue(forKey: url.lastPathComponent)?.waiters ?? []
    lock.unlock()
    queue.async {
      try? FileManager.default.removeItem(at: url)
      for waiter in waiters { waiter(nil) }
    }
  }

  // On the queue. Writes the document if `generation` is still its newest save.
  private static func land(_ key: String, _ generation: UInt64, attempt: Int) {
    lock.lock()
    guard let save = staged[key], save.generation == generation else { return lock.unlock() }
    lock.unlock()
    var failure: Error?
    do {
      try save.contents.write(to: save.url, atomically: true, encoding: .utf8)
    } catch {
      failure = error
    }
    lock.lock()
    var waiters: [Done] = []
    if staged[key]?.generation == generation {
      waiters = staged[key]!.waiters
      if failure == nil { staged[key] = nil } else { staged[key]!.waiters = [] }
    }
    lock.unlock()
    for waiter in waiters { waiter(failure) }
    guard let failure else { return }
    NSLog("Arcadia: saving \(key) failed (try \(attempt + 1)): \(failure.localizedDescription)")
    // Kept staged and tried again, backing off to a minute; a newer save of the document takes over instead.
    let delay = min(60.0, 2.0 * pow(2.0, Double(min(attempt, 5))))
    queue.asyncAfter(deadline: .now() + delay) { land(key, generation, attempt: attempt + 1) }
  }

  static func close() {
    lock.lock()
    closed = true
    lock.unlock()
  }

  // Blocks until everything staged has been written once more (on quit).
  static func flush() {
    queue.sync {
      lock.lock()
      let keys = Array(staged.keys)
      lock.unlock()
      for key in keys {
        lock.lock()
        let generation = staged[key]?.generation
        lock.unlock()
        if let generation { land(key, generation, attempt: 99) }
      }
    }
  }
}

public class ShellModule: Module {
  static func documentURL(_ name: String) throws -> URL {
    let dir: URL
    if let custom = ProcessInfo.processInfo.environment["ARCADIA_DATA_DIR"] {
      dir = URL(fileURLWithPath: custom, isDirectory: true)
    } else {
      let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      dir = base.appendingPathComponent(Bundle.main.bundleIdentifier ?? "Arcadia", isDirectory: true)
    }
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir.appendingPathComponent((name as NSString).lastPathComponent)
  }

  private var appearanceObservation: NSKeyValueObservation?
  private var sidebarObservers: [(NotificationCenter, NSObjectProtocol)] = []
  private var flagsMonitor: Any?
  private var switcherMonitor: Any?

  public func definition() -> ModuleDefinition {
    Name("ArcadiaShell")
    Events("onCommand", "onOpenURLs", "onWindowEvent", "onAppEvent")

    OnCreate {
      _ = installTextFieldSelectAll
      _ = installScrollViewInsetFix
      _ = installOutsidePressMonitor
      DispatchQueue.main.async { [weak self] in
        MenuTarget.shared.handler = { command, arg, windowId in
          if command == "closeTab", WindowManager.shared.closeForeignKeyWindow() { return }
          self?.sendEvent("onCommand", ["command": command, "arg": arg as Any, "windowId": windowId as Any])
        }
        WindowManager.shared.emit = { name, body in self?.sendEvent(name, body) }
        WindowManager.shared.runtime = self.map(ObjectIdentifier.init)
        NSApp.mainMenu = MainMenu.build()
        self?.appearanceObservation = NSApp.observe(\.effectiveAppearance) { _, _ in
          self?.sendEvent("onAppEvent", ["type": "appearance", "dark": ShellModule.isDark])
        }
        self?.observeForSidebar()
        // ArcadiaCore cancelled a quit JS was told of (willQuit): JS goes on saving (WindowManager's App lifecycle).
        let quitCancelled = NotificationCenter.default.addObserver(
          forName: Notification.Name("ArcadiaCoreQuitCancelled"), object: nil, queue: .main
        ) { _ in self?.sendEvent("onAppEvent", ["type": "quitCancelled"]) }
        self?.sidebarObservers.append((NotificationCenter.default, quitCancelled))
      }
    }

    OnDestroy { [weak self] in
      guard let self else { return }
      for (center, token) in self.sidebarObservers { center.removeObserver(token) }
      self.sidebarObservers = []
      if let monitor = self.flagsMonitor { NSEvent.removeMonitor(monitor) }
      self.flagsMonitor = nil
      if let monitor = self.switcherMonitor { NSEvent.removeMonitor(monitor) }
      self.switcherMonitor = nil
      let gone = ObjectIdentifier(self)
      DispatchQueue.main.async { WindowManager.shared.runtimeGone(gone) }
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

    AsyncFunction("openWindow") { (id: String, options: [String: Any]) in
      WindowManager.shared.open(
        id: id,
        frame: options["frame"] as? [Double],
        incognito: options["incognito"] as? Bool ?? false,
        title: options["title"] as? String ?? "",
        focus: options["focus"] as? Bool ?? true,
        kind: options["kind"] as? String ?? "browser",
        profile: options["profile"] as? String,
        size: options["size"] as? [Double],
        behind: options["behind"] as? String)
    }.runOnQueue(.main)

    AsyncFunction("closeWindow") { (id: String) in WindowManager.shared.close(id: id) }.runOnQueue(.main)
    AsyncFunction("setWindowProfile") { (id: String, profile: String, neighbours: [String]) in
      WindowManager.shared.setProfile(id: id, profile: profile, neighbours: neighbours)
    }.runOnQueue(.main)
    // [x, y] from the window's top-left; nil puts the buttons back at their default place.
    AsyncFunction("setTrafficLightsCenter") { (id: String, center: [Double]?) in
      WindowManager.shared.setTrafficLightsCenter(id: id, center: center.flatMap { $0.count == 2 ? NSPoint(x: $0[0], y: $0[1]) : nil })
    }.runOnQueue(.main)
    AsyncFunction("focusWindow") { (id: String) in WindowManager.shared.focus(id: id) }.runOnQueue(.main)
    // The dragged tab's picture under the pointer (DragPreview). Rects and points are in the source window from its
    // top-left ([x, y, w, h], [x, y]), but for the new window's frame: on screen in AppKit's coordinates.
    AsyncFunction("dragPreviewBegin") { (windowId: String, chip: [Double], grab: [Double]) in
      guard chip.count == 4, grab.count == 2 else { return }
      DragPreview.shared.begin(windowId: windowId, chip: NSRect(x: chip[0], y: chip[1], width: chip[2], height: chip[3]), grab: NSPoint(x: grab[0], y: grab[1]))
    }.runOnQueue(.main)
    AsyncFunction("dragPreviewPage") { (base64: String, frame: [Double]) in
      guard frame.count == 4, let data = Data(base64Encoded: base64) else { return }
      DragPreview.shared.setPage(data, frame: NSRect(x: frame[0], y: frame[1], width: frame[2], height: frame[3]))
    }.runOnQueue(.main)
    AsyncFunction("dragPreviewUpdate") { (shape: String, point: [Double]) in
      guard point.count == 2 else { return }
      DragPreview.shared.update(shape: shape, at: NSPoint(x: point[0], y: point[1]))
    }.runOnQueue(.main)
    AsyncFunction("dragPreviewCancel") { DragPreview.shared.cancel() }.runOnQueue(.main)
    // A dragged item over its neighbours. React Native macOS's zIndex sets the layer's zPosition, which doesn't change
    // the order AppKit draws sibling views in: this puts the view with React tag `tag`, and `levels` of its ancestors,
    // last among their siblings; lowered, they're back in React's order (as React's next change of children puts them).
    AsyncFunction("raiseView") { (tag: Int, levels: Int, raised: Bool) in
      guard var view = self.appContext?.findView(withTag: tag, ofType: NSView.self) else { return }
      for _ in 0...max(0, levels) {
        guard let parent = view.superview else { return }
        // AppKit reorders an existing subview for hit testing but leaves its layer where it was: both move.
        let layers = view.layer.flatMap { layer in parent.layer.flatMap { $0 === layer.superlayer ? (layer, $0) : nil } }
        if raised {
          if parent.subviews.last !== view { parent.addSubview(view, positioned: .above, relativeTo: nil) }
          if let (layer, host) = layers, host.sublayers?.last !== layer { host.addSublayer(layer) }
        } else if let order = parent.value(forKey: "reactSubviews") as? [NSView], let index = order.firstIndex(where: { $0 === view }) {
          // Below the next of its React siblings that's on screen (React may have reordered them meanwhile); only this
          // view moves (asking the parent to re-add all its subviews dropped the clipped ones of a scroll view).
          if let next = order[(index + 1)...].first(where: { $0.superview === parent }) {
            parent.addSubview(view, positioned: .below, relativeTo: next)
            if let (layer, host) = layers, let below = next.layer, below.superlayer === host { host.insertSublayer(layer, below: below) }
          } else if parent.subviews.last !== view {
            parent.addSubview(view, positioned: .above, relativeTo: nil)
            if let (layer, host) = layers { host.addSublayer(layer) }
          }
        }
        view = parent
      }
    }.runOnQueue(.main)
    AsyncFunction("dragPreviewPlaceholder") { (title: String, favicon: String?) in
      DragPreview.shared.setPlaceholder(title: title, favicon: favicon)
    }.runOnQueue(.main)
    // The window's frame now, on screen in AppKit's coordinates (the store's stays the restored one in full screen).
    AsyncFunction("windowFrame") { (id: String) -> [Double]? in
      guard let f = WindowManager.shared.windows[id]?.frame else { return nil }
      return [f.minX, f.minY, f.width, f.height]
    }.runOnQueue(.main)
    AsyncFunction("devDragPreviewState") { () -> [String: Any] in
      #if DEBUG
      return DragPreview.shared.debugState
      #else
      return [:]
      #endif
    }.runOnQueue(.main)
    AsyncFunction("devDragPreviewWrite") { (dir: String) -> Bool in
      #if DEBUG
      return DragPreview.shared.debugWrite(dir: dir)
      #else
      return false
      #endif
    }.runOnQueue(.main)
    AsyncFunction("dragPreviewEnd") { (windowId: String?, frame: [Double]?) in
      DragPreview.shared.end(windowId: windowId, fallback: frame.flatMap { $0.count == 4 ? NSRect(x: $0[0], y: $0[1], width: $0[2], height: $0[3]) : nil })
    }.runOnQueue(.main)
    AsyncFunction("setWindowTitle") { (id: String, title: String) in
      WindowManager.shared.setTitle(id: id, title: title)
    }.runOnQueue(.main)
    AsyncFunction("windowIds") { () -> [String] in Array(WindowManager.shared.windows.keys) }.runOnQueue(.main)
    AsyncFunction("keyWindowId") { () -> String? in WindowManager.shared.keyWindowId }.runOnQueue(.main)

    // MARK: App

    AsyncFunction("setAppearance") { (mode: String) in
      NSApp.appearance = mode == "light" ? NSAppearance(named: .aqua) : mode == "dark" ? NSAppearance(named: .darkAqua) : nil
    }.runOnQueue(.main)

    AsyncFunction("isDarkAppearance") { () -> Bool in ShellModule.isDark }.runOnQueue(.main)

    AsyncFunction("setMenuState") { (state: [String: Any]) in
      MenuState.current = MenuState(state)
      MainMenu.refresh()
    }.runOnQueue(.main)
    // The bookmark lists, sent only when they change (the menu state then leaves them out).
    AsyncFunction("setMenuBookmarks") { (bookmarks: [String: Any]) in
      MenuState.setBookmarks(bookmarks)
      MainMenu.refresh()
    }.runOnQueue(.main)

    AsyncFunction("replyToTerminate") { (ok: Bool) in WindowManager.shared.replyToTerminate(ok) }.runOnQueue(.main)

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

    Function("startDictation") {
      DispatchQueue.main.async { NSApp.sendAction(Selector(("startDictation:")), to: nil, from: nil) }
    }

    AsyncFunction("pickFiles") { (promise: Promise) in
      let panel = NSOpenPanel()
      panel.allowsMultipleSelection = true
      panel.canChooseDirectories = false
      panel.begin { response in
        promise.resolve(response == .OK ? panel.urls.map(\.absoluteString) : [])
      }
    }.runOnQueue(.main)

    Function("readDocument") { (name: String) -> String? in DocumentStore.read(name) }

    Function("writeDocument") { (name: String, contents: String) in try DocumentStore.write(name, contents) }

    Function("removeDocument") { (name: String) in try DocumentStore.remove(name) }

    // The same save, resolved once it's on disk (or a newer save of the document is), rejected if it can't be
    // written: for writes that must land before something else happens (sync's journal).
    AsyncFunction("saveDocument") { (name: String, contents: String, promise: Promise) in
      try DocumentStore.write(name, contents) { error in
        if let error { promise.reject("ERR_SAVE_DOCUMENT", error.localizedDescription) } else { promise.resolve(nil) }
      }
    }

    AsyncFunction("setSwitcherCapture") { [weak self] (active: Bool) in
      guard let self else { return }
      if let monitor = self.switcherMonitor { NSEvent.removeMonitor(monitor) }
      self.switcherMonitor = nil
      guard active else { return }
      let emit: ([String: Any]) -> Void = { [weak self] body in self?.sendEvent("onAppEvent", body) }
      self.switcherMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .leftMouseUp, .rightMouseUp, .otherMouseUp]) { event in
        guard event.type == .keyDown else {
          emit(["type": "switcherMouseUp"])
          return event
        }
        switch event.keyCode {
        case 53: emit(["type": "switcherKey", "key": "escape"])
        case 124: emit(["type": "switcherKey", "key": "next"])
        case 123: emit(["type": "switcherKey", "key": "previous"])
        case 48 where event.modifierFlags.contains(.control): return event
        default: break
        }
        return nil
      }
    }.runOnQueue(.main)

    Function("copyText") { (text: String) in
      DispatchQueue.main.async {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
      }
    }

    AsyncFunction("showMenu") { (items: [[String: Any]], promise: Promise) in
      let target = MenuChoice()
      let menu = ShellModule.contextMenu(items, target: target)
      menu.popUp(positioning: nil, at: NSEvent.mouseLocation, in: nil)
      DispatchQueue.main.async { promise.resolve(target.chosen) }
    }.runOnQueue(.main)

    View(WindowDragRegion.self) {}
  }

  private func observeForSidebar() {
    let emit: (String) -> Void = { [weak self] type in self?.sendEvent("onAppEvent", ["type": type]) }
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
      } else if item["share"] as? Bool == true {
        // The system's sharing services, chosen as "<id>:via:<service>".
        let id = item["id"] as? String ?? ""
        let submenu = NSMenu()
        submenu.autoenablesItems = false
        SharePicker.menuItems(target: target, action: #selector(MenuChoice.choose(_:)), choice: { "\(id):via:\($0)" })
          .forEach(submenu.addItem)
        entry.submenu = submenu
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

public enum ShellApp {
  public static func shouldTerminate() -> NSApplication.TerminateReply { WindowManager.shared.shouldTerminate() }
  public static func reopen(hasVisibleWindows: Bool) -> Bool {
    if !hasVisibleWindows { WindowManager.shared.reopen() }
    return true
  }
  public static func dockMenu() -> NSMenu { MainMenu.dockMenu() }
}

public class FadeLabelModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArcadiaFadeLabel")

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
    field.font = .monospacedDigitSystemFont(ofSize: fontSize, weight: weights[weight] ?? .regular)
    field.stringValue = text
    field.textColor = color
    relayout()
  }

  private func relayout() {
    let fitting = field.fittingSize
    field.frame = NSRect(x: 0, y: (bounds.height - fitting.height) / 2, width: max(bounds.width, fitting.width), height: fitting.height)
    // RCTView resets its backing-layer mask; keep the mask on the text field layer.
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

public class ActivitySpinnerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArcadiaActivitySpinner")

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

  private func spin() {
    guard window != nil, ring.animation(forKey: "activityRotation") == nil else { return }
    let turn = CABasicAnimation(keyPath: "transform.rotation.z")
    turn.fromValue = 0
    turn.toValue = isFlipped ? 2 * Double.pi : -2 * Double.pi
    turn.duration = 1.88
    turn.repeatCount = .infinity
    turn.timingFunction = CAMediaTimingFunction(name: .linear)
    turn.isRemovedOnCompletion = false
    ring.add(turn, forKey: "activityRotation")
  }
}

public class SymbolModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArcadiaSymbol")

    View(SymbolView.self) {
      Prop("name") { (view: SymbolView, name: String) in view.name = name }
      Prop("size") { (view: SymbolView, size: Double) in view.pointSize = size }
      Prop("weight") { (view: SymbolView, weight: String) in view.weight = weight }
      Prop("color") { (view: SymbolView, hex: String) in view.tint = NSColor(hex: hex) }
    }
  }
}

// A window's title bar, as far as the mouse goes: a press on it moves the window, a double-click does what System
// Settings › Desktop & Dock › "Double-click a window's title bar to" says (Fill, Zoom, Minimize or nothing).
//
// AppKit only does this by itself in the window's real title bar band (the top 32 pt) and never for a double-click
// (Chrome's content view counts as opaque there), and only when the press lands on the region itself. Over the tab
// strip it lands on the tabs' scroll view, which covers the whole strip: pressing the empty strip right of "+" moved
// the window only in its top 32 pt and a double-click did nothing (the owner's 0.2.25 report). So the region watches
// the window's presses itself: one inside it whose view is the region or the empty part of a scroll view laid over it
// (no tab, button or field: those are hit instead) is the title bar's.
final class WindowDragRegion: ExpoView {
  private var monitor: Any?
  // The second press of a double-click it claimed: the action runs on its release, as on a title bar.
  private var doubleClickDown = false

  override var mouseDownCanMoveWindow: Bool {
    get { true }
    set {}
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if let monitor { NSEvent.removeMonitor(monitor) }
    monitor = nil
    doubleClickDown = false
    guard window != nil else { return }
    monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .leftMouseUp]) { [weak self] event in
      guard let self else { return event }
      if event.type == .leftMouseUp {
        guard self.doubleClickDown, event.window === self.window else { return event }
        self.doubleClickDown = false
        if event.clickCount == 2, let window = self.window { Self.doubleClick(window, event.modifierFlags) }
        return nil
      }
      self.doubleClickDown = false  // its release went elsewhere
      guard self.ownsPress(event) else { return event }
      self.press(event, releaseFollows: true)
      return nil
    }
  }

  deinit {
    if let monitor { NSEvent.removeMonitor(monitor) }
  }

  // A press sent to the view itself, not through the app's event queue.
  override func mouseDown(with event: NSEvent) {
    if ownsPress(event) { press(event, releaseFollows: false) } else { super.mouseDown(with: event) }
  }

  private func ownsPress(_ event: NSEvent) -> Bool {
    guard let window, event.window === window, !isHiddenOrHasHiddenAncestor, alphaValue > 0,
          !event.modifierFlags.contains(.control),  // a right-click
          bounds.contains(convert(event.locationInWindow, from: nil)),
          let hit = window.contentView?.superview?.hitTest(event.locationInWindow)
    else { return false }
    if hit === self { return true }
    // A scroll view's own background: its clip view, or its document view where no item is.
    let background = hit is NSClipView || (hit.superview as? NSClipView)?.documentView === hit
    guard background, let container = superview, hit.isDescendant(of: container) else { return false }
    // Inside something that keeps its presses (`mouseDownCanMoveWindow={false}`).
    var view = hit.superview
    while let v = view, v !== container {
      if !(v is NSClipView || v is NSScrollView), !v.mouseDownCanMoveWindow { return false }
      view = v.superview
    }
    return true
  }

  private func press(_ event: NSEvent, releaseFollows: Bool) {
    guard let window else { return }
    // The press never reaches AppKit's own handling, which makes a clicked window key; ⌘-drag moves a window
    // without bringing it forward, and a dialog of the window's (a child window) keeps the keyboard.
    var key = NSApp.keyWindow
    while let k = key, k !== window { key = k.parent }
    if key == nil, window.canBecomeKey, !event.modifierFlags.contains(.command) { window.makeKeyAndOrderFront(nil) }
    if event.clickCount == 2 {
      if releaseFollows { doubleClickDown = true } else { Self.doubleClick(window, event.modifierFlags) }
      return
    }
    window.performDrag(with: event)
  }

  // AppKit's own title-bar double-click (-[NSTitledFrame _handlePossibleDoubleClickWithModifiers:], which acts on the
  // setting as the system's title bars do, ⌥ included); else the setting read by hand.
  static func doubleClick(_ window: NSWindow, _ modifiers: NSEvent.ModifierFlags) {
    let sel = NSSelectorFromString("_handlePossibleDoubleClickWithModifiers:")
    if let frame = window.contentView?.superview, let method = class_getInstanceMethod(type(of: frame), sel),
       method_getNumberOfArguments(method) == 3, Self.returnsVoid(method) {
      typealias Handle = @convention(c) (AnyObject, Selector, UInt) -> Void
      unsafeBitCast(method_getImplementation(method), to: Handle.self)(frame, sel, modifiers.rawValue)
      return
    }
    let global = UserDefaults.standard.persistentDomain(forName: UserDefaults.globalDomain) ?? [:]
    let fill = NSSelectorFromString("_zoomFill:")
    switch global["AppleActionOnDoubleClick"] as? String {
    case "Minimize": window.performMiniaturize(nil)
    case "None": break
    case "Fill" where window.responds(to: fill): window.perform(fill, with: nil)
    case nil where (global["AppleMiniaturizeOnDoubleClick"] as? Bool) == true: window.performMiniaturize(nil)
    default: window.performZoom(nil)
    }
  }

  private static func returnsVoid(_ method: Method) -> Bool {
    let type = method_copyReturnType(method)
    defer { free(type) }
    return String(cString: type) == "v"
  }
}

public class OutsidePressAreaModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArcadiaOutsidePressArea")

    View(OutsidePressArea.self) {
      Events("onOutsidePress")
    }
  }
}

// A popover's area (the command bar): a press anywhere else in its window, on the page, the sidebar or its rows, the
// tab strip, is `onOutsidePress`, as a click outside Dia's or Safari's address bar closes it. Its field's blur alone
// can't tell: that comes only when the press moves AppKit's first responder, and the sidebar, its rows and the drag
// regions never take it, so a click on the empty sidebar left the bar open (the owner's 0.2.27 report). The press
// goes on to whatever it landed on.
final class OutsidePressArea: ExpoView {
  let onOutsidePress = EventDispatcher()
  fileprivate static let areas = NSHashTable<OutsidePressArea>.weakObjects()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    _ = installOutsidePressMonitor
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window != nil { Self.areas.add(self) } else { Self.areas.remove(self) }
  }

  fileprivate func pressed(_ event: NSEvent) {
    guard let window, event.window === window, !isHiddenOrHasHiddenAncestor else { return }
    if let hit = window.contentView?.superview?.hitTest(event.locationInWindow), hit.isDescendant(of: self) { return }
    onOutsidePress([:])
  }
}

// Installed by ShellModule's OnCreate, before any WindowDragRegion's: local monitors run in the order they were added,
// and a drag region keeps the presses on the empty sidebar and tab strip from the ones after it.
let installOutsidePressMonitor: Void = {
  _ = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]) { event in
    for area in OutsidePressArea.areas.allObjects { area.pressed(event) }
    return event
  }
}()

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

let installTextFieldSelectAll: Void = {
  let block: @convention(block) (NSTextField, Any?) -> Void = { field, sender in field.selectText(sender) }
  class_addMethod(NSTextField.self, #selector(NSText.selectAll(_:)), imp_implementationWithBlock(block), "v@:@")
}()

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
  // Patch only RCTCustomScrollView, not inherited NSScrollView implementations.
  if !class_addMethod(cls, #selector(NSView.init(frame:)), imp, method_getTypeEncoding(method)) {
    method_setImplementation(method, imp)
  }
}()

public class ContextMenuAreaModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArcadiaContextMenuArea")

    View(ContextMenuArea.self) {
      Events("onContextMenu")
      Prop("captureDescendants") { (view: ContextMenuArea, on: Bool) in view.captureDescendants = on }
    }
  }
}

final class ContextMenuArea: ExpoView {
  let onContextMenu = EventDispatcher()
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

public class VisualEffectModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArcadiaVisualEffect")

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

  // RN macOS sets subview frames directly; size them in setFrameSize.
  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    effect.frame = bounds
    applyCorners()
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

public class GlassEffectModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArcadiaGlassEffect")

    Function("isLiquidGlass") { () -> Bool in
      if #available(macOS 26.0, *) { return true }
      return false
    }

    View(GlassEffect.self) {
      Prop("cornerRadius") { (view: GlassEffect, v: Double) in view.cornerRadius = v }
      Prop("tint") { (view: GlassEffect, hex: String?) in view.tint = hex.flatMap(NSColor.init(hex:)) }
      Prop("glassStyle") { (view: GlassEffect, style: String?) in view.clear = style == "clear" }
      Prop("dark") { (view: GlassEffect, dark: Bool?) in view.appearance = dark.map { NSAppearance(named: $0 ? .darkAqua : .aqua) } ?? nil }
    }
  }
}

final class GlassEffect: ExpoView {
  private let effect: NSView
  private let tintLayer = CALayer()
  var cornerRadius: Double = 0 { didSet { apply() } }
  var tint: NSColor? { didSet { apply() } }
  var clear = false { didSet { apply() } }

  required init(appContext: AppContext? = nil) {
    if #available(macOS 26.0, *) {
      effect = NSGlassEffectView()
    } else {
      let material = NSVisualEffectView()
      material.material = .sidebar
      material.blendingMode = .behindWindow
      material.state = .followsWindowActiveState
      material.wantsLayer = true
      tintLayer.actions = ["backgroundColor": NSNull(), "bounds": NSNull(), "position": NSNull()]
      material.layer?.addSublayer(tintLayer)
      effect = material
    }
    super.init(appContext: appContext)
    addSubview(effect)
    apply()
  }

  private func apply() {
    if #available(macOS 26.0, *), let glass = effect as? NSGlassEffectView {
      glass.cornerRadius = cornerRadius
      glass.tintColor = tint
      glass.style = clear ? .clear : .regular
      return
    }
    effect.layer?.cornerRadius = cornerRadius
    effect.layer?.cornerCurve = .continuous
    effect.layer?.masksToBounds = cornerRadius > 0
    tintLayer.frame = effect.bounds
    tintLayer.backgroundColor = tint?.cgColor
  }

  // RN macOS sets subview frames directly; size them in setFrameSize. The glass keeps its shape and tint through a
  // resize: setting them again re-rendered it (a SwiftUI pass) on every frame of a resize, as the sidebar's slide is
  // for the URL bar.
  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    effect.frame = bounds
    if tintLayer.superlayer != nil { tintLayer.frame = effect.bounds }
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

public class SurfaceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArcadiaSurface")

    View(Surface.self) {
      Prop("fill") { (view: Surface, hex: String?) in view.surfaceFill = hex.flatMap(NSColor.init(hex:)) }
      Prop("cornerRadius") { (view: Surface, v: Double) in view.surfaceRadius = v }
      Prop("borderColor") { (view: Surface, hex: String?) in view.surfaceBorderColor = hex.flatMap(NSColor.init(hex:)) }
      Prop("borderWidth") { (view: Surface, v: Double) in view.surfaceBorderWidth = v }
      Prop("borderColors") { (view: Surface, hexes: [String]?) in view.surfaceBorderColors = (hexes ?? []).compactMap(NSColor.init(hex:)) }
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
  var surfaceBorderColors: [NSColor] = [] { didSet { apply() } }
  var surfaceShadowColor: NSColor? { didSet { apply() } }
  var surfaceShadowOpacity: Double = 0 { didSet { apply() } }
  var surfaceShadowRadius: Double = 0 { didSet { apply() } }
  var surfaceShadowOffset: CGSize = .zero { didSet { apply() } }

  private let plate = CALayer()
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

    if surfaceBorderColors.count >= 2, surfaceBorderWidth > 0 {
      borderGradient.isHidden = false
      borderGradient.frame = bounds
      borderGradient.colors = surfaceBorderColors.map(\.cgColor)
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
