// LEGACY NAMES. Arcadia was called Netnyahoo until 0.2.32 (bundle id com.netnyahoo.browser). This is the only Swift
// file that may spell the old names: everything an older build persisted under them, and the one-time migration that
// brings an updated install's data across (run from main.swift before Chromium, React Native or Sparkle start).
// It's in sync's Core because sync's wire format keeps two of them for good (SyncCrypto.swift), and Core is plain
// Swift: the pod builds it into the app and ../../Package.swift tests it on its own.
import AppKit
import Foundation
import Security

public enum LegacyName {
  public static let bundleId = "com.netnyahoo.browser"
  /// The installed app's file name. Sparkle finds the new app in an update archive only under the installed bundle's
  /// name (Sparkle 2.9.6 SUInstaller.m), so the update archive's top folder keeps it (scripts/release.sh reads this
  /// line) and Sparkle installs it there under that name; at its first launch the app renames itself to Arcadia.app
  /// (LegacyMigration.moveToNewName).
  public static let appFileName = "Netnyahoo.app"
  public static let appName = "Netnyahoo"

  // Sync's wire format, shared with every Mac on any version: frozen (SyncCrypto.swift).
  public static let syncMagic = "NNS1"
  public static let syncSalt = "netnyahoo-sync/v1"
}

// MARK: - What was renamed

enum Renamed {
  struct KeychainItem {
    let oldService: String
    let newService: String
    /// nil: every account of the service, kept as it is.
    let account: (old: String, new: String)?
    let label: (String) -> String
    let accessible: CFString?
    /// The key every saved password and cookie is encrypted with: without it they're gone.
    let critical: Bool
  }

  static let safeStorage = KeychainItem(
    oldService: "Netnyahoo Safe Storage", newService: "Arcadia Safe Storage", account: ("Netnyahoo", "Arcadia"),
    label: { _ in "Arcadia Safe Storage" }, accessible: nil, critical: true)
  static let connectedAccounts = KeychainItem(
    oldService: "Netnyahoo Connected Accounts", newService: "Arcadia Connected Accounts", account: nil,
    label: { "Arcadia: \($0)" }, accessible: nil, critical: false)
  static let syncKey = KeychainItem(
    oldService: "Netnyahoo Sync Key", newService: "Arcadia Sync Key", account: nil,
    label: { _ in "Arcadia Sync Key" }, accessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly, critical: false)
  static let keychain = [safeStorage, connectedAccounts, syncKey]

  /// Paths in the data folder (relative to it; a "*" component is any one name) whose last component changed.
  static let paths: [(old: String, new: String)] = [
    ("Chromium/NetnyahooPictureInPicture.plist", "Chromium/ArcadiaPictureInPicture.plist"),
    ("Chromium/NativeMessagingHosts/.netnyahoo-managed.json", "Chromium/NativeMessagingHosts/.arcadia-managed.json"),
    ("Chromium/*/Netnyahoo Favicons", "Chromium/*/Arcadia Favicons"),
  ]

  /// JSON object keys, wherever they are: settings (session.json, synced), settings.shortcuts' command ids, and the
  /// bookmark sync key Chrome keeps in a node's meta_info (Bookmarks).
  static let jsonKeys = [
    "openLinksInSmallYahu": "openLinksInLittleArcadia",
    "smallYahuSize": "littleArcadiaSize",
    "newSmallYahu": "newLittleArcadia",
    "toggleOpenLinksInSmallYahu": "toggleOpenLinksInLittleArcadia",
    "nn_sync_key": "ac_sync_key",
  ]

  /// URL prefixes, matched case-insensitively at the start of a string, in order; a host must end there.
  static let urls: [(old: String, new: String)] = [
    ("netnyahoo://yahu", "arcadia://game"),
    ("chrome://yahu", "chrome://game"),
    ("netnyahoo://", "arcadia://"),
  ]

  static let defaultsKeys = [
    "NNAppIcon": "ACAppIcon",
    "NNPictureInPictureKeepOnTop": "ACPictureInPictureKeepOnTop",
    "NNPictureInPictureZoom": "ACPictureInPictureZoom",
    "NNUpdateFeedURL": "ACUpdateFeedURL",
  ]
  static let defaultsKeyPrefixes = [("NSWindow Frame Netnyahoo", "NSWindow Frame Arcadia")]
  /// Menu titles in NSUserKeyEquivalents (shortcuts set in System Settings › Keyboard).
  static let menuTitleWords = [("Small Yahu", "Little Arcadia"), ("Netnyahoo", "Arcadia")]
}

// MARK: - Seams (the real Library and keychain, or a test instance's fakes)

enum SecretRead: Equatable {
  case found(Data)
  case missing
  case denied
  case failed(OSStatus)
}

protocol SecretStore {
  /// The item's accounts, from attributes only: no data is read, so macOS asks nothing. nil: the keychain failed.
  func accounts(service: String) -> [String]?
  func read(service: String, account: String) -> SecretRead
  /// Leaves exactly `data` in the item, adding it if it isn't there.
  func write(service: String, account: String, label: String, accessible: CFString?, data: Data) -> Bool
}

/// The login keychain (the file keychain Chrome and the app's SecItem calls use; no access group).
struct LoginKeychain: SecretStore {
  private func query(_ service: String, _ account: String?) -> [String: Any] {
    var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
    if let account { q[kSecAttrAccount as String] = account }
    return q
  }

  func accounts(service: String) -> [String]? {
    var q = query(service, nil)
    q[kSecReturnAttributes as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitAll
    var result: CFTypeRef?
    let status = SecItemCopyMatching(q as CFDictionary, &result)
    if status == errSecItemNotFound { return [] }
    guard status == errSecSuccess else { return nil }
    let items = (result as? [[String: Any]]) ?? []
    return Array(Set(items.compactMap { $0[kSecAttrAccount as String] as? String })).sorted()
  }

  func read(service: String, account: String) -> SecretRead {
    var q = query(service, account)
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(q as CFDictionary, &result)
    switch status {
    case errSecSuccess: return (result as? Data).map(SecretRead.found) ?? .failed(status)
    case errSecItemNotFound: return .missing
    case errSecUserCanceled, errSecAuthFailed, errSecInteractionNotAllowed: return .denied
    default: return .failed(status)
    }
  }

  func write(service: String, account: String, label: String, accessible: CFString?, data: Data) -> Bool {
    let match = query(service, account)
    let status = SecItemUpdate(match as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if status == errSecSuccess { return true }
    guard status == errSecItemNotFound else { return false }
    var add = match
    add[kSecValueData as String] = data
    add[kSecAttrLabel as String] = label
    if let accessible { add[kSecAttrAccessible as String] = accessible }
    return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
  }
}

/// A fake keychain for tests: {"service": {"account": "<base64>"}}; services listed under "denied" refuse reads.
struct SecretFile: SecretStore {
  let url: URL

  private func load() -> [String: Any] {
    guard let data = try? Data(contentsOf: url) else { return [:] }
    return ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any]) ?? [:]
  }

