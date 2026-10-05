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

/// Shares one page (its URL and title) through macOS's sharing services: the share sheet (the site popover's Share…,
/// the command bar), File › Share's submenu and the tab menu's Share submenu. A hidden test instance
/// (NETNYAHOO_BACKGROUND) never shows the sheet or runs a service: it logs what it would share to activation.log.
enum SharePicker {
  private static var current: NSSharingServicePicker?
  private static let delegate = ShareDelegate()
  private static let background = ProcessInfo.processInfo.environment["NETNYAHOO_BACKGROUND"] == "1"

  /// `anchor`: the control's rect in the window, from its top left (RN's measureInWindow); else the top of the page.
  /// `done` runs once the sheet closes.
  static func show(url: String, title: String?, windowId: String?, anchor: [Double]?, done: @escaping () -> Void) {
    let window = windowId.flatMap { WindowManager.shared.windows[$0] } ?? NSApp.keyWindow
    guard let link = URL(string: url), let window, let view = window.contentView else { return done() }
    var rect = NSRect(x: view.bounds.midX - 1, y: view.isFlipped ? 40 : view.bounds.maxY - 42, width: 2, height: 2)
    var edge = NSRectEdge.minY
    if let a = anchor, a.count == 4 {
      rect = view.convert(NSRect(x: a[0], y: view.frame.height - a[1] - a[3], width: a[2], height: a[3]), from: nil)
      edge = rect.midX < view.bounds.midX ? .maxX : .minX
    }
    if background {
      log("share sheet (not shown): \(describe(url, title)) window=#\(window.windowNumber) anchor=\(NSStringFromRect(rect))"
        + " services=\(services().map(\.title).joined(separator: "|"))")
      return done()
    }
    delegate.finish()
    delegate.window = window
    delegate.done = done
    let item = NSPreviewRepresentingActivityItem(
      item: link as NSURL, title: title?.isEmpty == false ? title : link.host, image: nil, icon: nil)
    let picker = NSSharingServicePicker(items: [item])
    picker.delegate = delegate
    current = picker
    picker.show(relativeTo: rect, of: view, preferredEdge: edge)
  }

  /// Runs the service a Share menu listed under `service` (its title).
  static func perform(service: String, url: String, title: String?, windowId: String?) {
    guard let link = URL(string: url), let match = services().first(where: { $0.title == service }) else { return }
    if background {
      return log("share via \(service) (not performed): \(describe(url, title))")
    }
    delegate.finish()
    delegate.window = windowId.flatMap { WindowManager.shared.windows[$0] } ?? NSApp.keyWindow
    match.delegate = delegate
    match.subject = title
    match.perform(withItems: [link])
  }

  /// The services that take a web page, as Safari and Chrome list them. Mail is left out as Chrome does (it crashed
  /// Chrome's process, crbug.com/356643975; File › Email Page Location sends the link instead), and so is Safari's
  /// Reading List.
  static func services() -> [NSSharingService] {
    // +sharingServicesForItems: is deprecated since macOS 13, whose replacement only offers the share sheet.
    let probe: [Any] = [NSURL(string: "https://netnyahoo.com")!]
    let listed = (NSSharingService.self as AnyObject).perform(NSSelectorFromString("sharingServicesForItems:"), with: probe)
    let all = listed?.takeUnretainedValue() as? [NSSharingService] ?? []
    let skipped = Set([NSSharingService.Name.composeEmail, .addToSafariReadingList].compactMap { NSSharingService(named: $0)?.title })
    return all.filter { !skipped.contains($0.title) }
  }

  /// A Share submenu's items: each service (its `representedObject` from `choice`), then More… (System Settings'
  /// sharing extensions).
  static func menuItems(target: AnyObject, action: Selector, choice: (String) -> String) -> [NSMenuItem] {
    var items = services().map { service in
      let item = NSMenuItem(title: service.menuItemTitle, action: action, keyEquivalent: "")
      item.target = target
      item.image = service.image
      item.representedObject = choice(service.title)
      return item
    }
    let more = NSMenuItem(title: "More…", action: #selector(ShareMenu.openSharingSettings(_:)), keyEquivalent: "")
    more.target = ShareMenu.shared
    // Chrome's image for it (a private class method; nil where it's missing).
    let picker = NSSharingServicePicker.self as AnyObject
    let image = NSSelectorFromString("sharedMoreMenuImage")
    if picker.responds(to: image) { more.image = picker.perform(image)?.takeUnretainedValue() as? NSImage }
    items.append(more)
    return items
  }

  private static func describe(_ url: String, _ title: String?) -> String {
    "url=\(url) title=\"\(title ?? "")\""
  }

  // The same file the activation guards and file panels report to (NNCoreActivation.mm).
  private static func log(_ line: String) {
    guard let dir = ProcessInfo.processInfo.environment["NETNYAHOO_DATA_DIR"] else { return }
    let path = (dir as NSString).appendingPathComponent("activation.log")
    let stamp = ISO8601DateFormatter().string(from: Date())
    guard let data = "\(stamp) \(line)\n".data(using: .utf8) else { return }
    if let handle = FileHandle(forWritingAtPath: path) {
      handle.seekToEndOfFile()
      handle.write(data)
      handle.closeFile()
    } else {
      FileManager.default.createFile(atPath: path, contents: data)
    }
  }
}

private final class ShareDelegate: NSObject, NSSharingServicePickerDelegate, NSSharingServiceDelegate {
  weak var window: NSWindow?
  var done: (() -> Void)?

  func finish() {
    let done = done
    self.done = nil
    done?()
  }

  func sharingServicePicker(_ picker: NSSharingServicePicker, delegateFor service: NSSharingService) -> NSSharingServiceDelegate? {
    self
  }

  // Called when a service is picked or the sheet is dismissed.
  func sharingServicePicker(_ picker: NSSharingServicePicker, didChoose service: NSSharingService?) { finish() }

  func sharingService(
    _ sharingService: NSSharingService, sourceWindowForShareItems items: [Any],
    sharingContentScope: UnsafeMutablePointer<NSSharingService.SharingContentScope>
  ) -> NSWindow? {
    window
  }
}

/// File › Share: filled each time it opens, since the services can change while the app runs.
final class ShareMenu: NSObject, NSMenuDelegate, NSMenuItemValidation {
  static let shared = ShareMenu()

  // Listing the services reads the system's extensions; never for a key press (Chrome's crbug.com/40829755).
  func menuHasKeyEquivalent(
    _ menu: NSMenu, for event: NSEvent, target: AutoreleasingUnsafeMutablePointer<AnyObject?>,
    action: UnsafeMutablePointer<Selector?>
  ) -> Bool {
    false
  }

  func menuNeedsUpdate(_ menu: NSMenu) {
    menu.removeAllItems()
    SharePicker.menuItems(target: self, action: #selector(share(_:)), choice: { "via:\($0)" }).forEach(menu.addItem)
  }

  @objc func share(_ sender: NSMenuItem) {
    MenuTarget.shared.handler?("share", sender.representedObject as? String, WindowManager.shared.keyWindowId)
  }

  @objc func openSharingSettings(_ sender: Any?) {
    if let url = URL(string: "x-apple.systempreferences:com.apple.ExtensionsPreferences?extensionPointIdentifier=com.apple.share-services") {
      NSWorkspace.shared.open(url)
    }
  }

  func validateMenuItem(_ item: NSMenuItem) -> Bool {
    item.action == #selector(openSharingSettings(_:)) || !MenuState.current.disabled.contains("share")
  }
}
