import AppKit

/// Chrome-hosted window spike (docs/research/chrome-hosted-window.md), behind
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

  /// A Chrome Browser window for a new browser window, or nil to make the usual one.
  static func makeWindow(incognito: Bool) -> NSWindow? {
    // Incognito windows keep the ghost path (their profile is made later, per window).
    guard !incognito, let host else { return nil }
    let selector = NSSelectorFromString("makeWindowForProfile:")
    return host.perform(selector, with: "")?.takeUnretainedValue() as? NSWindow
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