  func accounts(service: String) -> [String]? { ((load()[service] as? [String: String]) ?? [:]).keys.sorted() }

  func read(service: String, account: String) -> SecretRead {
    let all = load()
    if (all["denied"] as? [String])?.contains(service) == true { return .denied }
    guard let encoded = (all[service] as? [String: String])?[account] else { return .missing }
    return Data(base64Encoded: encoded).map(SecretRead.found) ?? .failed(errSecDecode)
  }

  func write(service: String, account: String, label: String, accessible: CFString?, data: Data) -> Bool {
    var all = load()
    var items = (all[service] as? [String: String]) ?? [:]
    items[account] = data.base64EncodedString()
    all[service] = items
    return MigrationFiles.writeDurably(try? JSONSerialization.data(withJSONObject: all, options: [.sortedKeys]), to: url, mode: 0o600)
  }
}

/// A test instance's secrets where its readers look (Keychain.swift's IsolatedSecrets, FileKeyStore), and the Safe
/// Storage key (which a test instance's engine doesn't use: it runs on the mock keychain) in legacy-keychain.json.
struct IsolatedSecretStores: SecretStore {
  let dataDirectory: URL
  private var accountsFile: URL { dataDirectory.appendingPathComponent("Connected Accounts.json") }
  private var others: SecretFile { SecretFile(url: dataDirectory.appendingPathComponent("legacy-keychain.json")) }

  private func connectedAccounts() -> [String: String] {
    guard let data = try? Data(contentsOf: accountsFile) else { return [:] }
    return (try? JSONDecoder().decode([String: String].self, from: data)) ?? [:]
  }

  func accounts(service: String) -> [String]? {
    switch service {
    case Renamed.connectedAccounts.newService: return connectedAccounts().keys.sorted()
    case Renamed.syncKey.newService:
      let names = (try? FileManager.default.contentsOfDirectory(atPath: dataDirectory.path)) ?? []
      return names.filter { $0.hasPrefix("sync-key-") }.map { String($0.dropFirst("sync-key-".count)) }.sorted()
    default: return others.accounts(service: service)
    }
  }

  func read(service: String, account: String) -> SecretRead {
    switch service {
    case Renamed.connectedAccounts.newService:
      return connectedAccounts()[account].map { .found(Data($0.utf8)) } ?? .missing
    case Renamed.syncKey.newService:
      return FileKeyStore(directory: dataDirectory).load(account: account).map(SecretRead.found) ?? .missing
    default: return others.read(service: service, account: account)
    }
  }

  func write(service: String, account: String, label: String, accessible: CFString?, data: Data) -> Bool {
    switch service {
    case Renamed.connectedAccounts.newService:
      guard let secret = String(data: data, encoding: .utf8) else { return false }
      var all = connectedAccounts()
      all[account] = secret
      return MigrationFiles.writeDurably(try? JSONEncoder().encode(all), to: accountsFile, mode: 0o600)
    case Renamed.syncKey.newService:
      return FileKeyStore(directory: dataDirectory).save(data, account: account)
    default:
      return others.write(service: service, account: account, label: label, accessible: accessible, data: data)
    }
  }
}

/// One preferences domain, its own persistent values only: a bundle id, or a plist's absolute path without
/// ".plist" (a test instance's, ACIsolation.m). CFPreferences, not NSUserDefaults: ACIsolation swizzles the latter.
struct PreferencesDomain {
  let id: String

  func all() -> [String: Any] {
    guard let keys = CFPreferencesCopyKeyList(id as CFString, kCFPreferencesCurrentUser, kCFPreferencesAnyHost) as? [String],
      !keys.isEmpty else { return [:] }
    return (CFPreferencesCopyMultiple(keys as CFArray, id as CFString, kCFPreferencesCurrentUser, kCFPreferencesAnyHost)
      as? [String: Any]) ?? [:]
  }

  func has(_ key: String) -> Bool {
    CFPreferencesCopyValue(key as CFString, id as CFString, kCFPreferencesCurrentUser, kCFPreferencesAnyHost) != nil
  }

  @discardableResult
  func set(_ values: [String: Any]) -> Bool {
    guard !values.isEmpty else { return true }
    CFPreferencesSetMultiple(values as CFDictionary, nil, id as CFString, kCFPreferencesCurrentUser, kCFPreferencesAnyHost)
    return CFPreferencesSynchronize(id as CFString, kCFPreferencesCurrentUser, kCFPreferencesAnyHost)
  }
}

/// Chrome's own keychain items (Chrome-profile passkeys, device-bound session keys, payment confirmation keys) live
/// in the data protection keychain under access groups named after the bundle id, and Chrome only ever reads its
/// configured group (device/fido/mac/credential_store.mm). Secure Enclave keys can't be copied, so they're moved:
/// SecItemUpdate of kSecAttrAccessGroup, which needs both groups in the app's keychain-access-groups entitlement.
protocol AccessGroupMover {
  func entitled(to groups: [String]) -> Bool
  /// How many items moved; a failure's status if any didn't.
  func move(from old: String, to new: String) -> (moved: Int, failure: OSStatus?)
}

struct KeychainAccessGroups: AccessGroupMover {
  static let suffixes = ["webauthn", "unexportable-keys", "secure-payment-confirmation"]

  func entitled(to groups: [String]) -> Bool {
    guard let task = SecTaskCreateFromSelf(nil),
      let value = SecTaskCopyValueForEntitlement(task, "keychain-access-groups" as CFString, nil) as? [String] else { return false }
    return groups.allSatisfy(value.contains)
  }

  func move(from old: String, to new: String) -> (moved: Int, failure: OSStatus?) {
    var moved = 0
    var failure: OSStatus?
    for itemClass in [kSecClassKey, kSecClassGenericPassword] {
      let query: [String: Any] = [
        kSecClass as String: itemClass, kSecAttrAccessGroup as String: old, kSecUseDataProtectionKeychain as String: true,
      ]
      var count = query
      count[kSecMatchLimit as String] = kSecMatchLimitAll
      count[kSecReturnAttributes as String] = true
      var found: CFTypeRef?
      let status = SecItemCopyMatching(count as CFDictionary, &found)
      if status == errSecItemNotFound { continue }
      guard status == errSecSuccess else {
        failure = status
        continue
      }
      // The filter isn't exact (credential_store.mm): count only the old group's own.
      let items = ((found as? [[String: Any]]) ?? []).filter { $0[kSecAttrAccessGroup as String] as? String == old }
      guard !items.isEmpty else { continue }
      let updated = SecItemUpdate(query as CFDictionary, [kSecAttrAccessGroup as String: new] as CFDictionary)
      if updated == errSecSuccess { moved += items.count } else { failure = updated }
    }
    return (moved, failure)
  }
}

