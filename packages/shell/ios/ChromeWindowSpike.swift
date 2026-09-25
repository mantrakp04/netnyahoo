import AppKit

/// Chrome-hosted windows (docs/research/chrome-hosted-window.md), behind
/// NETNYAHOO_CHROME_WINDOW=1: browser windows are Chrome's own Browser windows with the
/// React root laid over them (NNChromeWindowHost in packages/cef, found by name so the
/// shell doesn't link the engine). Chrome owns such a window's delegate, so the
/// WindowManager follows it through notifications instead.
enum ChromeWindowSpike {
  private static var host: NSObject.Type? {
    guard ProcessInfo.processInfo.environment["NETNYAHOO_CHROME_WINDOW"] == "1",
          let cls = NSClassFromString("NNChromeWindowHost") as? NSObject.Type,
          cls.value(forKey: "enabled") as? Bool == true else { return nil }
    return cls
  }

  /// A Chrome Browser window of `profile` (the engine's name for the window's profile, incognito
  /// ones included) for a new browser window, or nil to make the usual one.
  static func makeWindow(profile: String?) -> NSWindow? {
    guard let profile, let host else { return nil }
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

  static func removeRoot(of window: NSWindow) {
    host?.perform(NSSelectorFromString("removeRootViewOfWindow:"), with: window)
  }
}
