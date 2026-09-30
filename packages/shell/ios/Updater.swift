import AppKit
#if canImport(Sparkle)
import Sparkle
#endif

public final class AppUpdater: NSObject {
  public static let shared = AppUpdater()

  static var feedOverride: String? {
    let env = ProcessInfo.processInfo.environment
    if let feed = env["NETNYAHOO_UPDATE_FEED_URL"] ?? UserDefaults.standard.string(forKey: "NNUpdateFeedURL") { return feed }
    // SUFeedURL (netnyahoo.com) counts checks as copies in use; test instances go straight to the same file.
    let isolated = env["NETNYAHOO_BACKGROUND"] == "1" || env["NETNYAHOO_DATA_DIR"] != nil
    return isolated ? "https://github.com/mantrakp04/netnyahoo/releases/latest/download/appcast.xml" : nil
  }

  #if canImport(Sparkle)
  private lazy var controller = SPUStandardUpdaterController(startingUpdater: false, updaterDelegate: self, userDriverDelegate: self)
  private var deferredUpdate = false
  private var deferredRelaunch: (() -> Void)?
  // The feed counts update checks by version and day; this one bit (no ID) tells a copy's first check
  // from the ones after, so first launches can be told from copies still running.
  private var firstCheckPending = false
  #endif
  private var started = false

  public var isAvailable: Bool {
    #if canImport(Sparkle)
    true
    #else
    false
    #endif
  }

  public var isConfigured: Bool {
    guard isAvailable else { return false }
    let info = Bundle.main.infoDictionary ?? [:]
    let feed = (Self.feedOverride ?? info["SUFeedURL"] as? String ?? "").trimmingCharacters(in: .whitespaces)
    let key = (info["SUPublicEDKey"] as? String ?? "").trimmingCharacters(in: .whitespaces)
    guard let scheme = URL(string: feed)?.scheme?.lowercased() else { return false }
    return (scheme == "https" || scheme == "http") && !key.isEmpty
  }

  public func start() {
    #if canImport(Sparkle)
    guard !started, isConfigured else { return }
    started = true
    // Sparkle stamps the check date before it builds the feed URL, so read it before the first check.
    firstCheckPending = controller.updater.lastUpdateCheckDate == nil
    do {
      try controller.updater.start()
    } catch {
      NSLog("Netnyahoo: couldn't start the updater: \(error.localizedDescription)")
    }
    NotificationCenter.default.addObserver(self, selector: #selector(fullScreenChanged), name: NSWindow.didExitFullScreenNotification, object: nil)
    #endif
  }

  @objc public func checkForUpdates(_ sender: Any?) {
    #if canImport(Sparkle)
    guard isConfigured else { return showNotSetUp() }
    start()
    controller.checkForUpdates(sender)
    #endif
  }

  public var state: [String: Any] {
    #if canImport(Sparkle)
    let updater = controller.updater
    return [
      "available": true,
      "configured": isConfigured,
      "automaticChecks": updater.automaticallyChecksForUpdates,
      "automaticDownloads": updater.automaticallyDownloadsUpdates,
      "canCheck": updater.canCheckForUpdates,
      "sessionInProgress": updater.sessionInProgress,
      "feedURL": updater.feedURL?.absoluteString as Any,
      "lastCheck": updater.lastUpdateCheckDate.map { $0.timeIntervalSince1970 * 1000 } as Any,
      "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as Any,
    ]
    #else
    return ["available": false]
    #endif
  }

  public func setAutomaticChecks(_ on: Bool) {
    #if canImport(Sparkle)
    controller.updater.automaticallyChecksForUpdates = on
    #endif
  }

  public func setAutomaticDownloads(_ on: Bool) {
    #if canImport(Sparkle)
    controller.updater.automaticallyDownloadsUpdates = on
    #endif
  }

  private func showNotSetUp() {
    let alert = NSAlert()
    let name = ProcessInfo.processInfo.processName
    alert.messageText = "Updates aren't set up for this build"
    alert.informativeText = "This copy of \(name) doesn't have an update feed, so it can't check for new versions. Get newer versions from wherever you got this one."
    alert.addButton(withTitle: "OK")
    if let window = NSApp.keyWindow, window.attachedSheet == nil {
      alert.beginSheetModal(for: window)
    } else {
      alert.runModal()
    }
  }

  static var isPresentingFullScreen: Bool {
    NSApp.windows.contains { $0.isVisible && $0.styleMask.contains(.fullScreen) }
  }

  #if canImport(Sparkle)
  @objc private func fullScreenChanged() {
    DispatchQueue.main.async { [self] in
      guard !Self.isPresentingFullScreen else { return }
      if let relaunch = deferredRelaunch {
        deferredRelaunch = nil
        relaunch()
      } else if deferredUpdate {
        deferredUpdate = false
        controller.checkForUpdates(nil)
      }
    }
  }
  #endif
}

#if canImport(Sparkle)
extension AppUpdater: SPUUpdaterDelegate {
  public func feedURLString(for updater: SPUUpdater) -> String? { Self.feedOverride }

  // Sparkle calls this only when it's about to fetch the feed (the permission prompt, which also asks,
  // never shows: SUEnableAutomaticChecks is in Info.plist). No system profile is ever sent.
  public func feedParameters(for updater: SPUUpdater, sendingSystemProfile sendingProfile: Bool) -> [[String: String]] {
    guard firstCheckPending else { return [] }
    firstCheckPending = false
    return [["key": "first", "value": "1"]]
  }

  public func updater(_ updater: SPUUpdater, shouldPostponeRelaunchForUpdate item: SUAppcastItem, untilInvokingBlock installHandler: @escaping () -> Void) -> Bool {
    guard Self.isPresentingFullScreen else { return false }
    deferredRelaunch = installHandler
    return true
  }
}

extension AppUpdater: SPUStandardUserDriverDelegate {
  public var supportsGentleScheduledUpdateReminders: Bool { true }

  public func standardUserDriverShouldHandleShowingScheduledUpdate(_ update: SUAppcastItem, andInImmediateFocus immediateFocus: Bool) -> Bool {
    !Self.isPresentingFullScreen
  }

  public func standardUserDriverWillHandleShowingUpdate(_ handleShowingUpdate: Bool, forUpdate update: SUAppcastItem, state: SPUUserUpdateState) {
    if !handleShowingUpdate { deferredUpdate = true }
  }

  public func standardUserDriverWillFinishUpdateSession() {
    deferredUpdate = false
  }

  @objc(standardUserDriverShowVersionHistoryForAppcastItem:)
  public func standardUserDriverShowVersionHistory(for item: SUAppcastItem) {
    guard let page = item.fullReleaseNotesURL else { return }
    var components = URLComponents(url: page, resolvingAgainstBaseURL: false)
    components?.fragment = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
    OpenURLInbox.receive([components?.url ?? page])
  }
}
#endif