/// Asks the user, before the app has an NSApp (Chrome makes its own): a CFUserNotification alert. Returns the
/// chosen button's index, or nil when nobody can be asked (a hidden test instance).
typealias Ask = (_ title: String, _ message: String, _ buttons: [String]) -> Int?

// MARK: - The migration

struct LegacyMigrator {
  struct Context {
    /// The old app's data folder (its documents and Chromium/) and the new one.
    var oldData: URL
    var newData: URL
    /// Best-effort extras copied once (Chrome's disk cache, NSURLSession's storage): (old, new) pairs.
    var extras: [(URL, URL)] = []
    var oldDefaults: PreferencesDomain
    var newDefaults: PreferencesDomain
    /// nil: this build doesn't use the login keychain (ad hoc), so there's nothing to carry.
    var oldSecrets: SecretStore?
    var newSecrets: SecretStore?
    /// Chrome's keychain access groups, old → new, and what moves them; nil where there are none (a test instance).
    var accessGroups: [(old: String, new: String)] = []
    var groupMover: AccessGroupMover? = nil
    var oldAppRunning: () -> Bool
    /// The old app was the default browser: the bundle id changed, so macOS no longer counts this one as it.
    var oldAppWasDefaultBrowser: () -> Bool = { false }
    var ask: Ask
    /// Test hook: stop as if the process died right after this step.
    var crashAfter: String? = nil
  }

  enum Outcome: Equatable {
    case proceed
    case quit
  }

  struct Journal: Codable, Equatable {
    var version = 1
    /// "publishing" once the verified copy starts moving in; "done" at the end.
    var phase: String
    /// migrated, nothing (no old data), existing (the new folder already had data), fresh (the user chose to start
    /// without the old data).
    var outcome: String?
    var files: Int?
    var secrets: [String: String]?
    /// Chrome's keychain access groups: "moved <n>", "none", or "pending" while this build isn't entitled to the old
    /// ones or a move failed (each launch tries again until it's done).
    var groups: String?
    var groupAttempts: Int?
    /// Whether the old app was the default browser when this install first ran under the new id: "offered" (the app
    /// asks once to be the default again) or "no". Missing from journals written before it was asked: such an install
    /// answers it at its next launch.
    var defaultBrowser: String?
    var finishedAt: Date?

    var isDone: Bool { phase == "done" && groups != "pending" && defaultBrowser != nil }
  }

  static let journalName = ".legacy-migration.json"
  /// Left for the app (apps/browser/src/lib/defaultBrowserOffer.ts) when the old app was the default browser: it asks
  /// once to be the default again, and records when in the same document.
  static let defaultBrowserOfferName = "default-browser-offer.json"
  static let stagingName = ".legacy-migration-staging"
  static let lockName = ".legacy-migration.lock"
  static let asideName = ".legacy-migration-replaced"

  let context: Context
  private let fm = FileManager.default

  init(_ context: Context) { self.context = context }

  var journalURL: URL { context.newData.appendingPathComponent(Self.journalName) }
  var stagingURL: URL { context.newData.appendingPathComponent(Self.stagingName) }

  func readJournal() -> Journal? {
    guard let data = try? Data(contentsOf: journalURL) else { return nil }
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    return try? decoder.decode(Journal.self, from: data)
  }

  /// One stat and a small read on every launch after the first.
  var isDone: Bool { readJournal()?.isDone == true }

  func run() -> Outcome {
    if isDone { return .proceed }
    do {
      try fm.createDirectory(at: context.newData, withIntermediateDirectories: true)
    } catch {
      log("can't make \(context.newData.path): \(error)")
      return .proceed
    }
    // One migrator at a time (two copies launched at once): the second waits, then finds it done. One that can't
    // take the lock (or waits ten minutes: the first is stuck on a question) quits; the next launch tries again.
    let lock = open(context.newData.appendingPathComponent(Self.lockName).path, O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, 0o600)
    guard lock >= 0 else {
      log("can't open the migration lock: \(String(cString: strerror(errno)))")
      return .quit
    }
    defer { close(lock) }
    let deadline = Date().addingTimeInterval(600)
    while flock(lock, LOCK_EX | LOCK_NB) != 0 {
      guard errno == EWOULDBLOCK || errno == EINTR, Date() < deadline else {
        log("another launch is migrating; quitting")
        return .quit
      }
      usleep(200_000)
    }
    defer { flock(lock, LOCK_UN) }
    return runLocked()
  }

  private func runLocked() -> Outcome {
    let journal = readJournal()
    if var done = journal, done.phase == "done" {
      if done.defaultBrowser == nil, let answer = checkDefaultBrowser() {
        done.defaultBrowser = answer
        if done.groups != "pending", !writeJournal(done) { log("couldn't record the default browser offer") }
      }
      if done.groups == "pending" {
        done.groupAttempts = (done.groupAttempts ?? 1) + 1
        done.groups = moveAccessGroups()
        // A move that keeps failing stops costing launches.
        if done.groups == "pending", done.groupAttempts! >= 5, context.groupMover?.entitled(to: context.accessGroups.flatMap { [$0.old, $0.new] }) == true {
          done.groups = "failed"
        }
        if !writeJournal(done) { log("couldn't record the keychain groups") }
      }
      return .proceed
    }
    // A crash while the verified copy was moving in: finish moving it, then the rest.
    if let publishing = journal, publishing.phase == "publishing" {
      return publishOrQuit() ? finish(publishing) : .quit
    }
    guard exists(context.oldData) else {
      return finish(Journal(phase: "done", outcome: "nothing"))
    }
    if hasData(context.newData) {
      log("\(context.newData.path) already has data; leaving it and \(context.oldData.path) as they are")
      return finish(Journal(phase: "done", outcome: "existing"))
    }
    var files = 0
    while true {
      while context.oldAppRunning() {
        let choice = context.ask(
          "Quit \(LegacyName.appName) to continue",
          "Arcadia is the new name of \(LegacyName.appName). Quit \(LegacyName.appName), then click Continue to bring your tabs, passwords and settings across.",
          ["Continue", "Quit"])
        if choice != 0 { return .quit }
      }
      do {
        files = try stage()
        // Opened again while we copied: the copy may be torn (a database mid-write). Start over once it's quit.
        if context.oldAppRunning() {
          try? fm.removeItem(at: stagingURL)
          continue
        }
        break
      } catch {
        log("couldn't copy \(context.oldData.path): \(error)")
        try? fm.removeItem(at: stagingURL)
        let choice = context.ask(
          "Arcadia couldn't bring your data across",
          "Copying your data from \(LegacyName.appName) failed (\(error.localizedDescription)). Nothing was changed. You can try again, quit, or start Arcadia without it; \(LegacyName.appName)'s data stays where it is.",
          ["Try Again", "Quit", "Start Without It"])
        if choice == 0 { continue }
        if choice == 2 { return finish(Journal(phase: "done", outcome: "fresh")) }
        return .quit
      }
    }
    if crash("staged") { return .quit }

    var secrets: [String: String] = [:]
    if let old = context.oldSecrets, let new = context.newSecrets {
      for item in Renamed.keychain {
        switch copySecrets(item, from: old, to: new) {
        case let .copied(results): secrets.merge(results) { $1 }
        case .quit:
          try? fm.removeItem(at: stagingURL)
          return .quit
        case .startFresh:
          // Never the copied profile without its key: Chrome would make a new one and drop every password and cookie.
          try? fm.removeItem(at: stagingURL)
          return finish(Journal(phase: "done", outcome: "fresh"))
        }
      }
    }
    if crash("secrets") { return .quit }

    let publishing = Journal(phase: "publishing", outcome: "migrated", files: files, secrets: secrets)
    // Can't record it: the disk is in trouble. Nothing has moved; the next launch starts over.
    guard writeJournal(publishing) else {
      log("couldn't write the journal")
      try? fm.removeItem(at: stagingURL)
      return .quit
    }
    if crash("journal") { return .quit }
    guard publishOrQuit() else { return .quit }
    if crash("published") { return .quit }
    return finish(publishing)
  }

