import AppKit
import ExpoModulesCore

/// Thin Expo glue over the pure-Swift import core (ios/Core). Results cross the bridge as
/// JSON strings, which the TS wrapper parses: one string is far cheaper than converting a
/// 100k-entry history into NSDictionaries.
public class ImportModule: Module {
  // Not lazy: calls arrive on a concurrent queue, and lazy initialisation isn't thread-safe.
  private let importer: Importer = {
    let env = ProcessInfo.processInfo.environment
    // Dev override so the flow can run against packages/import/fixtures/home/Library/Application
    // Support instead of the real browsers' data.
    let support = env["NETNYAHOO_IMPORT_SOURCE_DIR"].map { URL(fileURLWithPath: $0, isDirectory: true) }
      ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    let icons = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("\(Bundle.main.bundleIdentifier ?? "Netnyahoo")/ImportIcons", isDirectory: true)
    return Importer(discovery: BrowserDiscovery(
      applicationSupport: support,
      locateApp: AppIcons.locate,
      iconFor: { app, id in AppIcons.png(for: app, id: id, directory: icons) }
    ))
  }()

  /// Dev override: a fixed "Safe Storage" secret instead of the Keychain (fixtures use
  /// "netnyahoo-fixture-secret"), so testing the unlock flow never touches the real Keychain.
  private static let secret: Importer.SecretProvider = {
    if let fixed = ProcessInfo.processInfo.environment["NETNYAHOO_IMPORT_TEST_SECRET"] {
      return { _, _ in Data(fixed.utf8) }
    }
    return SafeStorageKeychain.secret
  }()

  /// Dev override: send the Dia tab import's Apple Events to another scriptable app (a stand-in
  /// with Dia's dictionary) instead of Dia.
  private static let diaBundleId = ProcessInfo.processInfo.environment["NETNYAHOO_IMPORT_DIA_BUNDLE_ID"] ?? DiaAutomation.bundleIdentifier

  private let jobs = ImportJobs()
  private static let work = DispatchQueue(label: "netnyahoo.import", qos: .userInitiated, attributes: .concurrent)

  public func definition() -> ModuleDefinition {
    Name("NetnyahooImport")
    Events("onImportEvent")

    /// Installed browsers, their profiles (and Arc spaces). No data is read, no prompts.
    AsyncFunction("listBrowsers") { (promise: Promise) in
      self.run(promise) { try Self.json(self.importer.discovery.list()) }
    }

    AsyncFunction("importData") { (jobId: String, browserId: String, profileId: String, kinds: [String], options: [String: Any], promise: Promise) in
      let cancellation = self.jobs.start(jobId)
      let observer = self.observer(jobId: jobId, options: options)
      let parsed = kinds.compactMap(ImportKind.init(rawValue:))
      self.run(promise, job: jobId) {
        try Self.json(self.importer.importData(browserId: browserId, profileId: profileId, kinds: parsed,
                                               options: Self.options(options), observer: observer, cancellation: cancellation))
      }
    }

    Function("cancelImport") { (jobId: String) in self.jobs.cancel(jobId) }

    /// The consented unlock. Chromium family: macOS asks for the login password to release
    /// "<Browser> Safe Storage" (the promise stays pending while the dialog is up). Firefox:
    /// records consent and an optional primary password. Rejects with code "locked" on denial.
    AsyncFunction("unlockBrowser") { (browserId: String, primaryPassword: String?, promise: Promise) in
      self.run(promise) {
        try self.importer.unlock(browserId: browserId, primaryPassword: primaryPassword ?? "", secret: Self.secret)
        return nil
      }
    }

    Function("isBrowserUnlocked") { (browserId: String) -> Bool in self.importer.isUnlocked(browserId) }
    Function("forgetUnlockedKeys") { self.importer.forgetKeys() }

    AsyncFunction("importSafariExport") { (jobId: String, path: String, promise: Promise) in
      let cancellation = self.jobs.start(jobId)
      self.run(promise, job: jobId) { try Self.json(SafariExport.load(Self.fileURL(path), cancellation: cancellation)) }
    }

    /// Whether Netnyahoo can read Safari's data straight from `~/Library/Safari` (i.e. it has
    /// Full Disk Access). No prompt; the UI polls this to switch between the direct path and
    /// the export `.zip`.
    Function("safariHasFullDiskAccess") { () -> Bool in SafariDirect.hasAccess() }

    /// Opens System Settings › Privacy & Security › Full Disk Access so the user can grant it.
    AsyncFunction("openFullDiskAccessSettings") { (promise: Promise) in
      let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")!
      NSWorkspace.shared.open(url)
      promise.resolve(nil)
    }.runOnQueue(.main)

    /// Reads Safari's live bookmarks, history, Reading List and open tabs directly. Requires
    /// Full Disk Access (rejects with code "locked" otherwise); passwords/cards still need the
    /// export `.zip`.
    AsyncFunction("importSafariDirect") { (jobId: String, promise: Promise) in
      let cancellation = self.jobs.start(jobId)
      self.run(promise, job: jobId) { try Self.json(SafariDirect.load(cancellation: cancellation)) }
    }

    /// Dia's tabs through its AppleScript interface. Whether Dia is installed and running and
    /// whether macOS lets Netnyahoo send it Apple Events; never shows the consent prompt.
    AsyncFunction("diaAutomationStatus") { (promise: Promise) in
      self.run(promise) { try Self.json(DiaAutomation.status(Self.diaBundleId, ask: false)) }
    }

    /// Shows macOS's "Netnyahoo wants to control Dia" prompt if the user hasn't answered it yet
    /// (the promise waits for the answer), then resolves with the status.
    AsyncFunction("requestDiaAutomation") { (promise: Promise) in
      self.run(promise) { try Self.json(DiaAutomation.status(Self.diaBundleId, ask: true)) }
    }

    /// Opens System Settings › Privacy & Security › Automation.
    AsyncFunction("openAutomationSettings") { (promise: Promise) in
      NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation")!)
      promise.resolve(nil)
    }.runOnQueue(.main)

    /// Launches Dia in the background (the import window stays in front). Resolves once it runs.
    AsyncFunction("openDia") { (promise: Promise) in
      guard let app = NSWorkspace.shared.urlForApplication(withBundleIdentifier: Self.diaBundleId) else {
        return promise.reject("notFound", "Dia isn't installed")
      }
      let config = NSWorkspace.OpenConfiguration()
      config.activates = false
      NSWorkspace.shared.openApplication(at: app, configuration: config) { _, error in
        if let error { promise.reject("unreadable", error.localizedDescription) } else { promise.resolve(nil) }
      }
    }.runOnQueue(.main)

    /// Dia's profiles with their pinned and open tabs, deduplicated (`DiaTabsImport`). Rejects
    /// with "notRunning", "locked" (Automation denied) or "unreadable" (Dia didn't answer).
    AsyncFunction("readDiaTabs") { (promise: Promise) in
      self.run(promise) {
        guard DiaAutomation.isRunning(Self.diaBundleId) else { throw ImportError.notRunning("Dia isn't running") }
        return try Self.json(DiaTabsImport.read(from: DiaAppleEvents(bundleIdentifier: Self.diaBundleId)))
      }
    }

    AsyncFunction("importBookmarksHTML") { (path: String, promise: Promise) in
      self.run(promise) { try Self.json(NetscapeBookmarks.load(Self.fileURL(path))) }
    }

    AsyncFunction("importPasswordsCSV") { (path: String, promise: Promise) in
      self.run(promise) { try Self.json(PasswordsCSV.load(Self.fileURL(path))) }
    }

    /// Open panel for the file-based imports ("Choose .zip file"). Resolves with a path or nil.
    AsyncFunction("chooseImportFile") { (kind: String, promise: Promise) in
      let panel = NSOpenPanel()
      panel.allowsMultipleSelection = false
      switch kind {
      case "safariExport":
        panel.canChooseDirectories = true  // "Please select a folder or zip file."
        panel.allowedContentTypes = [.zip]
      case "bookmarksHTML":
        panel.allowedContentTypes = [.html]
      default:
        panel.allowedContentTypes = [.commaSeparatedText]
      }
      panel.begin { response in promise.resolve(response == .OK ? panel.url?.path : nil) }
    }.runOnQueue(.main)
  }

