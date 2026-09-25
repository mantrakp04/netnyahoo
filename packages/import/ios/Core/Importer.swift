import Foundation

/// Runs an import for one browser profile: each requested kind is read independently, so one
/// unreadable file (a locked `History`, a denied Keychain) fails that kind alone and the rest
/// still come through — the UI then lists what failed ("Some import steps failed:").
///
/// Secrets are gated: passwords and cookies are only read for a browser the user has
/// unlocked with `unlock(browserId:)`, which for the Chromium family is the step that makes
/// macOS show its Keychain prompt. Keys stay in memory until `forgetKeys()`.
public final class Importer: @unchecked Sendable {
  public let discovery: BrowserDiscovery
  private let lock = NSLock()
  private var keys: [String: Data] = [:]
  private var firefoxPasswords: [String: String] = [:]

  public init(discovery: BrowserDiscovery) {
    self.discovery = discovery
  }

  // MARK: Unlocking

  public typealias SecretProvider = (_ service: String, _ account: String) throws -> Data

  /// Chromium family: reads "<Browser> Safe Storage" (macOS prompts) and keeps the derived
  /// key. Firefox: records consent and the primary password ("" when none is set).
  public func unlock(browserId: String, primaryPassword: String = "",
                     secret: SecretProvider = SafeStorageKeychain.secret) throws {
    guard let def = BrowserDefinition.find(browserId) else { throw ImportError.notFound("Unknown browser \(browserId)") }
    switch def.family {
    case .chromium, .arc:
      guard let service = def.keychainService, let account = def.keychainAccount else { return }
      let key = ChromiumCrypto.deriveKey(secret: try secret(service, account))
      lock.withLock { keys[browserId] = key }
    case .firefox:
      lock.withLock { firefoxPasswords[browserId] = primaryPassword }
    case .safari:
      break
    }
  }

  /// Installs an already-derived key (tests, or a key the app obtained another way).
  public func setKey(_ key: Data, for browserId: String) { lock.withLock { keys[browserId] = key } }

  public func isUnlocked(_ browserId: String) -> Bool {
    lock.withLock { keys[browserId] != nil || firefoxPasswords[browserId] != nil }
  }

  public func forgetKeys() {
    lock.withLock {
      keys.removeAll()
      firefoxPasswords.removeAll()
    }
  }

  private func key(_ browserId: String) -> Data? { lock.withLock { keys[browserId] } }
  private func primaryPassword(_ browserId: String) -> String? { lock.withLock { firefoxPasswords[browserId] } }

  // MARK: Import