  /// The app never starts on a half-moved folder: it finishes moving, or quits (the next launch resumes).
  private func publishOrQuit() -> Bool {
    while true {
      do {
        try publish()
        return true
      } catch {
        log("couldn't move the data in: \(error)")
        let choice = context.ask(
          "Arcadia couldn't finish bringing your data across",
          "Moving your copied data into place failed (\(error.localizedDescription)). \(LegacyName.appName)'s data is untouched. Try again, or quit and Arcadia will finish the next time it opens.",
          ["Try Again", "Quit"])
        if choice != 0 { return false }
      }
    }
  }

  // MARK: Steps

  /// Copies the old folder into the staging folder (APFS clones: no time or space to speak of), renames and rewrites
  /// what changed name there, and checks every file arrived. The old folder is never written to.
  func stage() throws -> Int {
    if exists(stagingURL) { try fm.removeItem(at: stagingURL) }
    try fm.copyItem(at: context.oldData, to: stagingURL)
    // Chrome's profile lock names the old process; a stale one is harmless, but it isn't ours.
    for name in ["SingletonLock", "SingletonSocket", "SingletonCookie"] {
      try? fm.removeItem(at: stagingURL.appendingPathComponent("Chromium/\(name)"))
    }
    var renamed: [String: String] = [:]
    for (old, new) in expandedRenames(in: stagingURL) {
      let from = stagingURL.appendingPathComponent(old), to = stagingURL.appendingPathComponent(new)
      guard exists(from), !exists(to) else { continue }
      try fm.moveItem(at: from, to: to)
      renamed[old] = new
    }
    let rewriter = DocumentRewriter(oldData: context.oldData.path, newData: context.newData.path)
    var rewritten = Set<String>()
    for relative in documents(in: stagingURL) where try rewriter.rewriteFile(stagingURL.appendingPathComponent(relative)) {
      rewritten.insert(relative)
    }
    return try verify(renamed: renamed, rewritten: rewritten)
  }

