import AppKit
import UserNotifications

/// App and web notifications through the Notification Center. Whoever posts one (the engine's
/// web notifications, downloads, JS) can attach the tab it came from. Clicking it brings the app
/// forward and reports "click"; dismissing a `dismissible` one (web notifications, whose pages
/// have close handlers) reports "close".
final class NotificationHub: NSObject, UNUserNotificationCenterDelegate {
  static let shared = NotificationHub()

  /// (id, "click" | "close", userInfo); set by the app module.
  var onResponse: ((String, String, [String: Any]) -> Void)?
  /// Responses that arrived before JS was listening (e.g. a click that relaunched the app).
  private var pending: [(String, String, [String: Any])] = []
  private static let dismissibleCategory = "netnyahoo.dismissible"

  private var center: UNUserNotificationCenter { .current() }

  func install() {
    center.delegate = self
    // Only a category with customDismissAction reports the user closing a notification.
    center.setNotificationCategories([
      UNNotificationCategory(identifier: Self.dismissibleCategory, actions: [], intentIdentifiers: [], options: [.customDismissAction]),
    ])
  }

  func flushPending() {
    guard let onResponse else { return }
    pending.forEach(onResponse)
    pending = []
  }

  /// "granted" | "denied" | "notDetermined" | "provisional".
  func permission(_ completion: @escaping (String) -> Void) {
    center.getNotificationSettings { settings in
      let status: String
      switch settings.authorizationStatus {
      case .authorized: status = "granted"
      case .denied: status = "denied"
      case .provisional, .ephemeral: status = "provisional"
      default: status = "notDetermined"
      }
      DispatchQueue.main.async { completion(status) }
    }
  }

  func requestPermission(_ completion: @escaping (Bool) -> Void) {
    center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
      DispatchQueue.main.async { completion(granted) }
    }
  }

  /// options: { id, title, body?, subtitle?, silent?, icon? (http(s)/data/file URL), tabId?, windowId?, origin?,
  /// dismissible?, data? }
  func post(_ options: [String: Any], completion: @escaping (String?) -> Void) {
    let id = options["id"] as? String ?? UUID().uuidString
    let content = UNMutableNotificationContent()
    content.title = options["title"] as? String ?? ""
    content.body = options["body"] as? String ?? ""
    if let subtitle = options["subtitle"] as? String { content.subtitle = subtitle }
    if options["silent"] as? Bool != true { content.sound = .default }
    // Group by site, like Chrome's per-origin notification threads.
    if let origin = options["origin"] as? String { content.threadIdentifier = origin }
    if options["dismissible"] as? Bool == true { content.categoryIdentifier = Self.dismissibleCategory }
    var info: [String: Any] = [:]
    for key in ["tabId", "windowId", "origin", "data"] { if let v = options[key] { info[key] = v } }
    content.userInfo = info

    let deliver = { [center] in
      center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil)) { error in
        DispatchQueue.main.async { completion(error == nil ? id : nil) }
      }
    }
    guard let icon = (options["icon"] as? String).flatMap(URL.init(string:)) else { return deliver() }
    attachment(from: icon, id: id) { attachment in
      if let attachment { content.attachments = [attachment] }
      deliver()
    }
  }

  func remove(_ ids: [String]) {
    center.removeDeliveredNotifications(withIdentifiers: ids)
    center.removePendingNotificationRequests(withIdentifiers: ids)
  }

  /// Attachments must be local files; fetch remote/data icons into the temporary directory.
  private func attachment(from url: URL, id: String, completion: @escaping (UNNotificationAttachment?) -> Void) {
    let make = { (file: URL) in completion(try? UNNotificationAttachment(identifier: "icon", url: file)) }
    if url.isFileURL { return make(url) }
    URLSession.shared.dataTask(with: url) { data, response, _ in
      guard let data, !data.isEmpty else { return DispatchQueue.main.async { completion(nil) } }
      let ext = (response?.mimeType == "image/png" || url.absoluteString.hasPrefix("data:image/png")) ? "png"
        : (response?.suggestedFilename as NSString?)?.pathExtension.nonEmpty ?? "png"
      let file = FileManager.default.temporaryDirectory.appendingPathComponent("nn-notification-\(id).\(ext)")
      do {
        try data.write(to: file)
        DispatchQueue.main.async { make(file) }
      } catch {
        DispatchQueue.main.async { completion(nil) }
      }
    }.resume()
  }

  // MARK: UNUserNotificationCenterDelegate

  /// Show banners even while the app is frontmost (the page may be in another tab or window).
  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
    completionHandler([.banner, .list, .sound])
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
    let id = response.notification.request.identifier
    let info = response.notification.request.content.userInfo as? [String: Any] ?? [:]
    let action: String? = switch response.actionIdentifier {
    case UNNotificationDefaultActionIdentifier: "click"
    case UNNotificationDismissActionIdentifier: "close"
    default: nil
    }
    DispatchQueue.main.async { [self] in
      if let action {
        if action == "click" { NSApp.activate() }
        if let onResponse { onResponse(id, action, info) } else { pending.append((id, action, info)) }
      }
      completionHandler()
    }
  }
}

private extension String {
  var nonEmpty: String? { isEmpty ? nil : self }
}
