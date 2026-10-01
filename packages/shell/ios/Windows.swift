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
    // A window opened without focus (tabs Small Yahu sends behind with no main window open) goes behind the
    // key window instead of over it.
    if focus {
      window.makeKeyAndOrderFront(nil)
    } else if let key = NSApp.keyWindow, key !== window {
      window.order(.below, relativeTo: key.windowNumber)
    } else {
      window.orderFront(nil)
    }
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


// MARK: - Dragged tab preview

/// The dragged tab as Dia shows it once it leaves its list: a small picture of the window under the pointer
/// (over the page, outside the window, over other apps), after a moment as a tab-shaped pill. A borderless,
/// non-activating panel that takes no mouse events, so the drag keeps going to the window it started in and no
/// app is activated. In a hidden instance (NETNYAHOO_BACKGROUND) it stays just above its window instead of
/// floating over every app.
final class DragPreview {
  static let shared = DragPreview()

  // Dia's card (209 × 109.5, a picture of the window) and its tab pill; measured in dia-spec.md › Dragging tabs.
  static let card = NSSize(width: 209, height: 110)
  private static let pillMs = 0.03
  private static let morph = 0.06
  private static let grow = 0.2
  private static let fadeOut = 0.1

  private final class Panel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
  }

  private var panel: Panel?
  private let picture = CALayer()
  private weak var source: NSWindow?
  private var sourceClosing: NSObjectProtocol?
  private var windowImage: CGImage?
  private var pageImage: (image: CGImage, frame: NSRect)?
  private var placeholder = false
  private var cardImage: CGImage?
  private var pillImage: CGImage?
  private var pillSize = NSSize(width: 173, height: 32)
  // The pointer's place in the pill when the tab was grabbed, from its top-left.
  private var grab = NSPoint(x: 86, y: 16)
  private var shape = "hidden" { didSet { if shape != oldValue { shapes.append(shape) } } }
  // The shapes shown since the drag began (DEV state).
  private var shapes: [String] = []
  private var wanted = "hidden"
  private var lastPoint = NSPoint.zero
  private var shownAt = 0.0
  private var generation = 0
  private let background = ProcessInfo.processInfo.environment["NETNYAHOO_BACKGROUND"] == "1"
  // A frame and alpha animation driven here: AppKit's animator doesn't run for a panel of an app that isn't active
  // (a hidden instance, or a drag that started in a window behind another app's). It heads for `desired`, which
  // follows the pointer.
  private var animation: Timer?
  private var desired = NSRect.zero

  /// `chip`: the dragged item in the window, from its top-left; `grab`: the pointer in the same coordinates.
  func begin(windowId: String, chip: NSRect, grab: NSPoint) {
    cancel()
    shapes = []
    guard let window = WindowManager.shared.windows[windowId] else { return }
    source = window
    sourceClosing = NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: window, queue: .main) {
      [weak self] _ in self?.cancel()
    }
    pillSize = chip.size
    self.grab = NSPoint(x: grab.x - chip.minX, y: grab.y - chip.minY)
    windowImage = Self.snapshot(window)
    pillImage = windowImage.flatMap { Self.crop($0, to: chip, in: window) }
    composeCard()
  }

  /// The page as the engine painted it (the window's own snapshot has no web content), at `frame` in the
  /// window from its top-left.
  func setPage(_ data: Data, frame: NSRect) {
    guard source != nil, let image = NSImage(data: data)?.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return }
    pageImage = (image, frame)
    placeholder = false
    composeCard()
    if shape == "card" { picture.contents = cardImage }
  }

  /// A tab never painted (asleep, not shown since launch): its icon and title where its page would be.
  func setPlaceholder(title: String, favicon: String?) {
    guard let window = source, pageImage == nil else { return }
    let size = window.frame.size
    let top: CGFloat = 42
    let page = NSRect(x: 0, y: top, width: size.width, height: max(1, size.height - top))
    let icon: NSImage? = favicon.flatMap { spec -> NSImage? in
      guard let url = URL(string: spec) else { return nil }
      if url.isFileURL { return NSImage(contentsOf: url) }
      if url.scheme == "data", let data = try? Data(contentsOf: url) { return NSImage(data: data) }
      return nil
    } ?? NSImage(systemSymbolName: "globe", accessibilityDescription: nil)
    let image = NSImage(size: page.size, flipped: false) { rect in
      let dark = window.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
      (dark ? NSColor(white: 0.12, alpha: 1) : NSColor(white: 0.97, alpha: 1)).setFill()
      rect.fill()
      let iconSide: CGFloat = 64
      let ink = dark ? NSColor(white: 1, alpha: 0.7) : NSColor(white: 0, alpha: 0.6)
      let label = NSAttributedString(string: title, attributes: [
        .font: NSFont.systemFont(ofSize: 34, weight: .medium),
        .foregroundColor: ink,
      ])
      let textSize = label.size()
      let textWidth = min(textSize.width, rect.width - 80)
      // The globe is a template symbol: drawn as is it's black, which vanishes on the dark card.
      let icon = icon?.isTemplate == true ? icon?.withSymbolConfiguration(.init(paletteColors: [ink])) ?? icon : icon
      icon?.draw(in: NSRect(x: rect.midX - iconSide / 2, y: rect.midY + 12, width: iconSide, height: iconSide))
      label.draw(with: NSRect(x: rect.midX - textWidth / 2, y: rect.midY - 12 - textSize.height, width: textWidth, height: textSize.height),
        options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine])
      return true
    }
    guard let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return }
    pageImage = (cg, page)
    placeholder = true
    composeCard()
    if shape == "card" { picture.contents = cardImage }
  }

  /// `shape`: "hidden", "pill" (over another window's tabs) or "card"; `at`: the pointer in the source window from its
  /// top-left (converted here with the window's real frame, which is right in full screen too). A card that wasn't
  /// showing comes in as the pill first, as Dia's does.
  func update(shape next: String, at local: NSPoint) {
    guard let source else { return }
    let point = NSPoint(x: source.frame.minX + local.x, y: source.frame.maxY - local.y)
    wanted = next
    lastPoint = point
    if next == "hidden" {
      hide()
      return
    }
    let panel = self.panel ?? makePanel()
    if shape == "hidden" {
      // Comes in as the pill, then becomes the card.
      shownAt = ProcessInfo.processInfo.systemUptime
      shape = "pill"
      animation?.invalidate()
      animation = nil
      panel.alphaValue = 1
      place(panel, shape: "pill", at: point, animated: false)
      if background { panel.order(.above, relativeTo: source.windowNumber) } else { panel.orderFrontRegardless() }
      guard next == "card" else { return }
      let gen = generation
      DispatchQueue.main.asyncAfter(deadline: .now() + Self.pillMs) { [weak self] in
        guard let self, self.generation == gen, self.shape == "pill", self.wanted == "card" else { return }
        self.shape = "card"
        self.place(panel, shape: "card", at: self.lastPoint, animated: true)
      }
    } else if shape != next, !(next == "card" && ProcessInfo.processInfo.systemUptime - shownAt < Self.pillMs) {
      shape = next
      place(panel, shape: next, at: point, animated: true)
    } else {
      place(panel, shape: shape, at: point, animated: false)
    }
  }

  /// The drag ended. `windowId`: the new window the tab went to (`fallback`: the frame it asked for, on screen);
  /// the card grows into the window's real frame (Dia: 0.2 s) before it fades. Otherwise the card fades at once.
  func end(windowId: String?, fallback: NSRect?) {
    let panel = self.panel
    let showing = shape != "hidden"
    let card = cardImage
    release()
    guard let panel, showing else {
      panel?.orderOut(nil)
      return
    }
    let gen = generation
    let fade: () -> Void = { [weak self] in
      guard let self, self.generation == gen else { return }
      self.animate(panel, to: panel.frame, alpha: 0, duration: Self.fadeOut) { panel.orderOut(nil) }
    }
    guard let windowId, let fallback, fallback.width > 0 else { return fade() }
    picture.contents = card
    // The window opens a moment later, placed by AppKit (kept on its screen, below the menu bar).
    var tries = 0
    func grow() {
      guard generation == gen else { return }
      if let window = WindowManager.shared.windows[windowId], window.isVisible {
        return animate(panel, to: window.frame, alpha: 1, duration: Self.grow, then: fade)
      }
      tries += 1
      if tries > 20 { return animate(panel, to: fallback, alpha: 1, duration: Self.grow, then: fade) }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.016) { grow() }
    }
    grow()
  }

  /// Gone at once, with everything it held (a new drag, the source window closing).
  func cancel() {
    animation?.invalidate()
    animation = nil
    panel?.orderOut(nil)
    release()
  }

  private func release() {
    generation += 1
    shape = "hidden"
    wanted = "hidden"
    if let sourceClosing { NotificationCenter.default.removeObserver(sourceClosing) }
    sourceClosing = nil
    source = nil
    windowImage = nil
    pageImage = nil
    placeholder = false
    cardImage = nil
    pillImage = nil
  }

  private func hide() {
    animation?.invalidate()
    animation = nil
    guard shape != "hidden" else { return }
    shape = "hidden"
    panel?.orderOut(nil)
  }

  /// DEV: the card and pill pictures as PNGs, to look at.
  func debugWrite(dir: String) -> Bool {
    var ok = false
    for (name, image) in [("card", cardImage), ("pill", pillImage)] {
      guard let image, let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else { continue }
      ok = (try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("drag-\(name).png"))) != nil || ok
    }
    return ok
  }

  /// DEV: what shows, for tests (the panel can't be captured while the screen is locked).
  var debugState: [String: Any] {
    let frame = panel?.frame ?? .zero
    return [
      "shape": shape, "shapes": shapes, "visible": panel?.isVisible ?? false, "alpha": panel?.alphaValue ?? 0,
      "frame": [frame.minX, frame.minY, frame.width, frame.height], "page": pageImage != nil, "placeholder": placeholder,
      "key": panel?.isKeyWindow ?? false, "ignoresMouse": panel?.ignoresMouseEvents ?? false,
      "level": panel?.level.rawValue ?? 0, "activeApp": NSApp.isActive,
    ]
  }

  private func animate(_ panel: NSPanel, to frame: NSRect, alpha: CGFloat, duration: Double, then done: (() -> Void)? = nil) {
    animation?.invalidate()
    desired = frame
    let from = panel.frame, fromAlpha = panel.alphaValue
    let start = ProcessInfo.processInfo.systemUptime
    let timer = Timer(timeInterval: 1.0 / 120, repeats: true) { [weak self] timer in
      let t = min(1, (ProcessInfo.processInfo.systemUptime - start) / max(duration, 0.001))
      let target = self?.desired ?? frame
      let e = 1 - pow(1 - t, 3)  // ease-out
      let mix = { (a: CGFloat, b: CGFloat) in a + (b - a) * e }
      panel.setFrame(NSRect(x: mix(from.minX, target.minX), y: mix(from.minY, target.minY), width: mix(from.width, target.width),
        height: mix(from.height, target.height)), display: true)
      panel.alphaValue = mix(fromAlpha, alpha)
      guard t >= 1 else { return }
      timer.invalidate()
      if self?.animation === timer { self?.animation = nil }
      done?()
    }
    RunLoop.main.add(timer, forMode: .common)
    animation = timer
  }

  private func makePanel() -> Panel {
    let panel = Panel(contentRect: NSRect(origin: .zero, size: Self.card), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
    panel.isFloatingPanel = !background
    panel.level = background ? .normal : .floating
    panel.ignoresMouseEvents = true
    panel.hidesOnDeactivate = false
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.animationBehavior = .none
    panel.isReleasedWhenClosed = false
    panel.collectionBehavior = [.transient, .ignoresCycle, .fullScreenAuxiliary, .canJoinAllSpaces]
    let view = NSView(frame: panel.contentLayoutRect)
    view.wantsLayer = true
    view.autoresizingMask = [.width, .height]
    picture.frame = view.bounds
    picture.autoresizingMask = [.layerWidthSizable, .layerHeightSizable]
    picture.contentsGravity = .resizeAspectFill
    picture.masksToBounds = true
    picture.borderWidth = 0.5
    view.layer?.addSublayer(picture)
    panel.contentView = view
    self.panel = panel
    return panel
  }

  private func place(_ panel: NSPanel, shape: String, at point: NSPoint, animated: Bool) {
    let pill = shape == "pill"
    let size = pill ? pillSize : Self.card
    // The pill keeps the pointer where it held the tab; the card is centred on it.
    let offset = pill ? grab : NSPoint(x: size.width / 2, y: size.height / 2)
    let frame = NSRect(x: (point.x - offset.x).rounded(), y: (point.y - size.height + offset.y).rounded(), width: size.width, height: size.height)
    CATransaction.begin()
    CATransaction.setDisableActions(!animated)
    picture.contents = pill ? pillImage : cardImage
    picture.cornerRadius = pill ? 10 : 4
    picture.borderColor = NSColor(white: 1, alpha: pill ? 0.15 : 0.3).cgColor
    CATransaction.commit()
    if animated, panel.frame.size != frame.size {
      animate(panel, to: frame, alpha: 1, duration: Self.morph)
    } else if animation == nil {
      panel.setFrame(frame, display: false)
    } else {
      desired = frame
    }
  }

  // The window with the page painted in, at the card's aspect from the top (title bar and tabs kept).
  private func composeCard() {
    guard let window = source, let base = windowImage else { return }
    let size = window.frame.size
    let scale = 2.0
    let width = Int(Self.card.width * scale), height = Int(Self.card.height * scale)
    guard let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return }
    let fit = max(Self.card.width / size.width, Self.card.height / size.height) * scale
    // CG's origin is bottom-left: the window's top sits at the card's top.
    let drawn = CGRect(x: 0, y: CGFloat(height) - size.height * fit, width: size.width * fit, height: size.height * fit)
    ctx.interpolationQuality = .high
    ctx.draw(base, in: drawn)
    if let page = pageImage {
      let r = page.frame
      ctx.draw(page.image, in: CGRect(x: r.minX * fit, y: drawn.maxY - r.maxY * fit, width: r.width * fit, height: r.height * fit))
    }
    cardImage = ctx.makeImage()
  }

  private static func snapshot(_ window: NSWindow) -> CGImage? {
    guard let view = window.contentView, let layer = view.layer else { return nil }
    let size = view.bounds.size
    let scale = window.backingScaleFactor
    guard size.width > 0, size.height > 0,
      let ctx = CGContext(data: nil, width: Int(size.width * scale), height: Int(size.height * scale), bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }
    ctx.setFillColor((window.backgroundColor ?? .windowBackgroundColor).cgColor)
    ctx.fill(CGRect(x: 0, y: 0, width: size.width * scale, height: size.height * scale))
    ctx.scaleBy(x: scale, y: scale)
    if view.isFlipped || layer.isGeometryFlipped {
      ctx.translateBy(x: 0, y: size.height)
      ctx.scaleBy(x: 1, y: -1)
    }
    layer.render(in: ctx)
    return ctx.makeImage()
  }

  private static func crop(_ image: CGImage, to rect: NSRect, in window: NSWindow) -> CGImage? {
    let scale = CGFloat(image.width) / max(1, window.frame.width)
    return image.cropping(to: CGRect(x: rect.minX * scale, y: rect.minY * scale, width: rect.width * scale, height: rect.height * scale))
  }
}