  /// Every regular file of the old folder is in the staging one, the same size unless it was rewritten (then it
  /// still parses). Returns how many files came across.
  func verify(renamed: [String: String], rewritten: Set<String>) throws -> Int {
    var count = 0
    let base = context.oldData.standardizedFileURL.path
    guard let walk = fm.enumerator(at: context.oldData, includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey]) else {
      throw MigrationError("can't list \(base)")
    }
    for case let url as URL in walk {
      let values = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
      guard values.isRegularFile == true else { continue }
      var relative = String(url.standardizedFileURL.path.dropFirst(base.count + 1))
      if relative.hasPrefix("Chromium/Singleton") { continue }
      for (old, new) in renamed where relative == old || relative.hasPrefix(old + "/") {
        relative = new + relative.dropFirst(old.count)
      }
      let copy = stagingURL.appendingPathComponent(relative)
      let copied = try? copy.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
      guard copied?.isRegularFile == true else { throw MigrationError("\(relative) didn't copy") }
      if rewritten.contains(relative) {
        guard DocumentRewriter.parses(copy) else { throw MigrationError("\(relative) doesn't parse after rewriting") }
      } else if copied?.fileSize != values.fileSize {
        throw MigrationError("\(relative) copied short")
      }
      count += 1
    }
    return count
  }

  enum SecretsResult {
    case copied([String: String])
    case quit
    case startFresh
  }

  /// Copies one kind of keychain item. The Safe Storage key has to come across (its data is encrypted with it): if it
  /// can't, the user retries, quits (the migration stays pending), or starts without the old data at all.
  func copySecrets(_ item: Renamed.KeychainItem, from old: SecretStore, to new: SecretStore) -> SecretsResult {
    var results: [String: String] = [:]
    while true {
      guard let present = old.accounts(service: item.oldService) else {
        if item.critical {
          switch askAboutKey(item, "macOS couldn't list it") {
          case .copied: continue
          case let other: return other
          }
        }
        results["\(item.newService)/*"] = "failed"
        log("couldn't list \(item.oldService)")
        return .copied(results)
      }
      let accounts = item.account.map { present.contains($0.old) ? [$0] : [] } ?? present.map { ($0, $0) }
      var retry = false
      for (oldAccount, newAccount) in accounts {
        let key = "\(item.newService)/\(newAccount)"
        let read = old.read(service: item.oldService, account: oldAccount)
        var outcome = "\(read)"
        if case let .found(data) = read {
          let wrote = new.write(service: item.newService, account: newAccount, label: item.label(newAccount), accessible: item.accessible, data: data)
          outcome = wrote && new.read(service: item.newService, account: newAccount) == .found(data) ? "copied" : "failed"
        }
        if outcome != "copied", item.critical {
          switch askAboutKey(item, outcome) {
          case .copied:
            retry = true
          case let other: return other
          }
          break
        }
        results[key] = outcome
        if outcome != "copied" { log("\(item.oldService) (\(oldAccount)): \(outcome)") }
      }
      if !retry { return .copied(results) }
    }
  }

  private func askAboutKey(_ item: Renamed.KeychainItem, _ why: String) -> SecretsResult {
    log("\(item.oldService): \(why)")
    let choice = context.ask(
      "Arcadia needs your passwords' key",
      "To keep your saved passwords and website logins, allow Arcadia to use “\(item.oldService)” (the key \(LegacyName.appName) kept them with); choose Always Allow when macOS asks. Or start Arcadia without \(LegacyName.appName)'s data, which stays where it is.",
      ["Try Again", "Quit", "Start Without It"])
    return choice == 0 ? .copied([:]) : choice == 2 ? .startFresh : .quit
  }

  /// Moves each entry of the staging folder into the new one. Each move is atomic; a crash between them resumes here.
  /// Something already in the way (nothing the app wrote: it hasn't run on this folder) goes aside, not away.
  func publish() throws {
    if exists(stagingURL) {
      for name in try fm.contentsOfDirectory(atPath: stagingURL.path).sorted() {
        let from = stagingURL.appendingPathComponent(name), to = context.newData.appendingPathComponent(name)
        if exists(to) {
          let aside = context.newData.appendingPathComponent(Self.asideName)
          try fm.createDirectory(at: aside, withIntermediateDirectories: true)
          try fm.moveItem(at: to, to: uniqueURL(aside.appendingPathComponent(name)))
        }
        try fm.moveItem(at: from, to: to)
      }
      MigrationFiles.syncFolder(context.newData)
      try fm.removeItem(at: stagingURL)
    }
  }

  func copyDefaults() {
    var copy: [String: Any] = [:]
    for (key, value) in context.oldDefaults.all() {
      var newKey = Renamed.defaultsKeys[key] ?? key
      for (old, new) in Renamed.defaultsKeyPrefixes where newKey.hasPrefix(old) {
        newKey = new + newKey.dropFirst(old.count)
      }
      guard !context.newDefaults.has(newKey) else { continue }
      if newKey == "NSUserKeyEquivalents", let titles = value as? [String: Any] {
        copy[newKey] = Dictionary(titles.map { title, shortcut in
          (Renamed.menuTitleWords.reduce(title) { $0.replacingOccurrences(of: $1.0, with: $1.1) }, shortcut)
        }) { first, _ in first }
      } else {
        copy[newKey] = value
      }
    }
    if !context.newDefaults.set(copy) { log("couldn't save the copied preferences") }
  }

  /// Moves Chrome's keychain items to the new access groups (their metadata secret came across in the profile's
  /// prefs, so Chrome finds them there). nil when there's nothing to move.
  func moveAccessGroups() -> String? {
    guard let mover = context.groupMover, !context.accessGroups.isEmpty else { return nil }
    let all = context.accessGroups.flatMap { [$0.old, $0.new] }
    guard mover.entitled(to: all) else {
      log("not entitled to the old keychain groups; Chrome's passkeys stay there until a build is")
      return "pending"
    }
    var moved = 0
    var failed = false
    for (old, new) in context.accessGroups {
      let result = mover.move(from: old, to: new)
      moved += result.moved
      if let status = result.failure {
        failed = true
        log("moving \(old) to \(new): \(status)")
      }
    }
    // A failure (a locked keychain, say) tries again at the next launch: what moved is gone from the old groups.
    return failed ? "pending" : moved > 0 ? "moved \(moved)" : "none"
  }

  /// Chrome's disk cache and the like: copied once when the new one doesn't exist yet; failures only cost a refetch.
  func copyExtras() {
    for (old, new) in context.extras where exists(old) && !exists(new) {
      do {
        try fm.createDirectory(at: new.deletingLastPathComponent(), withIntermediateDirectories: true)
        try fm.copyItem(at: old, to: new)
      } catch {
        log("skipped \(old.lastPathComponent): \(error)")
        try? fm.removeItem(at: new)
      }
    }
  }

  private func finish(_ journal: Journal) -> Outcome {
    var journal = journal
    if journal.outcome == "migrated" {
      copyDefaults()
      if crash("defaults") { return .quit }
      copyExtras()
      journal.groups = moveAccessGroups()
    }
    journal.defaultBrowser = checkDefaultBrowser()
    journal.phase = "done"
    journal.finishedAt = Date()
    if !writeJournal(journal) { log("couldn't record the migration as done") }
    log("done: \(journal.outcome ?? "?")\(journal.files.map { ", \($0) files" } ?? "")")
    return .proceed
  }

  /// Leaves the offer when the old app was the default browser. Once: an offer already there (a run resumed after a
  /// crash, or one the app has answered) stays as it is. nil when it couldn't be written: the next launch tries again.
  func checkDefaultBrowser() -> String? {
    guard context.oldAppWasDefaultBrowser() else { return "no" }
    let url = context.newData.appendingPathComponent(Self.defaultBrowserOfferName)
    guard !exists(url) else { return "offered" }
    let offer = try? JSONSerialization.data(withJSONObject: ["version": 1, "askedAt": NSNull()], options: [.sortedKeys])
    guard MigrationFiles.writeDurably(offer, to: url, mode: 0o644) else {
      log("couldn't record the default browser offer")
      return nil
    }
    return "offered"
  }

  // MARK: Helpers

  private func crash(_ step: String) -> Bool { context.crashAfter == step }

  private func writeJournal(_ journal: Journal) -> Bool {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    encoder.outputFormatting = [.sortedKeys]
    return MigrationFiles.writeDurably(try? encoder.encode(journal), to: journalURL, mode: 0o644, fullSync: true)
  }

  private func exists(_ url: URL) -> Bool {
    var info = stat()
    return lstat(url.path, &info) == 0
  }

  /// Data a launch of this app made: its session or a Chrome profile.
  private func hasData(_ dir: URL) -> Bool {
    exists(dir.appendingPathComponent("session.json")) || exists(dir.appendingPathComponent("Chromium/Local State"))
  }

  private func uniqueURL(_ url: URL) -> URL {
    var candidate = url, n = 2
    while exists(candidate) {
      candidate = url.deletingLastPathComponent().appendingPathComponent("\(url.lastPathComponent) \(n)")
      n += 1
    }
    return candidate
  }

  /// Renamed.paths with each "*" expanded to the names present in `root`.
  func expandedRenames(in root: URL) -> [(String, String)] {
    var result: [(String, String)] = []
    for (old, new) in Renamed.paths {
      let oldParts = old.split(separator: "/").map(String.init), newParts = new.split(separator: "/").map(String.init)
      guard let star = oldParts.firstIndex(of: "*") else {
        result.append((old, new))
        continue
      }
      let parent = oldParts[..<star].joined(separator: "/")
      for name in ((try? fm.contentsOfDirectory(atPath: root.appendingPathComponent(parent).path)) ?? []).sorted() {
        let fill = { (parts: [String]) in parts.map { $0 == "*" ? name : $0 }.joined(separator: "/") }
        result.append((fill(oldParts), fill(newParts)))
      }
    }
    return result
  }

  /// The app's JSON documents (the folder's top level) and Chrome's Bookmarks files.
  func documents(in root: URL) -> [String] {
    var result: [String] = []
    for name in ((try? fm.contentsOfDirectory(atPath: root.path)) ?? []).sorted() where name.hasSuffix(".json") {
      if (try? root.appendingPathComponent(name).resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true {
        result.append(name)
      }
    }
    for profile in ((try? fm.contentsOfDirectory(atPath: root.appendingPathComponent("Chromium").path)) ?? []).sorted() {
      for name in ["Bookmarks", "Bookmarks.bak"] {
        let relative = "Chromium/\(profile)/\(name)"
        if (try? root.appendingPathComponent(relative).resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true {
          result.append(relative)
        }
      }
    }
    return result
  }

  private func log(_ message: String) { NSLog("Arcadia: migration from \(LegacyName.appName): \(message)") }
}

struct MigrationError: Error, LocalizedError {
  let message: String
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
}

enum MigrationFiles {
  /// Writes `data` to a new temporary file (never through a link), flushes it, renames it into place and flushes the
  /// folder, so after a power loss the file is either the old one or all of the new one.
  static func writeDurably(_ data: Data?, to url: URL, mode: mode_t, fullSync: Bool = false) -> Bool {
    guard let data else { return false }
    let temp = url.deletingLastPathComponent().appendingPathComponent(".\(url.lastPathComponent).\(getpid()).tmp")
    unlink(temp.path)
    let fd = open(temp.path, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW | O_CLOEXEC, mode)
    guard fd >= 0 else { return false }
    let wrote = fchmod(fd, mode) == 0 && data.withUnsafeBytes { write(fd, $0.baseAddress, $0.count) } == data.count
    // F_FULLFSYNC also flushes the drive's cache, so what was written before (the staged copy) is down too.
    let synced = fullSync ? fcntl(fd, F_FULLFSYNC) == 0 : fsync(fd) == 0
    close(fd)
    guard wrote, synced, rename(temp.path, url.path) == 0 else {
      unlink(temp.path)
      return false
    }
    syncFolder(url.deletingLastPathComponent(), full: fullSync)
    return true
  }

  /// Makes the renames in a folder durable.
  static func syncFolder(_ url: URL, full: Bool = true) {
    let fd = open(url.path, O_RDONLY | O_CLOEXEC)
    guard fd >= 0 else { return }
    if !full || fcntl(fd, F_FULLFSYNC) != 0 { fsync(fd) }
    close(fd)
  }
}

// MARK: - Documents

/// Rewrites what a JSON document says in old names: app URLs (netnyahoo://, chrome://yahu) at the start of any string,
/// absolute paths into the old data folder, and the renamed keys (Renamed.jsonKeys). Only a document that changes
/// is written; it's parsed and written again, so its formatting may change, never its values.
struct DocumentRewriter {
  let oldData: String
  let newData: String

  func string(_ s: String) -> String {
    let lower = s.lowercased()
    for prefix in ["", "view-source:"] {
      for (old, new) in Renamed.urls where lower.hasPrefix(prefix + old) {
        let rest = s.dropFirst(prefix.count + old.count)
        // "chrome://yahu" only as a whole host: not chrome://yahuu.
        if !old.hasSuffix("://"), let next = rest.first, !"/?#".contains(next) { continue }
        return String(s.prefix(prefix.count)) + new + rest
      }
    }
    if s == oldData || s.hasPrefix(oldData + "/") { return newData + s.dropFirst(oldData.count) }
    return s
  }

  func value(_ value: Any) -> Any {
    switch value {
    case let s as String:
      return string(s)
    case let list as [Any]:
      return list.map(self.value)
    case let object as [String: Any]:
      var out: [String: Any] = [:]
      for (key, v) in object {
        let newKey = Renamed.jsonKeys[key] ?? string(key)
        // An object with both names keeps the new one's value.
        if newKey != key, object[newKey] != nil { continue }
        out[newKey] = self.value(v)
      }
      return out
    default:
      return value
    }
  }

  /// Rewrites the file in place if anything in it changes; true if it did.
  func rewriteFile(_ url: URL) throws -> Bool {
    let data = try Data(contentsOf: url)
    guard let parsed = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else { return false }
    let rewritten = value(parsed)
    guard !NSDictionary(dictionary: ["v": parsed]).isEqual(to: ["v": rewritten]) else { return false }
    let out = try JSONSerialization.data(withJSONObject: rewritten, options: [.fragmentsAllowed, .withoutEscapingSlashes])
    let mode = ((try? FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions]) as? NSNumber)?.uint16Value ?? 0o644
    guard MigrationFiles.writeDurably(out, to: url, mode: mode_t(mode)) else { throw MigrationError("can't write \(url.lastPathComponent)") }
    return true
  }

  static func parses(_ url: URL) -> Bool {
    guard let data = try? Data(contentsOf: url) else { return false }
    if url.pathExtension == "plist" { return (try? PropertyListSerialization.propertyList(from: data, format: nil)) != nil }
    return (try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])) != nil
  }
}

