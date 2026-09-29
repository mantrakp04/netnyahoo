import AppKit

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