  public func importData(browserId: String, profileId: String, kinds: [ImportKind], options: ImportOptions = .init(),
                         observer: ImportObserver = .silent, cancellation: Cancellation = .init()) throws -> ImportResult {
    guard let def = BrowserDefinition.find(browserId) else { throw ImportError.notFound("Unknown browser \(browserId)") }
    guard def.family != .safari else { throw ImportError.unsupported("Safari imports come from its export archive") }
    let dir = try discovery.profileDirectory(def, profileId)
    var result = ImportResult(browserId: browserId, profileId: profileId)
    if let info = discovery.source(def)?.profiles.first(where: { $0.id == profileId }) {
      result.profile = ProfileSuggestion(name: info.name, color: info.color, avatarPath: info.avatarPath)
    }

    // Arc's sidebar is shared by spaces, pinned tabs, today tabs and favourites.
    var arc: ArcSidebar?
    func arcSidebar() throws -> ArcSidebar {
      if let arc { return arc }
      let url = discovery.arcSidebarURL()
      guard FileManager.default.fileExists(atPath: url.path) else { throw ImportError.notFound("No Arc sidebar data") }
      let parsed = try ArcSidebar.parse(Data(contentsOf: url))
      arc = parsed
      return parsed
    }

    let ordered = ImportKind.allCases.filter(kinds.contains)
    for kind in ordered {
      try cancellation.check()
      if kind != .history { observer.progress(ImportProgress(kind: kind, phase: .start, processed: 0, total: nil)) }
      var count = 0
      var succeeded = false
      do {
        switch (kind, def.family) {
        case (.bookmarks, .chromium), (.bookmarks, .arc):
          result.bookmarks = try ChromiumBookmarks.load(profile: dir)
          count = result.bookmarks?.linkCount ?? 0
        case (.bookmarks, .firefox):
          result.bookmarks = try Firefox.bookmarks(places: dir.appendingPathComponent("places.sqlite"), cancellation: cancellation)
          count = result.bookmarks?.linkCount ?? 0

        case (.history, .chromium), (.history, .arc), (.history, .firefox):
          let flavor: HistoryReader.Flavor = def.family == .firefox ? .firefox : .chromium
          let file = dir.appendingPathComponent(def.family == .firefox ? "places.sqlite" : "History")
          let (entries, total) = try HistoryReader.read(file, flavor: flavor, options: options, observer: observer, cancellation: cancellation)
          result.history = entries
          result.historyCount = total
          count = total

        case (.tabs, .chromium):
          let session = try ChromiumSessions.load(profile: dir, key: key(browserId))
          result.tabs = session.tabs
          result.tabGroups = session.groups
          count = session.tabs.count
        case (.tabs, .firefox):
          let session = try Firefox.loadSession(profile: dir)
          result.tabs = session.tabs
          result.tabGroups = session.groups
          count = session.tabs.count

        case (.spaces, .arc), (.pinnedTabs, .arc), (.tabs, .arc):
          let spaces = try arcSidebar().spaces.filter { $0.profileId == profileId && (options.spaceIds?.contains($0.id) ?? true) }
          result.spaces = spaces.map { space in
            var s = space
            if !kinds.contains(.pinnedTabs) { s.pinned = [] }
            if !kinds.contains(.tabs) { s.tabs = [] }
            return s
          }
          switch kind {
          case .tabs:
            result.tabs = spaces.flatMap(\.tabs)
            count = result.tabs.count
          case .pinnedTabs:
            count = spaces.reduce(0) { $0 + $1.pinned.reduce(0) { $0 + $1.linkCount } }
          default:
            count = spaces.count
          }
        case (.favorites, .arc):
          result.favorites = try arcSidebar().favorites[profileId] ?? []
          count = result.favorites.count

        case (.passwords, .chromium), (.passwords, .arc):
          guard let key = key(browserId) else { throw ImportError.locked("Unlock \(def.name) to import passwords") }
          let outcome = try ChromiumSecrets.logins(profile: dir, key: key, cancellation: cancellation)
          result.credentials = outcome.items
          count = outcome.items.count
          if outcome.undecryptable > 0 {
            result.warnings.append(ImportWarning(kind, "undecryptable", "\(outcome.undecryptable) passwords couldn't be decrypted"))
            if outcome.items.isEmpty { throw ImportError.locked("The \(def.name) key didn't decrypt any passwords") }
          }
        case (.passwords, .firefox):
          guard let password = primaryPassword(browserId) else { throw ImportError.locked("Allow Firefox password import first") }
          result.credentials = try FirefoxLogins.logins(profile: dir, primaryPassword: password, cancellation: cancellation)
          count = result.credentials.count

        case (.cookies, .chromium), (.cookies, .arc):
          guard let key = key(browserId) else { throw ImportError.locked("Unlock \(def.name) to import cookies") }
          let outcome = try ChromiumSecrets.cookies(profile: dir, key: key, cancellation: cancellation)
          result.cookies = outcome.items
          count = outcome.items.count
          if outcome.undecryptable > 0 {
            result.warnings.append(ImportWarning(kind, "undecryptable", "\(outcome.undecryptable) cookies couldn't be decrypted"))
          }
        case (.cookies, .firefox):
          guard primaryPassword(browserId) != nil else { throw ImportError.locked("Allow Firefox cookie import first") }
          result.cookies = try Firefox.cookies(profile: dir, cancellation: cancellation)
          count = result.cookies.count

        default:
          throw ImportError.unsupported("\(def.name) has no \(kind.rawValue) to import")
        }
        succeeded = true
      } catch ImportError.cancelled {
        throw ImportError.cancelled
      } catch ImportError.notFound(let message) {
        // Nothing of this kind in the profile: not a failure, just nothing to bring.
        result.warnings.append(ImportWarning(kind, "empty", message))
      } catch let error as ImportError {
        result.failed.append(kind)
        result.warnings.append(ImportWarning(kind, error.code, error.description))
      } catch {
        result.failed.append(kind)
        result.warnings.append(ImportWarning(kind, "unreadable", error.localizedDescription))
      }
      // The history reader reports its own start/progress/end when it runs to completion.
      if kind != .history || !succeeded { observer.progress(ImportProgress(kind: kind, phase: .end, processed: count, total: count)) }
    }
    return result
  }
}