// MARK: - At launch

public enum LegacyMigration {
  /// Brings an install of the old app across, once, before anything reads its data. False: the app must quit (the
  /// user chose to, and the migration stays pending for the next launch).
  ///
  /// The installed app (no ARCADIA_DATA_DIR, a Developer ID release build) migrates ~/Library's old folders, defaults
  /// and login keychain items. A test instance migrates only when ARCADIA_LEGACY_SOURCE names a fake home holding an
  /// old layout (Library/Application Support/<old id>, Library/Preferences/<old id>.plist, keychain.json), into its
  /// own data dir; it never touches the real Library or keychain.
  public static func runAtLaunch(bundleId: String? = Bundle.main.bundleIdentifier) -> Bool {
    let env = ProcessInfo.processInfo.environment
    let bundleId = bundleId ?? "com.arcadia.browser"
    guard bundleId != LegacyName.bundleId else { return true }
    let context: LegacyMigrator.Context?
    if let data = env["ARCADIA_DATA_DIR"], !data.isEmpty {
      guard let source = env["ARCADIA_LEGACY_SOURCE"], !source.isEmpty else { return true }
      context = testInstanceContext(dataDir: data, legacyHome: source, bundleId: bundleId, crashAfter: env["ARCADIA_LEGACY_CRASH_AFTER"])
    } else {
      context = installedContext(bundleId: bundleId)
    }
    guard let context else { return true }
    return LegacyMigrator(context).run() == .proceed
  }

