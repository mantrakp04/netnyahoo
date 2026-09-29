import AppKit

public enum Handoff {
  private static var urls: [String: URL] = [:]

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
    window.userActivity?.invalidate()
    let activity = NSUserActivity(activityType: NSUserActivityTypeBrowsingWeb)
    activity.webpageURL = url
    activity.title = title
    activity.isEligibleForHandoff = true
    window.userActivity = activity
    if window.isKeyWindow { activity.becomeCurrent() }
  }

  public static func `continue`(_ activity: NSUserActivity) -> Bool {
    guard activity.activityType == NSUserActivityTypeBrowsingWeb, let url = activity.webpageURL else { return false }
    OpenURLInbox.receive([url])
    return true
  }
}

enum SharePicker {
  private static var current: NSSharingServicePicker?

  static func show(url: String, title: String?, windowId: String?) {
    guard let url = URL(string: url) else { return }
    let window = windowId.flatMap { WindowManager.shared.windows[$0] } ?? NSApp.keyWindow
    guard let view = window?.contentView else { return }
    let anchor = NSRect(x: view.bounds.midX - 1, y: view.isFlipped ? 40 : view.bounds.maxY - 42, width: 2, height: 2)
    let item = NSPreviewRepresentingActivityItem(item: url as NSURL, title: title?.isEmpty == false ? title : url.host, image: nil, icon: nil)
    let picker = NSSharingServicePicker(items: [item])
    current = picker
    picker.show(relativeTo: anchor, of: view, preferredEdge: .minY)
  }
}
