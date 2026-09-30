import AppKit

public enum WindowHost {
  public static var makeWindow: (() -> NSWindow)?
  public static var makeContentView: ((_ windowId: String) -> NSView)?
}

final class WindowManager: NSObject, NSWindowDelegate {
  static let shared = WindowManager()

  private(set) var windows: [String: NSWindow] = [:]
  var emit: ((String, [String: Any]) -> Void)?
  private var closingFromJS = Set<String>()
  private weak var lastPlaced: NSWindow?
  private var legacyFrame = UserDefaults.standard.string(forKey: "NSWindow Frame BrowserWindow")
  private(set) var auxKinds: [String: String] = [:]
  // Small Yahu windows (Arc's Little Arc): browser windows that open centred at their remembered size.
  private(set) var smallIds = Set<String>()

  private func isBrowserWindow(_ window: NSWindow?) -> Bool {
    guard let id = id(of: window) else { return false }
    return auxKinds[id] == nil
  }

  private func isMainWindow(_ window: NSWindow?) -> Bool {
    guard let id = id(of: window) else { return false }
    return auxKinds[id] == nil && !smallIds.contains(id)
  }

  func id(of window: NSWindow?) -> String? {
    guard let window else { return nil }
    return windows.first { $0.value === window }?.key
  }

  var keyWindowId: String? { id(of: NSApp.keyWindow) ?? id(of: NSApp.mainWindow) }

  func closeForeignKeyWindow() -> Bool {
    guard keyWindowId == nil, let key = NSApp.keyWindow, !(key is NSPanel), key.styleMask.contains(.closable)
    else { return false }
    key.performClose(nil)
    return true
  }

  var keyBrowserWindow: NSWindow? { keyWindowId.flatMap { windows[$0] } }

  var closableWindow: NSWindow? {
    [NSApp.keyWindow, NSApp.mainWindow].compactMap { $0 }.first { $0.styleMask.contains(.closable) }
  }

  func toggleKeepOnTop() {
    guard let window = keyBrowserWindow else { return }
    window.level = window.level == .floating ? .normal : .floating
  }

  func open(
    id: String, frame: [Double]?, incognito: Bool, title: String, focus: Bool, kind: String = "browser", profile: String? = nil,
    size: [Double]? = nil
  ) {
    if let existing = windows[id] {
      if focus { existing.makeKeyAndOrderFront(nil) }
      return
    }
    let small = kind == "small"
    if kind != "browser" && !small { return openAux(id: id, kind: kind, title: title) }
    guard let makeWindow = WindowHost.makeWindow, let makeContentView = WindowHost.makeContentView else { return }
    if small { smallIds.insert(id) }
    if let chromeWindow = ChromeWindows.makeWindow(profile: profile) {
      if incognito { chromeWindow.appearance = NSAppearance(named: .darkAqua) }
      ChromeWindows.embed(makeContentView(id), in: chromeWindow)
      ChromeWindows.onSwap { [weak self] from, to in self?.adopt(from: from, to: to) }
      observeDelegateNotifications(chromeWindow)
      if small { configureSmall(chromeWindow) }
      return show(chromeWindow, id: id, frame: frame, title: title, focus: focus, smallSize: small ? size ?? [] : nil)
    }
    let window = makeWindow()
    let controller = NSViewController()
    controller.view = makeContentView(id)
    controller.view.frame = NSRect(origin: .zero, size: window.contentRect(forFrameRect: window.frame).size)
    window.contentViewController = controller
    window.delegate = self
    if incognito { window.appearance = NSAppearance(named: .darkAqua) }
    if small { configureSmall(window) }
    show(window, id: id, frame: frame, title: title, focus: focus, smallSize: small ? size ?? [] : nil)
  }

  private func show(_ window: NSWindow, id: String, frame: [Double]?, title: String, focus: Bool, smallSize: [Double]? = nil) {
    window.title = title
    if let smallSize { placeSmall(window, size: smallSize) } else { place(window, frame: frame) }
    relayoutRoot(window)
    windows[id] = window
    if let center = lightsCenters[id] { ChromeWindows.setTrafficLightsCenter(center, in: window) }
    if smallSize == nil { lastPlaced = window }
    if focus { window.makeKeyAndOrderFront(nil) } else { window.orderFront(nil) }
    observeFrame(window)
    reportFrame(window)
  }

