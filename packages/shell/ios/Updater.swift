import AppKit
#if canImport(Sparkle)
import Sparkle
#endif

/// Sparkle 2 auto-updates. The feed comes from Info.plist `SUFeedURL` (the GitHub releases appcast; the
/// EdDSA public key, `SUPublicEDKey`, is set), overridable with the `NETNYAHOO_UPDATE_FEED_URL`
/// environment variable (or the `NNUpdateFeedURL` default) so a build can be pointed at a staging
/// appcast. A build without a feed never starts Sparkle, and Check for Updates… says updates
/// aren't set up. Like Dia, an update found while a window is in full screen (usually a video)
/// waits until full screen ends before it's shown or installed.
public final class AppUpdater: NSObject {
  public static let shared = AppUpdater()

  static var feedOverride: String? {
    ProcessInfo.processInfo.environment["NETNYAHOO_UPDATE_FEED_URL"] ?? UserDefaults.standard.string(forKey: "NNUpdateFeedURL")
  }

  #if canImport(Sparkle)
  private lazy var controller = SPUStandardUpdaterController(startingUpdater: false, updaterDelegate: self, userDriverDelegate: self)
  /// A scheduled update found during full screen, waiting to be shown.
  private var deferredUpdate = false
  /// Sparkle's "relaunch now" continuation, held while in full screen.
  private var deferredRelaunch: (() -> Void)?
  #endif
  private var started = false

  public var isAvailable: Bool {
    #if canImport(Sparkle)
    true
    #else
    false
    #endif
  }

  /// Whether this build has somewhere to update from: an http(s) appcast and the public key
  /// updates are verified with.
  public var isConfigured: Bool {
    guard isAvailable else { return false }
    let info = Bundle.main.infoDictionary ?? [:]
    let feed = (Self.feedOverride ?? info["SUFeedURL"] as? String ?? "").trimmingCharacters(in: .whitespaces)
    let key = (info["SUPublicEDKey"] as? String ?? "").trimmingCharacters(in: .whitespaces)
    guard let scheme = URL(string: feed)?.scheme?.lowercased() else { return false }
    return (scheme == "https" || scheme == "http") && !key.isEmpty
  }

  /// Starts background checks. Safe to call more than once.
  public func start() {
    #if canImport(Sparkle)
    guard !started, isConfigured else { return }
    started = true
    do {
      try controller.updater.start()
    } catch {
      NSLog("Netnyahoo: couldn't start the updater: \(error.localizedDescription)")
    }
    NotificationCenter.default.addObserver(self, selector: #selector(fullScreenChanged), name: NSWindow.didExitFullScreenNotification, object: nil)
    #endif
  }

  /// App menu › Check for Updates…
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

  /// Check for Updates… in a build without an update feed: say so rather than let Sparkle fail.
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

  /// Whether a window is in full screen right now (a video, a presentation…).
  static var isPresentingFullScreen: Bool {
    NSApp.windows.contains { $0.isVisible && $0.styleMask.contains(.fullScreen) }
  }

  #if canImport(Sparkle)
  @objc private func fullScreenChanged() {
    // Other windows may still be full screen; wait for the last one.
    DispatchQueue.main.async { [self] in
      guard !Self.isPresentingFullScreen else { return }
      if let relaunch = deferredRelaunch {
        deferredRelaunch = nil
        relaunch()
      } else if deferredUpdate {
        deferredUpdate = false
        // Brings the already-found update back up.
        controller.checkForUpdates(nil)
      }
    }
  }
  #endif
}

#if canImport(Sparkle)
extension AppUpdater: SPUUpdaterDelegate {
  public func feedURLString(for updater: SPUUpdater) -> String? { Self.feedOverride }

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

  /// "You're up to date" › Version History (the appcast's fullReleaseNotesLink, scripts/release.sh):
  /// the running version's entry, in a tab here rather than in the default browser.
  @objc(standardUserDriverShowVersionHistoryForAppcastItem:)
  public func standardUserDriverShowVersionHistory(for item: SUAppcastItem) {
    guard let page = item.fullReleaseNotesURL else { return }
    var components = URLComponents(url: page, resolvingAgainstBaseURL: false)
    components?.fragment = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
    OpenURLInbox.receive([components?.url ?? page])
  }
}
#endif
