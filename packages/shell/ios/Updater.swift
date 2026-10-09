import AppKit
#if canImport(Sparkle)
import Sparkle
#endif

public final class AppUpdater: NSObject {
  public static let shared = AppUpdater()

  static var feedOverride: String? {
    let env = ProcessInfo.processInfo.environment
    if let feed = env["ARCADIA_UPDATE_FEED_URL"] ?? UserDefaults.standard.string(forKey: "ACUpdateFeedURL") { return feed }
    // SUFeedURL (netnyahoo.com) counts checks as copies in use; background instances go straight to the same file.
    return env["ARCADIA_BACKGROUND"] == "1" ? "https://github.com/mantrakp04/netnyahoo/releases/latest/download/appcast.xml" : nil
  }

  // A test instance (ACIsolation.h) checks for updates only when it's given a feed, and keeps Sparkle's state
  // (last check, skipped version, its settings) in its data dir's defaults.
  private static var isOff: Bool {
    ACIsolatedDataDirectory() != nil && ProcessInfo.processInfo.environment["ARCADIA_UPDATE_FEED_URL"] == nil
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
    guard isAvailable, !Self.isOff else { return false }
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
      NSLog("Arcadia: couldn't start the updater: \(error.localizedDescription)")
    }
    NotificationCenter.default.addObserver(self, selector: #selector(fullScreenChanged), name: NSWindow.didExitFullScreenNotification, object: nil)
    #endif
  }

  @objc public func checkForUpdates(_ sender: Any?) {
    #if canImport(Sparkle)
    guard isConfigured else {
      // A hidden instance never blocks on an alert.
      if ProcessInfo.processInfo.environment["ARCADIA_BACKGROUND"] == "1" {
        return NSLog("Arcadia: update checks are off in this instance")
      }
      return showNotSetUp()
    }
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

  // An update downloaded in the background (SUAutomaticallyUpdate), extracted and checked by Sparkle's installer, is
  // installed when the app quits: prewarm it now, long before the user's next launch. Sparkle keeps its own schedule
  // (false). Updates installed from the update window relaunch at once and keep Sparkle's own scan only.
  public func updater(_ updater: SPUUpdater, willInstallUpdateOnQuit item: SUAppcastItem, immediateInstallationBlock immediateInstallHandler: @escaping () -> Void) -> Bool {
    // The updatePrewarm kill switch (src/lib/killSwitches.ts): off, the staged copy just waits for the quit, as before.
    if KillSwitch.isOn("updatePrewarm") { UpdatePrewarm.start(version: item.versionString) }
    return false
  }

  public func updater(_ updater: SPUUpdater, shouldPostponeRelaunchForUpdate item: SUAppcastItem, untilInvokingBlock installHandler: @escaping () -> Void) -> Bool {
    guard Self.isPresentingFullScreen else { return false }
    deferredRelaunch = installHandler
    return true
  }
}

/// The app's kill switches (src/lib/killSwitches.ts) as native code reads them: this launch's ARCADIA_SWITCHES
/// ("name=off,other=on"), else the answer the app saved from netnyahoo.com/switches.json (switches-cache.json in the
/// data dir), else on. Only `live` switches are read here: the app rewrites the file at launch and this reads it each time.
enum KillSwitch {
  static let cacheDocument = "switches-cache.json"

