import AppKit

/// What the app target provides: its NSWindow subclass and a React root view
/// for a window id (same bridge, `initialProperties: { windowId }`). The shell
/// owns everything else about windows (registry, frames, events).
public enum WindowHost {
  public static var makeWindow: (() -> NSWindow)?
  public static var makeContentView: ((_ windowId: String) -> NSView)?
}

/// Every browser window, keyed by the id JS gave it. JS's store is the source of
/// truth: it asks for windows to open/close, and hears about user-driven closes,
/// focus and frame changes through `emit`.
final class WindowManager: NSObject, NSWindowDelegate {
  static let shared = WindowManager()

  private(set) var windows: [String: NSWindow] = [:]
  /// (event name, body); set by ShellModule once JS can receive events.
  var emit: ((String, [String: Any]) -> Void)?
  /// Windows JS closed itself: their close isn't reported back.
  private var closingFromJS = Set<String>()
  /// The last window opened or focused: new windows cascade from it.
  private weak var lastPlaced: NSWindow?
  /// Frame the pre-multi-window build autosaved; used once for the first window.
  private var legacyFrame = UserDefaults.standard.string(forKey: "NSWindow Frame BrowserWindow")
  /// Utility windows (Settings, Import) by id → kind. They host a React root too, but
  /// aren't browser windows: new windows don't cascade from them.
  private(set) var auxKinds: [String: String] = [:]

  private func isBrowserWindow(_ window: NSWindow?) -> Bool {
    guard let id = id(of: window) else { return false }
    return auxKinds[id] == nil
  }

  var hasHost: Bool { WindowHost.makeWindow != nil && WindowHost.makeContentView != nil }

  func id(of window: NSWindow?) -> String? {
    guard let window else { return nil }
    return windows.first { $0.value === window }?.key
  }

  /// The window menu commands apply to.
  var keyWindowId: String? { id(of: NSApp.keyWindow) ?? id(of: NSApp.mainWindow) }

  /// ⌘W while a page's own window is key (a `window.open` popup, DevTools): closes that window.
  /// Commands from windows that aren't ours go to the last browser window, so ⌘W in a sign-in
  /// popup closed the tab behind it instead.
  func closeForeignKeyWindow() -> Bool {
    guard keyWindowId == nil, let key = NSApp.keyWindow, !(key is NSPanel), key.styleMask.contains(.closable)
    else { return false }
    key.performClose(nil)
    return true
  }

  /// The browser window the Window menu acts on.
  var keyBrowserWindow: NSWindow? { keyWindowId.flatMap { windows[$0] } }

  /// File › Close Window: the window `performClose:` would reach (key window, else main window).
  var closableWindow: NSWindow? {
    [NSApp.keyWindow, NSApp.mainWindow].compactMap { $0 }.first { $0.styleMask.contains(.closable) }
  }

  /// Window › Keep Window on Top: floats this window above other apps' windows.
  func toggleKeepOnTop() {
    guard let window = keyBrowserWindow else { return }
    window.level = window.level == .floating ? .normal : .floating
  }

  /// `profile`: the engine profile the window shows first (only Chrome-hosted windows use it; they
  /// are that profile's Chrome window).
  func open(id: String, frame: [Double]?, incognito: Bool, title: String, focus: Bool, kind: String = "browser", profile: String? = nil) {
    if let existing = windows[id] {
      if focus { existing.makeKeyAndOrderFront(nil) }
      return
    }
    if kind != "browser" { return openAux(id: id, kind: kind, title: title) }
    guard let makeWindow = WindowHost.makeWindow, let makeContentView = WindowHost.makeContentView else { return }
    if let chromeWindow = ChromeWindowSpike.makeWindow(profile: profile) {
      if incognito { chromeWindow.appearance = NSAppearance(named: .darkAqua) }
      // Chrome owns this window and its delegate: our root goes over Chrome's views, and the
      // delegate calls below come as notifications.
      ChromeWindowSpike.embed(makeContentView(id), in: chromeWindow)
      ChromeWindowSpike.onSwap { [weak self] from, to in self?.adopt(from: from, to: to) }
      observeDelegateNotifications(chromeWindow)
      return show(chromeWindow, id: id, frame: frame, title: title, focus: focus)
    }
    let window = makeWindow()
    let controller = NSViewController()
    controller.view = makeContentView(id)
    // A zero-sized root view would shrink the window when it becomes the content.
    controller.view.frame = NSRect(origin: .zero, size: window.contentRect(forFrameRect: window.frame).size)
    window.contentViewController = controller
    window.delegate = self
    // Incognito windows are always dark, like Dia's; JS themes its own views to match.
    if incognito { window.appearance = NSAppearance(named: .darkAqua) }
    show(window, id: id, frame: frame, title: title, focus: focus)
  }

