import AppKit
import ExpoModulesCore

/// Chrome-hosted windows (docs/research/chrome-hosted-window.md): browser windows are Chrome's
/// own Browser windows with the React root laid over them (NNChromeWindowHost in packages/cef,
/// found by name so the shell doesn't link the engine). Chrome owns such a window's delegate, so
/// the WindowManager follows it through notifications instead.
enum ChromeWindows {
  private static let host = NSClassFromString("NNChromeWindowHost") as? NSObject.Type

  /// A Chrome Browser window of `profile` (the engine's name for the window's profile, incognito
  /// ones included; nil: the default one) for a new browser window. Nil only when the engine
  /// can't make one: stock CEF without client windows (docs/cef-source-build.md › Using it).
  static func makeWindow(profile: String?) -> NSWindow? {
    guard let host else { return nil }
    let profile = profile ?? ""
    installCloseHandler(host)
    let selector = NSSelectorFromString("makeWindowForProfile:")
    return host.perform(selector, with: profile)?.takeUnretainedValue() as? NSWindow
  }

  /// The close button of a Chrome-hosted window asks the WindowManager, as its delegate would.
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

  /// The React root of a Chrome-hosted window (nil for the others: theirs is the content view).
  static func root(of window: NSWindow) -> NSView? {
    guard let host else { return nil }
    return host.perform(NSSelectorFromString("rootViewOfWindow:"), with: window)?.takeUnretainedValue() as? NSView
  }

  /// Closes a Chrome-hosted window the app closes itself (hidden now, gone once no tab is moving out of it).
  static func close(_ window: NSWindow) {
    host?.perform(NSSelectorFromString("closeWindow:"), with: window)
  }

  /// The app window shows `profile`: its Chrome window of that profile takes over (see
  /// NNChromeWindowHost showProfile:inWindow:; onSwap hears of it).
  static func showProfile(_ profile: String, in window: NSWindow) {
    host?.perform(NSSelectorFromString("showProfile:inWindow:"), with: profile, with: window)
  }

  /// Makes the app window's Chrome windows for `profiles` ahead of a swap.
  static func prepare(_ profiles: [String], for window: NSWindow) {
    guard !profiles.isEmpty else { return }
    host?.perform(NSSelectorFromString("prepareProfiles:forWindow:"), with: profiles, with: window)
  }

  /// Every swap of an app window from one of its Chrome windows to another.
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

/// The window's profile, from the React commit that lays the profile out (`WindowProfile` in JS): an
/// invisible view whose props arrive in the same batch of view updates as the profile's page, URL and
/// sidebar. The Chrome window swap waits for that batch: swapping when the store changed, ahead of
/// those views, put the old profile's page (blank while Chrome moved it) and URL in the new window for
/// the 100 ms or so the commit took to arrive.
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
  /// The engine's name for it ("" is the default profile).
  var profile = ""
  var neighbours: [String] = []
  private var applied: (profile: String, neighbours: [String])?
  private var observer: CFRunLoopObserver?

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    // Mounted with the root: the window was made for its profile, but its neighbours are made ahead.
    if window != nil { scheduleSwap() }
  }

  /// Once this batch of view updates is in (React Native applies it in one main-queue block): when the
  /// main run loop next goes idle.
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
    // The root may be in the profile's window now.
    if applied?.neighbours != neighbours, let current = self.window { ChromeWindows.prepare(neighbours, for: current) }
    applied = (profile, neighbours)
  }
}