  static func installedContext(bundleId: String) -> LegacyMigrator.Context? {
    #if DEBUG
    // A development build never opens the installed app's data (ArcadiaCoreHost refuses to start without a data dir).
    return nil
    #else
    // Only Developer ID builds use the installed data with the real keychain; an ad hoc one runs on the mock keychain.
    let fm = FileManager.default
    guard let library = fm.urls(for: .libraryDirectory, in: .userDomainMask).first else { return nil }
    let support = library.appendingPathComponent("Application Support", isDirectory: true)
    let newData = support.appendingPathComponent(bundleId, isDirectory: true)
    // The usual launch: one small read and we're off.
    if LegacyMigrator.Context.isDone(newData) { return nil }
    guard let team = teamIdentifier() else { return nil }
    let caches = library.appendingPathComponent("Caches", isDirectory: true)
    let storages = library.appendingPathComponent("HTTPStorages", isDirectory: true)
    var extras: [(URL, URL)] = [(storages.appendingPathComponent(LegacyName.bundleId), storages.appendingPathComponent(bundleId)),
                                (storages.appendingPathComponent("\(LegacyName.bundleId).binarycookies"),
                                 storages.appendingPathComponent("\(bundleId).binarycookies"))]
    // Caches, but not Sparkle's (the update that brought this build in).
    let oldCaches = caches.appendingPathComponent(LegacyName.bundleId)
    for name in ((try? fm.contentsOfDirectory(atPath: oldCaches.path)) ?? []) where name != "org.sparkle-project.Sparkle" {
      extras.append((oldCaches.appendingPathComponent(name), caches.appendingPathComponent(bundleId).appendingPathComponent(name)))
    }
    return LegacyMigrator.Context(
      oldData: support.appendingPathComponent(LegacyName.bundleId, isDirectory: true),
      newData: newData,
      extras: extras,
      oldDefaults: PreferencesDomain(id: LegacyName.bundleId),
      newDefaults: PreferencesDomain(id: bundleId),
      oldSecrets: LoginKeychain(),
      newSecrets: LoginKeychain(),
      accessGroups: KeychainAccessGroups.suffixes.map { ("\(team).\(LegacyName.bundleId).\($0)", "\(team).\(bundleId).\($0)") },
      groupMover: KeychainAccessGroups(),
      // Never this process: LaunchServices may still know its launch by the id the bundle had before the update.
      oldAppRunning: {
        NSRunningApplication.runningApplications(withBundleIdentifier: LegacyName.bundleId).contains {
          !$0.isTerminated && $0.processIdentifier != getpid()
        }
      },
      oldAppWasDefaultBrowser: {
        let stored = CFPreferencesCopyValue("LSHandlers" as CFString, launchServicesDomain as CFString, kCFPreferencesCurrentUser,
                                            kCFPreferencesAnyHost) as? [[String: Any]]
        return ["http", "https"].contains {
          isOldApp(defaultFor: $0, live: LSCopyDefaultHandlerForURLScheme($0 as CFString)?.takeRetainedValue() as String?, stored: stored)
        }
      },
      ask: alert)
    #endif
  }

  static func testInstanceContext(dataDir: String, legacyHome: String, bundleId: String, crashAfter: String?) -> LegacyMigrator.Context? {
    let cwd = FileManager.default.currentDirectoryPath
    // As ACIsolation.m spells the data dir, so its preferences are the same cfprefsd domain as the app's.
    let absolute = { (path: String) in
      URL(fileURLWithPath: (((path as NSString).isAbsolutePath ? path : (cwd as NSString).appendingPathComponent(path)) as NSString)
        .standardizingPath)
    }
    let data = absolute(dataDir), home = absolute(legacyHome)
    let resolved = { (url: URL) in url.resolvingSymlinksInPath().path }
    let realHome = resolved(URL(fileURLWithPath: NSHomeDirectory()))
    let inside = { (a: String, b: String) in a == b || a.hasPrefix(b + "/") }
    // A fake home only: never the real one or its Library, never overlapping the data dir.
    guard resolved(home) != realHome, !inside(resolved(home), realHome + "/Library"), !inside(resolved(data), resolved(home)),
      !inside(resolved(home), resolved(data)) else {
      NSLog("Arcadia: ARCADIA_LEGACY_SOURCE must be a scratch folder apart from the data dir and your home; ignored")
      return nil
    }
    let library = home.appendingPathComponent("Library")
    let oldData = library.appendingPathComponent("Application Support/\(LegacyName.bundleId)", isDirectory: true)
    // Nothing it reads may lead out of the fake home (a link into the real Library, say).
    let handlers = library.appendingPathComponent("Preferences/\(launchServicesDomain).plist")
    for input in [library, oldData, library.appendingPathComponent("Preferences"), handlers, home.appendingPathComponent("keychain.json")]
    where FileManager.default.fileExists(atPath: input.path) && !inside(resolved(input), resolved(home)) {
      NSLog("Arcadia: \(input.path) leads out of ARCADIA_LEGACY_SOURCE; ignored")
      return nil
    }
    return LegacyMigrator.Context(
      oldData: oldData,
      newData: data,
      oldDefaults: PreferencesDomain(id: library.appendingPathComponent("Preferences/\(LegacyName.bundleId)").path),
      newDefaults: PreferencesDomain(id: data.appendingPathComponent("Preferences/\(bundleId)").path),
      oldSecrets: SecretFile(url: home.appendingPathComponent("keychain.json")),
      newSecrets: IsolatedSecretStores(dataDirectory: data),
      oldAppRunning: { singletonOwnerAlive(oldData.appendingPathComponent("Chromium/SingletonLock")) },
      oldAppWasDefaultBrowser: {
        let plist = (try? Data(contentsOf: handlers)).flatMap { try? PropertyListSerialization.propertyList(from: $0, format: nil) }
        let stored = (plist as? [String: Any])?["LSHandlers"] as? [[String: Any]]
        return ["http", "https"].contains { isOldApp(defaultFor: $0, live: nil, stored: stored) }
      },
      // A hidden instance can't ask: whatever would need asking stops it.
      ask: { _, _, _ in nil },
      crashAfter: crashAfter)
  }

  /// Where LaunchServices keeps the user's choices of default apps (Library/Preferences/<this>.plist).
  static let launchServicesDomain = "com.apple.LaunchServices/com.apple.launchservices.secure"

  /// The old bundle id handles `scheme`. LaunchServices' answer (LSCopyDefaultHandlerForURLScheme) is nil once no
  /// installed app has that id, as after the update replaced the old app (checked on macOS 27: a scheme whose handler
  /// was uninstalled answers nil), so then the user's stored choice tells.
  static func isOldApp(defaultFor scheme: String, live: String?, stored handlers: [[String: Any]]?) -> Bool {
    if let live { return live.lowercased() == LegacyName.bundleId }
    return (handlers ?? []).contains { handler in
      guard (handler["LSHandlerURLScheme"] as? String)?.lowercased() == scheme else { return false }
      return ["LSHandlerRoleAll", "LSHandlerRoleViewer"].contains { (handler[$0] as? String)?.lowercased() == LegacyName.bundleId }
    }
  }

  /// Chrome's SingletonLock is a symlink to "<host>-<pid>": is that process still running (and not us)?
  static func singletonOwnerAlive(_ lock: URL) -> Bool {
    guard let target = try? FileManager.default.destinationOfSymbolicLink(atPath: lock.path),
      let pid = target.split(separator: "-").last.flatMap({ pid_t($0) }), pid > 0, pid != getpid() else { return false }
    return kill(pid, 0) == 0 || errno == EPERM
  }