  private func show(_ window: NSWindow, id: String, frame: [Double]?, title: String, focus: Bool) {
    window.title = title
    place(window, frame: frame)
    relayoutRoot(window)
    windows[id] = window
    lastPlaced = window
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

  /// A Chrome-hosted window's delegate is Chrome's: the delegate calls come as notifications.
  private func observeDelegateNotifications(_ window: NSWindow) {
    for (name, selector) in [
      (NSWindow.didBecomeKeyNotification, #selector(windowDidBecomeKey(_:))),
      (NSWindow.didChangeOcclusionStateNotification, #selector(windowDidChangeOcclusionState(_:))),
      (NSWindow.willCloseNotification, #selector(windowWillClose(_:))),
    ] {
      NotificationCenter.default.addObserver(self, selector: selector, name: name, object: window)
    }
  }

  /// The window shows another profile (Chrome-hosted windows): that profile's Chrome window takes
  /// the app window over. `neighbours`: the profiles it can page to next, made ahead.
  func setProfile(id: String, profile: String, neighbours: [String]) {
    guard let window = windows[id] else { return }
    ChromeWindowSpike.showProfile(profile, in: window)
    // `adopt` has moved the registry to the profile's window if it swapped.
    if let current = windows[id] { ChromeWindowSpike.prepare(neighbours, for: current) }
  }

  /// A Chrome-hosted app window moved to another of its windows (another profile's).
  private func adopt(from: NSWindow, to: NSWindow) {
    guard let id = id(of: from) else { return }
    NotificationCenter.default.removeObserver(self, name: nil, object: from)
    windows[id] = to
    if lastPlaced === from { lastPlaced = to }
    observeDelegateNotifications(to)
    observeFrame(to)
    reportFrame(to)
  }

  /// Settings / Import: a plain titled window with a transparent titlebar, sized for
  /// its kind and remembered by AppKit's frame autosave.
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

  private func place(_ window: NSWindow, frame: [Double]?) {
    if let frame, frame.count == 4 {
      window.setFrame(NSRect(x: frame[0], y: frame[1], width: frame[2], height: frame[3]), display: false)
      // The screen it was on may be gone.
      if let screen = window.screen ?? NSScreen.main {
        window.setFrame(window.constrainFrameRect(window.frame, to: screen), display: false)
      }
    } else if let source = [NSApp.keyWindow, NSApp.mainWindow, lastPlaced].compactMap({ $0 }).first(where: { isBrowserWindow($0) })
                ?? windows.values.first(where: { $0.isVisible && isBrowserWindow($0) }) {
      // New windows cascade from the current one (or the last one opened), at its size.
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
    if ChromeWindowSpike.root(of: window) != nil {
      // A Chrome-hosted window's Browser must outlive a tab still moving out of it (dragged out
      // as the window's last): it hides now and closes a little later, so it's done with here.
      NotificationCenter.default.removeObserver(self, name: nil, object: window)
      windows[id] = nil
      auxKinds[id] = nil
      ChromeWindowSpike.close(window)
      DispatchQueue.main.async { ChromeWindowSpike.removeRoot(of: window) }
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

  /// ⇧⌘W and the close button (`performClose:`): with "Warn before closing a window" on, JS
  /// decides (it asks first when the window has several tabs) and closes the window itself.
  /// JS-initiated closes call `close()` and don't come through here.
  func windowShouldClose(_ sender: NSWindow) -> Bool {
    guard let id = id(of: sender), auxKinds[id] == nil, MenuState.current.warnBeforeClosingWindow,
          appEventsObserved, let emit else { return true }
    emit("onWindowEvent", ["type": "closeRequest", "id": id])
    return false
  }

  func windowDidBecomeKey(_ notification: Notification) {
    guard let window = notification.object as? NSWindow, let id = id(of: window) else { return }
    if auxKinds[id] == nil { lastPlaced = window }
    emit?("onWindowEvent", ["type": "focus", "id": id])
  }

  /// Minimised, fully covered or on another Space, and back: the page's video pops out
  /// into Picture in Picture while the window can't be seen (Dia's auto-PiP).
  func windowDidChangeOcclusionState(_ notification: Notification) {
    guard let window = notification.object as? NSWindow, let id = id(of: window), auxKinds[id] == nil else { return }
    emit?("onWindowEvent", ["type": "occlusion", "id": id, "visible": window.occlusionState.contains(.visible)])
  }

  func windowWillClose(_ notification: Notification) {
    guard let window = notification.object as? NSWindow, let id = id(of: window) else { return }
    NotificationCenter.default.removeObserver(self, name: nil, object: window)
    windows[id] = nil
    auxKinds[id] = nil
    if closingFromJS.remove(id) == nil {
      emit?("onWindowEvent", ["type": "close", "id": id])
    }
    // Releasing the root view unmounts its React tree; do it after AppKit is done closing.
    DispatchQueue.main.async {
      if ChromeWindowSpike.root(of: window) != nil { return ChromeWindowSpike.removeRoot(of: window) }
      window.contentViewController = nil
    }
  }

  /// Resized by code (session restore, zoom, AppleScript bounds…); live resizes relayout when they end.
  @objc private func sizeChanged(_ notification: Notification) {
    guard let window = notification.object as? NSWindow, !window.inLiveResize else { return }
    relayoutRoot(window)
  }

  /// RCTRootView only passes its size to React in -layout (and when a live resize ends). After a
  /// programmatic frame change AppKit lays views out on the next display pass, which an occluded
  /// window may not get: a window restored from the session at a new size kept the React layout
  /// of its old size until resized by hand. So lay out now.
  private func relayoutRoot(_ window: NSWindow) {
    guard let root = ChromeWindowSpike.root(of: window) ?? window.contentView else { return }
    root.needsLayout = true
    for view in root.subviews { view.needsLayout = true } // RCTRootContentView re-measures in its own -layout
    root.layoutSubtreeIfNeeded()
  }

  @objc private func frameChanged(_ notification: Notification) {
    guard let window = notification.object as? NSWindow, !window.inLiveResize else { return }
    reportFrame(window)
  }

  private func reportFrame(_ window: NSWindow) {
    guard let id = id(of: window), !window.styleMask.contains(.fullScreen) else { return }
    let f = window.frame
    emit?("onWindowEvent", ["type": "frame", "id": id, "frame": [f.minX, f.minY, f.width, f.height]])
  }

  // MARK: App lifecycle

  /// Set when JS subscribes to app events; before that there's nothing to flush.
  var appEventsObserved = false
  private var terminateTimer: Timer?
  private var awaitingTerminateReply = false
  private var quitRequested = false
  private var sessionSaved = false

  /// ⌘Q: Dia's "Warn before quitting" (if on), then JS saves the session (`willQuit`
  /// → replyToTerminate) and only then `terminate:` — NNApplication shuts CEF down,
  /// closing every browser, as soon as `terminate:` is called.
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

  /// Other ways to quit (Dock, logout): save while `terminate:` waits.
  func shouldTerminate() -> NSApplication.TerminateReply {
    if sessionSaved || !appEventsObserved || emit == nil { return .terminateNow }
    if !quitRequested, !confirmActiveDownloads() { return .terminateCancel }
    awaitingTerminateReply = true
    emit?("onAppEvent", ["type": "willQuit"])
    startTerminateTimer()
    return .terminateLater
  }

  /// Dia's quit guard: running downloads are cancelled by quitting, so ask first.
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

  /// JS's answer to `willQuit` (the session is saved).
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
    // .terminateLater runs the loop in the modal-panel mode; a default-mode timer would never fire.
    let timer = Timer(timeInterval: 1.5, repeats: false) { [weak self] _ in self?.replyToTerminate(true) }
    RunLoop.main.add(timer, forMode: .common)
    terminateTimer = timer
  }

  /// Dock icon clicked with no windows open: JS opens a fresh one.
  func reopen() {
    emit?("onAppEvent", ["type": "reopen"])
  }
}

