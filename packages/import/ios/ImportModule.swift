import AppKit
import ExpoModulesCore

public class ImportModule: Module {
  // Calls arrive concurrently; lazy initialization is not thread-safe.
  private let importer: Importer = {
    let env = ProcessInfo.processInfo.environment
    let support = env["ARCADIA_IMPORT_SOURCE_DIR"].map { URL(fileURLWithPath: $0, isDirectory: true) }
      ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    let icons = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("\(Bundle.main.bundleIdentifier ?? "Arcadia")/ImportIcons", isDirectory: true)
    return Importer(discovery: BrowserDiscovery(
      applicationSupport: support,
      locateApp: AppIcons.locate,
      iconFor: { app, id in AppIcons.png(for: app, id: id, directory: icons) }
    ))
  }()

  // Safari's home folder; a test instance pointed at fixtures (ARCADIA_IMPORT_SOURCE_DIR = <home>/Library/Application
  // Support) reads Safari's data from that fixture home too, never the user's.
  private static let safariHome: URL = {
    let env = ProcessInfo.processInfo.environment
    if let home = env["ARCADIA_IMPORT_SAFARI_HOME"] { return URL(fileURLWithPath: home, isDirectory: true) }
    if let support = env["ARCADIA_IMPORT_SOURCE_DIR"] {
      return URL(fileURLWithPath: support, isDirectory: true).deletingLastPathComponent().deletingLastPathComponent()
    }
    return FileManager.default.homeDirectoryForCurrentUser
  }()

  private static let secret: Importer.SecretProvider = {
    if let fixed = ProcessInfo.processInfo.environment["ARCADIA_IMPORT_TEST_SECRET"] {
      return { _, _ in Data(fixed.utf8) }
    }
    return SafeStorageKeychain.secret
  }()

  private static let diaBundleId = ProcessInfo.processInfo.environment["ARCADIA_IMPORT_DIA_BUNDLE_ID"] ?? DiaAutomation.bundleIdentifier

  private let jobs = ImportJobs()
  private let vault = ImportVault()
  private static let work = DispatchQueue(label: "arcadia.import", qos: .userInitiated, attributes: .concurrent)

  public func definition() -> ModuleDefinition {
    Name("ArcadiaImport")
    Events("onImportEvent")

    AsyncFunction("listBrowsers") { (promise: Promise) in
      self.run(promise) { try Self.json(self.importer.discovery.list()) }
    }

    AsyncFunction("importData") { (jobId: String, browserId: String, profileId: String, kinds: [String], options: [String: Any], promise: Promise) in
      let cancellation = self.jobs.start(jobId)
      let observer = self.observer(jobId: jobId, options: options)
      let parsed = kinds.compactMap(ImportKind.init(rawValue:))
      self.run(promise, job: jobId) {
        var result = try self.importer.importData(browserId: browserId, profileId: profileId, kinds: parsed,
                                                  options: Self.options(options), observer: observer, cancellation: cancellation)
        result.vaultToken = self.vault.keep(cookies: result.cookies, addresses: result.addresses, cards: result.cards)
        return try Self.json(result)
      }
    }

    Function("cancelImport") { (jobId: String) in self.jobs.cancel(jobId) }

    AsyncFunction("unlockBrowser") { (browserId: String, primaryPassword: String?, promise: Promise) in
      self.run(promise) {
        try self.importer.unlock(browserId: browserId, primaryPassword: primaryPassword ?? "", secret: Self.secret)
        return nil
      }
    }

    Function("isBrowserUnlocked") { (browserId: String) -> Bool in self.importer.isUnlocked(browserId) }
    Function("forgetUnlockedKeys") {
      self.importer.forgetKeys()
      self.vault.discardAll()
    }

    // Writes what an import kept natively (cookies, addresses, cards) into the app's profile `profile` (its engine
    // name), so cookie values and card numbers never reach JS. The token works once.
    AsyncFunction("writeImported") { (token: String, profile: String, kinds: [String], promise: Promise) in
      guard let entry = self.vault.take(token) else { return promise.reject("notFound", "Nothing to write; import again") }
      Task { @MainActor in
        promise.resolve(await ImportWriter.write(entry, profile: profile, kinds: Set(kinds)))
      }
    }

    Function("discardImported") { (token: String) in self.vault.discard(token) }

    // The source profile's Chrome Web Store extensions, for the app to offer on the Web Store (nothing is installed).
    AsyncFunction("listExtensions") { (browserId: String, profileId: String, promise: Promise) in
      self.run(promise) {
        guard let def = BrowserDefinition.find(browserId), def.isChromiumBased else { return "[]" }
        return try Self.json(ChromiumExtensions.list(profile: try self.importer.discovery.profileDirectory(def, profileId)))
      }
    }

    AsyncFunction("importSafariExport") { (jobId: String, path: String, promise: Promise) in
      let cancellation = self.jobs.start(jobId)
      self.run(promise, job: jobId) {
        var data = try SafariExport.load(Self.fileURL(path), cancellation: cancellation)
        data.vaultToken = self.vault.keep(cookies: data.cookies, addresses: [], cards: data.cards)
        return try Self.json(data)
      }
    }

    Function("safariHasFullDiskAccess") { () -> Bool in SafariDirect.hasAccess(home: Self.safariHome) }

    AsyncFunction("openFullDiskAccessSettings") { (promise: Promise) in
      let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")!
      NSWorkspace.shared.open(url)
      promise.resolve(nil)
    }.runOnQueue(.main)

    AsyncFunction("importSafariDirect") { (jobId: String, promise: Promise) in
      let cancellation = self.jobs.start(jobId)
      self.run(promise, job: jobId) {
        var data = try SafariDirect.load(home: Self.safariHome, cancellation: cancellation)
        data.vaultToken = self.vault.keep(cookies: data.cookies, addresses: [], cards: data.cards)
        return try Self.json(data)
      }
    }

    AsyncFunction("diaAutomationStatus") { (promise: Promise) in
      self.run(promise) { try Self.json(DiaAutomation.status(Self.diaBundleId, ask: false)) }
    }

    AsyncFunction("requestDiaAutomation") { (promise: Promise) in
      self.run(promise) { try Self.json(DiaAutomation.status(Self.diaBundleId, ask: true)) }
    }

    AsyncFunction("openAutomationSettings") { (promise: Promise) in
      NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation")!)
      promise.resolve(nil)
    }.runOnQueue(.main)

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

    AsyncFunction("chooseImportFile") { (kind: String, promise: Promise) in
      let panel = NSOpenPanel()
      panel.allowsMultipleSelection = false
      switch kind {
      case "safariExport":
        panel.canChooseDirectories = true
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