  // MARK: Helpers

  private func run(_ promise: Promise, job: String? = nil, _ body: @escaping () throws -> String?) {
    Self.work.async { [jobs] in
      defer { if let job { jobs.finish(job) } }
      do {
        promise.resolve(try body())
      } catch let error as ImportError {
        promise.reject(error.code, error.description)
      } catch {
        promise.reject("unreadable", error.localizedDescription)
      }
    }
  }

  private func observer(jobId: String, options: [String: Any]) -> ImportObserver {
    let stream = options["streamHistory"] as? Bool ?? false
    let emit: @Sendable ([String: Any?]) -> Void = { [weak self] body in self?.sendEvent("onImportEvent", body) }
    let progress: @Sendable (ImportProgress) -> Void = { p in
      var body: [String: Any?] = ["jobId": jobId, "type": "progress", "kind": p.kind.rawValue,
                                  "phase": p.phase.rawValue, "processed": p.processed]
      if let total = p.total { body["total"] = total }
      emit(body)
    }
    var history: (@Sendable ([HistoryEntry]) -> Void)?
    if stream {
      history = { chunk in emit(["jobId": jobId, "type": "history", "entries": (try? Self.json(chunk)) ?? "[]"]) }
    }
    return ImportObserver(chunkSize: options["chunkSize"] as? Int ?? 1000, progress: progress, history: history)
  }

  static func options(_ o: [String: Any]) -> ImportOptions {
    ImportOptions(
      historyLimit: (o["historyLimit"] as? NSNumber)?.intValue,
      historySince: (o["historySince"] as? NSNumber)?.doubleValue,
      spaceIds: (o["spaceIds"] as? [String]).map(Set.init),
      streamHistory: o["streamHistory"] as? Bool ?? false
    )
  }

  static func fileURL(_ path: String) -> URL {
    if path.hasPrefix("file://"), let url = URL(string: path) { return url }
    return URL(fileURLWithPath: (path as NSString).expandingTildeInPath)
  }

  static func json<T: Encodable>(_ value: T) throws -> String {
    String(decoding: try JSONEncoder().encode(value), as: UTF8.self)
  }
}

/// In-flight jobs, so `cancelImport` can reach the parser loop of a running import.
final class ImportJobs: @unchecked Sendable {
  private let lock = NSLock()
  private var running: [String: Cancellation] = [:]

  func start(_ id: String) -> Cancellation {
    let c = Cancellation()
    lock.withLock { running[id] = c }
    return c
  }

  func cancel(_ id: String) { lock.withLock { running[id] }?.cancel() }
  func finish(_ id: String) { lock.withLock { running[id] = nil } }
}
