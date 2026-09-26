import AppKit

/// Borderless-looking browser window: content runs under a transparent title
/// bar and the traffic lights are nudged down into the sidebar header, like Dia.
/// Only for an engine without Chrome-hosted windows (stock CEF, NN_CHROME_TABS=0):
/// otherwise every browser window is Chrome's own (packages/cef NNChromeWindow).
/// The shell's WindowManager creates these and owns their lifecycle, delegate and
/// frame.
final class BrowserWindow: NSWindow {
  /// Traffic-light inset from the window's top-left corner, in points (Dia 1.50.1's; the same as
  /// Chrome-hosted windows, NNChromeWindow.mm).
  private let trafficLightInset = NSPoint(x: 16, y: 20)

  init() {
    super.init(
      contentRect: NSRect(x: 0, y: 0, width: 1360, height: 860),
      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
      backing: .buffered,
      defer: false
    )
    titlebarAppearsTransparent = true
    titleVisibility = .hidden
    title = "Netnyahoo"
    minSize = NSSize(width: 720, height: 460)
    isReleasedWhenClosed = false
    // Shown for a frame before JS paints the grained backdrop.
    backgroundColor = NSColor(name: nil) { appearance in
      appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        ? NSColor(srgbRed: 0.17, green: 0.12, blue: 0.14, alpha: 1)
        : NSColor(srgbRed: 0.93, green: 0.91, blue: 0.90, alpha: 1)
    }

    for name in [NSWindow.didResizeNotification, NSWindow.didExitFullScreenNotification, NSWindow.didBecomeKeyNotification] {
      NotificationCenter.default.addObserver(self, selector: #selector(layoutTrafficLights), name: name, object: self)
    }
    layoutTrafficLights()
  }

  override func layoutIfNeeded() {
    super.layoutIfNeeded()
    layoutTrafficLights()
  }

  @objc private func layoutTrafficLights() {
    guard !styleMask.contains(.fullScreen),
          let close = standardWindowButton(.closeButton),
          let mini = standardWindowButton(.miniaturizeButton),
          let zoom = standardWindowButton(.zoomButton),
          let container = close.superview?.superview else { return }

    // Grow the title bar container so the lowered buttons aren't clipped.
    let height = close.frame.height + trafficLightInset.y * 2
    var frame = container.frame
    frame.size.height = height
    frame.origin.y = self.frame.height - height
    container.frame = frame

    let spacing = mini.frame.minX - close.frame.minX
    for (i, button) in [close, mini, zoom].enumerated() {
      button.setFrameOrigin(NSPoint(
        x: trafficLightInset.x + CGFloat(i) * spacing,
        y: (height - button.frame.height) / 2
      ))
    }
  }
}
