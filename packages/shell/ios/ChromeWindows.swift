import AppKit
import ExpoModulesCore

enum ChromeWindows {
  private static let host = NSClassFromString("NNChromeWindowHost") as? NSObject.Type

  static func makeWindow(profile: String?) -> NSWindow? {
    guard let host else { return nil }
    let profile = profile ?? ""
    installCloseHandler(host)
    let selector = NSSelectorFromString("makeWindowForProfile:")
    return host.perform(selector, with: profile)?.takeUnretainedValue() as? NSWindow
  }

  private static var closeHandlerInstalled = false
  private static func installCloseHandler(_ host: NSObject.Type) {
    guard !closeHandlerInstalled else { return }
    closeHandlerInstalled = true
    let handler: @convention(block) (NSWindow) -> Bool = { WindowManager.shared.windowShouldClose($0) }
    (host as AnyObject).setValue(handler, forKey: "shouldCloseHandler")
  }

  static func embed(_ root: NSView, in window: NSWindow) {
    host?.perform(NSSelectorFromString("embedRootView:inWindow:"), with: root, with: window)
  }

  static func root(of window: NSWindow) -> NSView? {
    guard let host else { return nil }
    return host.perform(NSSelectorFromString("rootViewOfWindow:"), with: window)?.takeUnretainedValue() as? NSView
  }

  static func close(_ window: NSWindow) {
    host?.perform(NSSelectorFromString("closeWindow:"), with: window)
  }

  static func showProfile(_ profile: String, in window: NSWindow) {
    host?.perform(NSSelectorFromString("showProfile:inWindow:"), with: profile, with: window)
  }

  // The sidebarSlideLean kill switch (src/lib/killSwitches.ts), read once a launch. On, a move is drawn at once and laid
  // out once the lights hold still (the sidebar's slide moves them every frame); off, every move lays them out.
  private static let drawnMoves = KillSwitch.isOn("sidebarSlideLean")

  static func setTrafficLightsCenter(_ center: NSPoint?, in window: NSWindow) {
    let move = NSSelectorFromString("moveTrafficLightsCenter:inWindow:")
    let selector = drawnMoves && (host as AnyObject?)?.responds(to: move) == true ? move : NSSelectorFromString("setTrafficLightsCenter:inWindow:")
    host?.perform(selector, with: center.map { NSValue(point: $0) }, with: window)
  }

  static func prepare(_ profiles: [String], for window: NSWindow) {
    guard !profiles.isEmpty else { return }
    host?.perform(NSSelectorFromString("prepareProfiles:forWindow:"), with: profiles, with: window)
  }

  private static var swapHandlerInstalled = false
  static func onSwap(_ handler: @escaping (NSWindow, NSWindow) -> Void) {
    guard !swapHandlerInstalled, let host else { return }
    swapHandlerInstalled = true
    let block: @convention(block) (NSWindow, NSWindow) -> Void = handler
    (host as AnyObject).setValue(block, forKey: "swappedHandler")
  }

  static func removeRoot(of window: NSWindow) {
    host?.perform(NSSelectorFromString("removeRootViewOfWindow:"), with: window)
  }
}

/// Swap profiles only after the React view-update batch lands.
public class WindowProfileModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NetnyahooWindowProfile")

    View(WindowProfileView.self) {
      Prop("profile") { (view: WindowProfileView, value: String?) in view.profile = value ?? "" }
      Prop("neighbours") { (view: WindowProfileView, value: [String]?) in view.neighbours = value ?? [] }
      OnViewDidUpdateProps { view in view.scheduleSwap() }
    }
  }
}

final class WindowProfileView: ExpoView {
  var profile = ""
  var neighbours: [String] = []
  private var applied: (profile: String, neighbours: [String])?
  private var observer: CFRunLoopObserver?

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window != nil { scheduleSwap() }
  }

  func scheduleSwap() {
    guard observer == nil else { return }
    let observer = CFRunLoopObserverCreateWithHandler(nil, CFRunLoopActivity.beforeWaiting.rawValue, false, 0) { [weak self] _, _ in
      self?.observer = nil
      self?.apply()
    }
    self.observer = observer
    CFRunLoopAddObserver(CFRunLoopGetMain(), observer, .commonModes)
  }

  private func apply() {
    guard let window else { return }
    if applied?.profile != profile { ChromeWindows.showProfile(profile, in: window) }
    if applied?.neighbours != neighbours, let current = self.window { ChromeWindows.prepare(neighbours, for: current) }
    applied = (profile, neighbours)
  }
}