  private func observeFrame(_ window: NSWindow) {
    for name in [NSWindow.didMoveNotification, NSWindow.didEndLiveResizeNotification] {
      NotificationCenter.default.addObserver(self, selector: #selector(frameChanged(_:)), name: name, object: window)
    }
    NotificationCenter.default.addObserver(self, selector: #selector(sizeChanged(_:)), name: NSWindow.didResizeNotification, object: window)
  }

  private func observeDelegateNotifications(_ window: NSWindow) {
    for (name, selector) in [
      (NSWindow.didBecomeKeyNotification, #selector(windowDidBecomeKey(_:))),
      (NSWindow.didChangeOcclusionStateNotification, #selector(windowDidChangeOcclusionState(_:))),
      (NSWindow.willCloseNotification, #selector(windowWillClose(_:))),
      (NSWindow.willEnterFullScreenNotification, #selector(fullScreenTransitionBegan(_:))),
      (NSWindow.willExitFullScreenNotification, #selector(fullScreenTransitionBegan(_:))),
      (NSWindow.didEnterFullScreenNotification, #selector(fullScreenTransitionEnded(_:))),
      (NSWindow.didExitFullScreenNotification, #selector(fullScreenTransitionEnded(_:))),
    ] {
      NotificationCenter.default.addObserver(self, selector: selector, name: name, object: window)
    }
  }

  func setProfile(id: String, profile: String, neighbours: [String]) {
    guard let window = windows[id] else { return }
    ChromeWindows.showProfile(profile, in: window)
    if let current = windows[id] { ChromeWindows.prepare(neighbours, for: current) }
  }

  // Kept per id: JS can ask before the window is registered.
  private var lightsCenters: [String: NSPoint] = [:]

  func setTrafficLightsCenter(id: String, center: NSPoint?) {
    lightsCenters[id] = center
    guard let window = windows[id] else { return }
    ChromeWindows.setTrafficLightsCenter(center, in: window)
  }

  private func adopt(from: NSWindow, to: NSWindow) {
    guard let id = id(of: from) else { return }
    NotificationCenter.default.removeObserver(self, name: nil, object: from)
    windows[id] = to
    if lastPlaced === from { lastPlaced = to }
    observeDelegateNotifications(to)
    observeFrame(to)
    reportFrame(to)
  }

  private func openAux(id: String, kind: String, title: String) {
    guard let makeContentView = WindowHost.makeContentView else { return }
    let settings = kind == "settings"
    let taskManager = kind == "taskManager"
    let size = settings ? NSSize(width: 820, height: 640) : taskManager ? NSSize(width: 720, height: 460) : NSSize(width: 640, height: 600)
    var style: NSWindow.StyleMask = [.titled, .closable, .miniaturizable, .fullSizeContentView]
    if settings || taskManager { style.insert(.resizable) }
    let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: style, backing: .buffered, defer: false)
    window.titlebarAppearsTransparent = true
    window.titleVisibility = .hidden
    window.title = title
    window.isReleasedWhenClosed = false
    window.minSize = settings ? NSSize(width: 720, height: 480) : taskManager ? NSSize(width: 540, height: 280) : size
    window.tabbingMode = .disallowed
    let controller = NSViewController()
    controller.view = makeContentView(id)
    controller.view.frame = NSRect(origin: .zero, size: size)
    window.contentViewController = controller
    window.setContentSize(size)
    window.delegate = self
    auxKinds[id] = kind
    windows[id] = window
    if !window.setFrameUsingName("Netnyahoo\(kind.capitalized)") { window.center() }
    window.setFrameAutosaveName("Netnyahoo\(kind.capitalized)")
    window.makeKeyAndOrderFront(nil)
  }

  private func configureSmall(_ window: NSWindow) {
    window.minSize = NSSize(width: 420, height: 300)
    window.tabbingMode = .disallowed
    // Opens on the Space you're on, like Little Arc, rather than pulling you to the app's last Space.
    window.collectionBehavior.insert(.moveToActiveSpace)
  }

  // Little Arc's placement: the remembered size, centred on the screen you're working on, a little above centre.
  private func placeSmall(_ window: NSWindow, size: [Double]) {
    let mouse = NSEvent.mouseLocation
    let screen = (NSApp.isActive ? NSApp.keyWindow?.screen : nil)
      ?? NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main
    guard let visible = screen?.visibleFrame else { return window.center() }
    let width = min(max(size.count == 2 ? size[0] : 900, window.minSize.width), visible.width)
    let height = min(max(size.count == 2 ? size[1] : 640, window.minSize.height), visible.height)
    let lift = min(visible.height * 0.05, (visible.height - height) / 2)
    let origin = NSPoint(x: (visible.midX - width / 2).rounded(), y: (visible.midY - height / 2 + lift).rounded())
    window.setFrame(NSRect(origin: origin, size: NSSize(width: width.rounded(), height: height.rounded())), display: false)
  }

  private func place(_ window: NSWindow, frame: [Double]?) {
    if let frame, frame.count == 4 {
      window.setFrame(NSRect(x: frame[0], y: frame[1], width: frame[2], height: frame[3]), display: false)
      if let screen = window.screen ?? NSScreen.main {
        window.setFrame(window.constrainFrameRect(window.frame, to: screen), display: false)
      }
    } else if let source = [NSApp.keyWindow, NSApp.mainWindow, lastPlaced].compactMap({ $0 }).first(where: { isMainWindow($0) })
                ?? windows.values.first(where: { $0.isVisible && isMainWindow($0) }) {
      window.setFrame(NSRect(origin: .zero, size: source.frame.size), display: false)
      let topLeft = NSPoint(x: source.frame.minX, y: source.frame.maxY)
      window.setFrameTopLeftPoint(window.cascadeTopLeft(from: topLeft))
    } else if let legacy = legacyFrame, windows.isEmpty {
      window.setFrame(from: legacy)
      legacyFrame = nil
    } else {
      window.center()
    }
  }

  func close(id: String) {
    guard let window = windows[id] else { return }
    if ChromeWindows.root(of: window) != nil {
      // Keep Chrome Browser alive until tabs finish moving out.
      NotificationCenter.default.removeObserver(self, name: nil, object: window)
      windows[id] = nil
      lightsCenters[id] = nil
      auxKinds[id] = nil
      smallIds.remove(id)
      ChromeWindows.close(window)
      DispatchQueue.main.async { ChromeWindows.removeRoot(of: window) }
      return
    }
    closingFromJS.insert(id)
    window.close()
  }

  func focus(id: String) {
    windows[id]?.makeKeyAndOrderFront(nil)
  }

  func setTitle(id: String, title: String) {
    guard let window = windows[id], window.title != title else { return }
    window.title = title
  }

  // MARK: NSWindowDelegate

  func windowShouldClose(_ sender: NSWindow) -> Bool {
    guard let id = id(of: sender), auxKinds[id] == nil, !smallIds.contains(id), MenuState.current.warnBeforeClosingWindow,
          appEventsObserved, let emit else { return true }
    emit("onWindowEvent", ["type": "closeRequest", "id": id])
    return false
  }

  func windowDidBecomeKey(_ notification: Notification) {
    guard let window = notification.object as? NSWindow, let id = id(of: window) else { return }
    if isMainWindow(window) { lastPlaced = window }
    emit?("onWindowEvent", ["type": "focus", "id": id])
  }

  func windowDidChangeOcclusionState(_ notification: Notification) {
    guard let window = notification.object as? NSWindow, inFullScreenTransition[ObjectIdentifier(window)] == nil else { return }
    reportOcclusion(window)
  }

  private func reportOcclusion(_ window: NSWindow) {
    guard let id = id(of: window), auxKinds[id] == nil else { return }
    emit?("onWindowEvent", ["type": "occlusion", "id": id, "visible": window.occlusionState.contains(.visible)])
  }

  // A full-screen transition moves the window between Spaces and briefly occludes it. Reporting that would
  // start auto Picture in Picture, which takes a page's video out of its element full screen.
  private var inFullScreenTransition: [ObjectIdentifier: Int] = [:]
  private var fullScreenTransitionCount = 0

  @objc private func fullScreenTransitionBegan(_ notification: Notification) {
    guard let window = notification.object as? NSWindow else { return }
    let key = ObjectIdentifier(window)
    fullScreenTransitionCount += 1
    let transition = fullScreenTransitionCount
    inFullScreenTransition[key] = transition
    // AppKit sends no notification when a transition fails.
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self, weak window] in
      guard let self, let window, self.inFullScreenTransition[key] == transition else { return }
      self.inFullScreenTransition[key] = nil
      self.reportOcclusion(window)
    }
  }

  @objc private func fullScreenTransitionEnded(_ notification: Notification) {
    guard let window = notification.object as? NSWindow,
          inFullScreenTransition.removeValue(forKey: ObjectIdentifier(window)) != nil else { return }
    reportOcclusion(window)
  }

  func windowWillClose(_ notification: Notification) {
    guard let window = notification.object as? NSWindow, let id = id(of: window) else { return }
    NotificationCenter.default.removeObserver(self, name: nil, object: window)
    windows[id] = nil
    lightsCenters[id] = nil
    auxKinds[id] = nil
    smallIds.remove(id)
    if closingFromJS.remove(id) == nil {
      emit?("onWindowEvent", ["type": "close", "id": id])
    }
    DispatchQueue.main.async {
      if ChromeWindows.root(of: window) != nil { return ChromeWindows.removeRoot(of: window) }
      window.contentViewController = nil
    }
  }

  @objc private func sizeChanged(_ notification: Notification) {
    guard let window = notification.object as? NSWindow, !window.inLiveResize else { return }
    relayoutRoot(window)
  }

  /// Lay out RCTRootView immediately after programmatic frame changes; occluded windows may not get a display pass.
  private func relayoutRoot(_ window: NSWindow) {
    guard let root = ChromeWindows.root(of: window) ?? window.contentView else { return }
    root.needsLayout = true
    for view in root.subviews { view.needsLayout = true }
    root.layoutSubtreeIfNeeded()
  }

  @objc private func frameChanged(_ notification: Notification) {
    guard let window = notification.object as? NSWindow, !window.inLiveResize else { return }
    reportFrame(window)
  }

  private func reportFrame(_ window: NSWindow) {
    guard let id = id(of: window), !window.styleMask.contains(.fullScreen), window.parent == nil else { return }
    let f = window.frame
    emit?("onWindowEvent", ["type": "frame", "id": id, "frame": [f.minX, f.minY, f.width, f.height]])
  }

  // MARK: App lifecycle

  var appEventsObserved = false
  private var terminateTimer: Timer?
  private var awaitingTerminateReply = false
  private var quitRequested = false
  private var sessionSaved = false

  func confirmQuit() {
    if MenuState.current.warnBeforeQuitting {
      let alert = NSAlert()
      alert.messageText = "Are you sure you want to quit \(ProcessInfo.processInfo.processName)?"
      alert.informativeText = "Your windows and tabs will be restored the next time you open it."
      alert.addButton(withTitle: "Quit")
      alert.addButton(withTitle: "Cancel")
      alert.showsSuppressionButton = true
      alert.suppressionButton?.title = "Don't ask again"
      let response = alert.runModal()
      if alert.suppressionButton?.state == .on { emit?("onAppEvent", ["type": "quitWarningSuppressed"]) }
      guard response == .alertFirstButtonReturn else { return }
    }
    guard confirmActiveDownloads() else { return }
    guard appEventsObserved, emit != nil else { return NSApp.terminate(nil) }
    quitRequested = true
    emit?("onAppEvent", ["type": "willQuit"])
    startTerminateTimer()
  }

  func shouldTerminate() -> NSApplication.TerminateReply {
    if sessionSaved || !appEventsObserved || emit == nil { return .terminateNow }
    if !quitRequested, !confirmActiveDownloads() { return .terminateCancel }
    awaitingTerminateReply = true
    emit?("onAppEvent", ["type": "willQuit"])
    startTerminateTimer()
    return .terminateLater
  }

  private var downloadsConfirmed = false
  private func confirmActiveDownloads() -> Bool {
    let count = MenuState.current.downloadsInProgress
    guard count > 0, !downloadsConfirmed else { return true }
    let alert = NSAlert()
    alert.messageText = "Are you sure you want to quit \(ProcessInfo.processInfo.processName)?"
    alert.informativeText = count == 1
      ? "You have 1 download in progress. If you quit now, this download will be cancelled."
      : "You have \(count) downloads in progress. If you quit now, these downloads will be cancelled."
    alert.addButton(withTitle: "Quit")
    alert.addButton(withTitle: "Cancel")
    downloadsConfirmed = alert.runModal() == .alertFirstButtonReturn
    return downloadsConfirmed
  }

  func replyToTerminate(_ ok: Bool) {
    terminateTimer?.invalidate()
    terminateTimer = nil
    if quitRequested {
      quitRequested = false
      sessionSaved = ok
      if ok { NSApp.terminate(nil) }
    } else if awaitingTerminateReply {
      awaitingTerminateReply = false
      NSApp.reply(toApplicationShouldTerminate: ok)
    }
  }

  private func startTerminateTimer() {
    let timer = Timer(timeInterval: 1.5, repeats: false) { [weak self] _ in self?.replyToTerminate(true) }
    RunLoop.main.add(timer, forMode: .common)
    terminateTimer = timer
  }

  func reopen() {
    emit?("onAppEvent", ["type": "reopen"])
  }
}

