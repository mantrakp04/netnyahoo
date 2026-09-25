import AppKit

/// Handoff (NSUserActivityTypeBrowsingWeb) both ways. Each browser window advertises its
/// active tab's page; AppKit makes the key window's activity the current one. Activities
/// continued from other devices arrive through the app delegate and open like any URL.
public enum Handoff {
  private static var urls: [String: URL] = [:]

  /// `url` nil (New Tab page, incognito, non-web pages) stops advertising for the window.
  static func setActivity(windowId: String, url: String?, title: String?) {
    guard let window = WindowManager.shared.windows[windowId] else { return }
    guard let url = url.flatMap(URL.init(string:)), ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
      urls[windowId] = nil
      window.userActivity?.invalidate()
      window.userActivity = nil
      return
    }
    if urls[windowId] == url, let activity = window.userActivity {
      activity.title = title
      return
    }
    urls[windowId] = url
    // A fresh activity per page: other devices pick up changes to a new activity promptly.
    window.userActivity?.invalidate()
    let activity = NSUserActivity(activityType: NSUserActivityTypeBrowsingWeb)
    activity.webpageURL = url
    activity.title = title
    activity.isEligibleForHandoff = true
    window.userActivity = activity
    if window.isKeyWindow { activity.becomeCurrent() }
  }

  /// From the app delegate's `application(_:continue:restorationHandler:)`.
  public static func `continue`(_ activity: NSUserActivity) -> Bool {
    guard activity.activityType == NSUserActivityTypeBrowsingWeb, let url = activity.webpageURL else { return false }
    OpenURLInbox.receive([url])
    return true
  }
}

/// File › Share…: the system share picker for a page, shown from the top of its window.
enum SharePicker {
  /// Kept alive while it's on screen.
  private static var current: NSSharingServicePicker?

  static func show(url: String, title: String?, windowId: String?) {
    guard let url = URL(string: url) else { return }
    let window = windowId.flatMap { WindowManager.shared.windows[$0] } ?? NSApp.keyWindow
    guard let view = window?.contentView else { return }
    // Anchor under the toolbar, centred over the page (there's no share button to point at).
    let anchor = NSRect(x: view.bounds.midX - 1, y: view.isFlipped ? 40 : view.bounds.maxY - 42, width: 2, height: 2)
    // The page title heads the picker; recipients get just the link.
    let item = NSPreviewRepresentingActivityItem(item: url as NSURL, title: title?.isEmpty == false ? title : url.host, image: nil, icon: nil)
    let picker = NSSharingServicePicker(items: [item])
    current = picker
    picker.show(relativeTo: anchor, of: view, preferredEdge: .minY)
  }
}