  static func isOn(
    _ name: String,
    environment: [String: String] = ProcessInfo.processInfo.environment,
    cache: () -> String? = { DocumentStore.read(cacheDocument) }
  ) -> Bool {
    for part in (environment["ARCADIA_SWITCHES"] ?? "").split(separator: ",") {
      let pair = part.split(separator: "=", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
      guard pair.count == 2, pair[0] == name else { continue }
      if ["off", "0", "false"].contains(pair[1]) { return false }
      if ["on", "1", "true"].contains(pair[1]) { return true }
    }
    guard let data = cache()?.data(using: .utf8),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let switches = json["switches"] as? [String: Any],
      let value = switches[name] as? NSNumber, CFGetTypeID(value) == CFBooleanGetTypeID()
    else { return true }
    return value.boolValue
  }
}

/// Runs an update Sparkle has staged for install-on-quit once, hidden, before the user launches it (main.swift's
/// ARCADIA_PREWARM: it exits before NSApp, a window or the data dir). macOS checks a copy it hasn't run at its first
/// exec, and that stays with the bundle's files through Sparkle's move into place. Sparkle's own `gktool scan` (when it
/// applies) covers Gatekeeper's scan of the bundle (4.5 s for 0.2.27 on a calm Mac); the exec also covers what only a
/// launch does (130–190 ms more before main), and all of it when Sparkle's scan didn't take
/// (docs/perf/launch-critical-path.md). Best effort: spawned off the main thread (the exec itself waits for those
/// checks), killed after `timeout` or when the app quits.
enum UpdatePrewarm {
  static let timeout: TimeInterval = 90
  private static var started = Set<String>()
  private static var running: pid_t = 0

  static func start(version: String) {
    guard !started.contains(version), let executable = stagedApp(version: version)?.executableURL else { return }
    started.insert(version)
    NotificationCenter.default.addObserver(forName: NSApplication.willTerminateNotification, object: nil, queue: .main) { _ in stop() }
    DispatchQueue.global(qos: .utility).async {
      let task = Process()
      task.executableURL = executable
      var env = ProcessInfo.processInfo.environment.filter { !$0.key.hasPrefix("ARCADIA_") && !$0.key.hasPrefix("DYLD_") }
      // Every version this updates to has it (it came with this code; Sparkle never installs an older one).
      env["ARCADIA_PREWARM"] = "1"
      task.environment = env
      task.standardInput = FileHandle.nullDevice
      task.standardOutput = FileHandle.nullDevice
      task.standardError = FileHandle.nullDevice
      let began = Date()
      task.terminationHandler = { ended in
        DispatchQueue.main.async {
          if running == ended.processIdentifier { running = 0 }
          NSLog("Arcadia: prewarmed update \(version) in \(Int(Date().timeIntervalSince(began) * 1000)) ms (status \(ended.terminationStatus))")
        }
      }
      do {
        try task.run()
      } catch {
        return NSLog("Arcadia: couldn't prewarm update \(version): \(error.localizedDescription)")
      }
      let pid = task.processIdentifier
      DispatchQueue.main.async {
        if task.isRunning { running = pid }
        DispatchQueue.main.asyncAfter(deadline: .now() + timeout) {
          guard running == pid, task.isRunning else { return }
          NSLog("Arcadia: update prewarm still running after \(Int(timeout)) s; stopping it")
          stop()
        }
      }
    }
  }

  /// Kills a prewarm still running (only ours: the pid is cleared once it has been reaped).
  static func stop() {
    guard running != 0 else { return }
    kill(running, SIGKILL)
    running = 0
  }

  /// The update Sparkle's installer extracted: ~/Library/Caches/<bundle id>/org.sparkle-project.Sparkle/Installation/
  /// <session>/…/<name>.app with our bundle id at that build number, the newest if there are several.
  static func stagedApp(version: String, bundleId: String? = Bundle.main.bundleIdentifier, root: URL? = nil) -> Bundle? {
    guard let bundleId,
      let root = root ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
        .appendingPathComponent(bundleId).appendingPathComponent("org.sparkle-project.Sparkle/Installation")
    else { return nil }
    guard let walk = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.contentModificationDateKey],
                                                     options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { return nil }
    var found: [(Bundle, Date)] = []
    for case let url as URL in walk {
      if walk.level > 4 { walk.skipDescendants(); continue }
      guard url.pathExtension == "app", let bundle = Bundle(url: url), let info = bundle.infoDictionary,
        info["CFBundleIdentifier"] as? String == bundleId, info["CFBundleVersion"] as? String == version,
        let executable = bundle.executableURL, FileManager.default.isExecutableFile(atPath: executable.path)
      else { continue }
      let date = (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
      found.append((bundle, date))
    }
    return found.max { $0.1 < $1.1 }?.0
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