  static func alert(_ title: String, _ message: String, _ buttons: [String]) -> Int? {
    var response: CFOptionFlags = 0
    let icon = Bundle.main.url(forResource: "AppIcon", withExtension: "icns") as CFURL?
    let result = CFUserNotificationDisplayAlert(
      0, kCFUserNotificationNoteAlertLevel, icon, nil, nil, title as CFString, message as CFString,
      buttons.first as CFString?, buttons.count > 1 ? buttons[1] as CFString : nil, buttons.count > 2 ? buttons[2] as CFString : nil,
      &response)
    guard result == 0 else { return nil }
    switch response & 0x3 {
    case CFOptionFlags(kCFUserNotificationDefaultResponse): return 0
    case CFOptionFlags(kCFUserNotificationAlternateResponse): return 1
    case CFOptionFlags(kCFUserNotificationOtherResponse): return 2
    default: return nil
    }
  }

  /// The signing team of a Developer ID build; nil for an ad hoc one.
  static func teamIdentifier() -> String? {
    var code: SecCode?
    guard SecCodeCopySelf([], &code) == errSecSuccess, let code else { return nil }
    var staticCode: SecStaticCode?
    guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else { return nil }
    var info: CFDictionary?
    guard SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
      let dict = info as? [String: Any] else { return nil }
    return dict[kSecCodeInfoTeamIdentifier as String] as? String
  }
}

// MARK: - The app's file name

extension LegacyMigration {
  /// An install updated from before the rename is still at <folder>/<old name>.app: Sparkle installs an update into the
  /// installed bundle's own path. Before anything resolves a path through the bundle (Chromium finds its framework and
  /// helpers by path), this renames it to <folder>/Arcadia.app, registers that with LaunchServices and starts this
  /// process over from there (execv: the same pid, arguments and environment, a hidden test instance's included).
  ///
  /// Returns when it stays where it is: it isn't the old name, it's translocated (Gatekeeper runs a quarantined copy
  /// from a read-only mirror), Arcadia.app is already beside it, or the folder can't be written (logged). Then it runs
  /// under the old name, as before.
  ///
  /// `launched` is the executable's path when the process started (its paths are those from then on); `running` says
  /// where it is now (the kernel's path follows renames). Only that decides: it renames the old name only while its
  /// executable is in it (not a folder that replaced it), and a launch of the same bundle that another one moved a
  /// moment ago follows it there. A rename is never undone: another launch may be running from the new place.
  public static func moveToNewName(launched: String? = launchedExecutable(), running: @escaping () -> String? = runningExecutable) {
    guard let launched else { return }
    // Not standardized: that drops /private from /private/tmp, and the exec must keep the folder as launched.
    let executable = URL(fileURLWithPath: launched)
    let macOS = executable.deletingLastPathComponent(), contents = macOS.deletingLastPathComponent()
    let old = contents.deletingLastPathComponent(), name = executable.lastPathComponent
    guard macOS.lastPathComponent == "MacOS", contents.lastPathComponent == "Contents", old.lastPathComponent == LegacyName.appFileName,
      !old.path.contains("/AppTranslocation/"), "\(name).app" != old.lastPathComponent,
      let folder = realpath(old.deletingLastPathComponent().path, nil) else { return }
    let resolvedFolder = String(cString: folder)
    free(folder)
    let new = old.deletingLastPathComponent().appendingPathComponent("\(name).app")
    let log = { (message: String) in NSLog("Arcadia: renaming \(old.path): \(message)") }
    // The bundle itself, never a link to it. RENAME_EXCL: never over anything already called Arcadia.app.
    var info = stat()
    let isIn = { (bundle: URL) in (running() ?? "").hasPrefix("\(resolvedFolder)/\(bundle.lastPathComponent)/") }
    let isBundle = lstat(old.path, &info) == 0 && info.st_mode & S_IFMT == S_IFDIR && isIn(old)
    let moved = isBundle && renamex_np(old.path, new.path, UInt32(RENAME_EXCL)) == 0
    let error = String(cString: strerror(errno))
    guard isIn(new) else {
      if moved {
        log("renamed it, but this app isn't in it (it was replaced a moment ago); runs as it is")
      } else if isBundle {
        log("stays: \(error)")
      }
      return
    }
    if moved { LSRegisterURL(new as CFURL, true) }
    let path = new.appendingPathComponent("Contents/MacOS").appendingPathComponent(name).path
    var argv = (0..<Int(CommandLine.argc)).map { CommandLine.unsafeArgv[$0] }
    if argv.isEmpty { argv.append(nil) }
    argv[0] = strdup(path)
    argv.append(nil)
    execv(path, argv)
    // Never moved back: another launch may be running from the new place by now. This process can't run on from a
    // bundle that has moved (its paths are the old ones); the next launch starts from Arcadia.app.
    log("couldn't start from \(new.lastPathComponent): \(String(cString: strerror(errno))); quitting")
    exit(EXIT_FAILURE)
  }

  /// The path this process's executable was started from (dyld's; what Bundle.main and Chromium go by).
  public static func launchedExecutable() -> String? {
    var size: UInt32 = 0
    _NSGetExecutablePath(nil, &size)
    var buffer = [CChar](repeating: 0, count: Int(size) + 1)
    guard _NSGetExecutablePath(&buffer, &size) == 0 else { return nil }
    return String(cString: buffer)
  }

  /// This process's executable where it is now (the kernel's path: links resolved, renames followed).
  public static func runningExecutable() -> String? {
    var buffer = [CChar](repeating: 0, count: Int(MAXPATHLEN) * 4)
    guard proc_pidpath(getpid(), &buffer, UInt32(buffer.count)) > 0 else { return nil }
    return String(cString: buffer)
  }
}

extension LegacyMigration {
  /// The old → new tables as JSON, for scripts that build an old install to migrate (scripts/legacy-migration-e2e.mjs):
  /// they read the old names here instead of spelling them.
  public static func namesJSON() -> Data {
    let names: [String: Any] = [
      "bundleId": LegacyName.bundleId,
      "appFileName": LegacyName.appFileName,
      "appName": LegacyName.appName,
      "keychain": Renamed.keychain.map { item -> [String: Any] in
        var entry: [String: Any] = ["oldService": item.oldService, "newService": item.newService]
        if let account = item.account { entry["oldAccount"] = account.old; entry["newAccount"] = account.new }
        return entry
      },
      "paths": Renamed.paths.map { [$0.old, $0.new] },
      "jsonKeys": Renamed.jsonKeys,
      "urls": Renamed.urls.map { [$0.old, $0.new] },
      "defaultsKeys": Renamed.defaultsKeys,
      "defaultsKeyPrefixes": Renamed.defaultsKeyPrefixes.map { [$0.0, $0.1] },
      "menuTitleWords": Renamed.menuTitleWords.map { [$0.0, $0.1] },
    ]
    return (try? JSONSerialization.data(withJSONObject: names, options: [.sortedKeys, .prettyPrinted])) ?? Data()
  }
}

extension LegacyMigrator.Context {
  static func isDone(_ newData: URL) -> Bool {
    guard let data = try? Data(contentsOf: newData.appendingPathComponent(LegacyMigrator.journalName)),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
    return json["phase"] as? String == "done" && json["groups"] as? String != "pending" && json["defaultBrowser"] is String
  }
}
