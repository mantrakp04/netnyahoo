import Foundation

/// A browser Netnyahoo knows how to import from.
public struct BrowserDefinition: Sendable {
  public enum Family: String, Codable, Sendable { case chromium, firefox, safari, arc }

  public var id: String
  public var name: String
  public var family: Family
  public var bundleIds: [String]
  /// Data directory relative to `~/Library/Application Support`.
  public var dataPath: String?
  /// Keychain generic-password service/account holding the Safe Storage secret.
  public var keychainService: String?
  public var keychainAccount: String?
  /// Opera keeps its main profile in the data directory itself rather than in `Default/`.
  public var rootIsProfile = false

  /// Dia's list (Arc, Brave, Chrome, Edge, Firefox, Opera, Opera GX, Safari, Vivaldi) plus
  /// Chrome's other channels, Chromium and Island. Order is the order the picker shows.
  public static let all: [BrowserDefinition] = [
    chromium("chrome", "Google Chrome", ["com.google.Chrome"], "Google/Chrome", "Chrome"),
    arc,
    .init(id: "safari", name: "Safari", family: .safari, bundleIds: ["com.apple.Safari"]),
    .init(id: "firefox", name: "Firefox", family: .firefox, bundleIds: ["org.mozilla.firefox"], dataPath: "Firefox"),
    chromium("edge", "Microsoft Edge", ["com.microsoft.edgemac"], "Microsoft Edge", "Microsoft Edge"),
    chromium("brave", "Brave", ["com.brave.Browser"], "BraveSoftware/Brave-Browser", "Brave"),
    chromium("opera", "Opera", ["com.operasoftware.Opera"], "com.operasoftware.Opera", "Opera", rootIsProfile: true),
    chromium("operaGX", "Opera GX", ["com.operasoftware.OperaGX"], "com.operasoftware.OperaGX", "Opera", rootIsProfile: true),
    chromium("vivaldi", "Vivaldi", ["com.vivaldi.Vivaldi"], "Vivaldi", "Vivaldi"),
    chromium("island", "Island", ["io.island.Island", "com.island.Island"], "Island", "Island"),
    chromium("chromeBeta", "Google Chrome Beta", ["com.google.Chrome.beta"], "Google/Chrome Beta", "Chrome"),
    chromium("chromeDev", "Google Chrome Dev", ["com.google.Chrome.dev"], "Google/Chrome Dev", "Chrome"),
    chromium("chromeCanary", "Google Chrome Canary", ["com.google.Chrome.canary"], "Google/Chrome Canary", "Chrome"),
    chromium("chromium", "Chromium", ["org.chromium.Chromium"], "Chromium", "Chromium"),
  ]

  static let arc = BrowserDefinition(id: "arc", name: "Arc", family: .arc, bundleIds: ["company.thebrowser.Browser"],
                                     dataPath: "Arc/User Data", keychainService: "Arc Safe Storage", keychainAccount: "Arc")

  static func chromium(_ id: String, _ name: String, _ bundleIds: [String], _ path: String, _ keychain: String,
                       rootIsProfile: Bool = false) -> BrowserDefinition {
    BrowserDefinition(id: id, name: name, family: .chromium, bundleIds: bundleIds, dataPath: path,
                      keychainService: "\(keychain) Safe Storage", keychainAccount: keychain, rootIsProfile: rootIsProfile)
  }

  public static func find(_ id: String) -> BrowserDefinition? { all.first { $0.id == id } }

  public var isChromiumBased: Bool { family == .chromium || family == .arc }
}

public struct SpaceSummary: Codable, Equatable, Sendable {
  public var id: String
  public var name: String
  public var color: String?
  public var emoji: String?
  public var icon: String?
  public var pinnedCount: Int
  public var tabCount: Int
}

public struct BrowserProfile: Codable, Equatable, Sendable {
  /// Stable id to pass back to `importData`: the directory name under the browser's data
  /// directory ("Default", "Profile 1", Firefox's "Profiles/abcd.default-release", "." for Opera).
  public var id: String
  public var name: String
  public var path: String
  public var email: String?
  public var avatarPath: String?
  public var color: String?
  public var isDefault: Bool
  /// Kinds this profile has data files for.
  public var available: [ImportKind]
  /// Arc: the spaces that browse with this profile.
  public var spaces: [SpaceSummary]?
}

public struct BrowserSource: Codable, Equatable, Sendable {
  public var id: String
  public var name: String
  public var family: BrowserDefinition.Family
  public var appPath: String?
  /// PNG of the app icon, when the app is installed.
  public var iconPath: String?
  /// Safari: data comes from a File › Export Browsing Data archive, not from disk.
  public var requiresExport: Bool
  /// Chromium family: passwords/cookies need a Keychain unlock (macOS will prompt).
  public var needsKeychain: Bool
  public var profiles: [BrowserProfile]
}

/// Finds installed browsers and their profiles.
///
/// `applicationSupport` is `~/Library/Application Support` in the app and a fixture
/// directory in tests; `locateApp` maps bundle ids to an installed .app (NSWorkspace in the
/// app). Nothing here reads browsing data or touches the Keychain — only `Local State`,
/// `profiles.ini`, `StorableSidebar.json` and file existence checks.
public struct BrowserDiscovery {
  public var applicationSupport: URL
  public var locateApp: ([String]) -> URL?
  public var iconFor: (URL, String) -> String?

  public init(applicationSupport: URL, locateApp: @escaping ([String]) -> URL? = { _ in nil },
              iconFor: @escaping (URL, String) -> String? = { _, _ in nil }) {
    self.applicationSupport = applicationSupport
    self.locateApp = locateApp
    self.iconFor = iconFor
  }

  public func list() -> [BrowserSource] {
    BrowserDefinition.all.compactMap(source)
  }

  public func source(_ def: BrowserDefinition) -> BrowserSource? {
    let app = locateApp(def.bundleIds)
    var profiles: [BrowserProfile] = []
    switch def.family {
    case .safari:
      // Listed whenever Safari is installed; its data only comes in through an export.
      guard app != nil else { return nil }
    case .firefox:
      profiles = firefoxProfiles(def)
    case .chromium, .arc:
      profiles = chromiumProfiles(def)
      if def.family == .arc { attachArcSpaces(&profiles) }
    }
    guard def.family == .safari || !profiles.isEmpty else { return nil }
    return BrowserSource(
      id: def.id, name: def.name, family: def.family, appPath: app?.path,
      iconPath: app.flatMap { iconFor($0, def.id) },
      requiresExport: def.family == .safari, needsKeychain: def.isChromiumBased, profiles: profiles
    )
  }

  public func dataDirectory(_ def: BrowserDefinition) -> URL? {
    def.dataPath.map { applicationSupport.appendingPathComponent($0, isDirectory: true) }
  }

  /// Resolves a profile id from JS to a directory, refusing anything that escapes the
  /// browser's data directory.
  public func profileDirectory(_ def: BrowserDefinition, _ profileId: String) throws -> URL {
    guard let root = dataDirectory(def) else { throw ImportError.unsupported("\(def.name) has no profiles on disk") }
    let dir = root.appendingPathComponent(profileId, isDirectory: true).standardizedFileURL
    let rootPath = root.standardizedFileURL.path
    guard dir.path == rootPath || dir.path.hasPrefix(rootPath + "/") else { throw ImportError.notFound("Unknown profile") }
    guard FileManager.default.fileExists(atPath: dir.path) else { throw ImportError.notFound("Profile \(profileId) not found") }
    return dir
  }

  // MARK: Chromium

  func chromiumProfiles(_ def: BrowserDefinition) -> [BrowserProfile] {
    guard let root = dataDirectory(def) else { return [] }
    let fm = FileManager.default
    var infoCache: [String: [String: Any]] = [:]
    var order: [String] = []
    var lastUsed: String?
    if let data = try? Data(contentsOf: root.appendingPathComponent("Local State")),
       let top = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
       let profile = top["profile"] as? [String: Any] {
      infoCache = profile["info_cache"] as? [String: [String: Any]] ?? [:]
      order = profile["profiles_order"] as? [String] ?? []
      lastUsed = profile["last_used"] as? String
    }

    var dirs: [String] = []
    if def.rootIsProfile, isProfile(root) { dirs.append(".") }
    for dir in order + infoCache.keys.sorted() where !dirs.contains(dir) { dirs.append(dir) }
    // Profiles Local State forgot about still hold data: scan for them too.
    for name in ((try? fm.contentsOfDirectory(atPath: root.path)) ?? []).sorted()
    where (name == "Default" || name.hasPrefix("Profile ")) && !dirs.contains(name) {
      dirs.append(name)
    }
    if def.rootIsProfile {
      let side = root.appendingPathComponent("_side_profiles")
      for name in ((try? fm.contentsOfDirectory(atPath: side.path)) ?? []).sorted() {
        dirs.append("_side_profiles/\(name)")
      }
    }

    var out: [BrowserProfile] = []
    var fallbackIndex = 0
    for dir in dirs {
      let path = dir == "." ? root : root.appendingPathComponent(dir, isDirectory: true)
      guard isProfile(path) else { continue }
      let info = infoCache[dir] ?? (dir == "." ? infoCache["Default"] ?? infoCache[""] : nil) ?? [:]
      fallbackIndex += 1
      var name = (info["name"] as? String).flatMap { $0.isEmpty ? nil : $0 }
      if name == nil {
        name = dir == "Default" || dir == "." ? "Default" : "Profile \(fallbackIndex)"
      }
      let picture = path.appendingPathComponent("Google Profile Picture.png")
      let color = (info["profile_highlight_color"] as? Int ?? info["default_avatar_fill_color"] as? Int).map(Hex.color(skColor:))
      out.append(BrowserProfile(
        id: dir,
        name: name!,
        path: path.path,
        email: (info["user_name"] as? String).flatMap { $0.isEmpty ? nil : $0 },
        avatarPath: fm.fileExists(atPath: picture.path) ? picture.path : nil,
        color: color,
        isDefault: dir == (lastUsed ?? "Default") || (dir == "." && lastUsed == nil),
        available: chromiumKinds(path, arc: def.family == .arc),
        spaces: nil
      ))
    }
    return out
  }

  func isProfile(_ dir: URL) -> Bool {
    let fm = FileManager.default
    return ["Preferences", "Bookmarks", "History", "Login Data"].contains {
      fm.fileExists(atPath: dir.appendingPathComponent($0).path)
    }
  }

  func chromiumKinds(_ dir: URL, arc: Bool) -> [ImportKind] {
    let fm = FileManager.default
    func has(_ names: String...) -> Bool { names.contains { fm.fileExists(atPath: dir.appendingPathComponent($0).path) } }
    var kinds: [ImportKind] = []
    if has("Bookmarks", "AccountBookmarks") { kinds.append(.bookmarks) }
    if has("History") { kinds.append(.history) }
    if !arc, ChromiumSessions.latestFile(profile: dir) != nil { kinds.append(.tabs) }
    if has("Login Data", "Login Data For Account") { kinds.append(.passwords) }
    if has("Network/Cookies", "Cookies") { kinds.append(.cookies) }
    return kinds
  }

  // MARK: Arc

  public func arcSidebarURL() -> URL {
    applicationSupport.appendingPathComponent("Arc/StorableSidebar.json")
  }

  func attachArcSpaces(_ profiles: inout [BrowserProfile]) {
    guard let data = try? Data(contentsOf: arcSidebarURL()), let sidebar = try? ArcSidebar.parse(data) else { return }
    for i in profiles.indices {
      let spaces = sidebar.spaces.filter { $0.profileId == profiles[i].id }
      profiles[i].spaces = spaces.map {
        SpaceSummary(id: $0.id, name: $0.name, color: $0.color, emoji: $0.emoji, icon: $0.icon,
                     pinnedCount: $0.pinned.reduce(0) { $0 + $1.linkCount }, tabCount: $0.tabs.count)
      }
      var kinds = profiles[i].available
      if !spaces.isEmpty { kinds += [.spaces, .pinnedTabs, .tabs] }
      if sidebar.favorites[profiles[i].id]?.isEmpty == false { kinds.append(.favorites) }
      profiles[i].available = kinds
    }
  }

  // MARK: Firefox

  func firefoxProfiles(_ def: BrowserDefinition) -> [BrowserProfile] {
    guard let root = dataDirectory(def),
          let ini = try? String(contentsOf: root.appendingPathComponent("profiles.ini"), encoding: .utf8) else { return [] }
    let fm = FileManager.default
    return Firefox.profiles(ini: ini).compactMap { p in
      // Absolute paths (IsRelative=0) outside the data directory aren't importable by id.
      guard !p.path.hasPrefix("/") else { return nil }
      let dir = root.appendingPathComponent(p.path, isDirectory: true)
      guard fm.fileExists(atPath: dir.path) else { return nil }
      func has(_ name: String) -> Bool { fm.fileExists(atPath: dir.appendingPathComponent(name).path) }
      var kinds: [ImportKind] = []
      if has("places.sqlite") { kinds += [.bookmarks, .history] }
      if Firefox.sessionFile(profile: dir) != nil { kinds.append(.tabs) }
      if has("logins.json") { kinds.append(.passwords) }
      if has("cookies.sqlite") { kinds.append(.cookies) }
      return BrowserProfile(id: p.path, name: p.name, path: dir.path, email: nil, avatarPath: nil, color: nil,
                            isDefault: p.isDefault, available: kinds, spaces: nil)
    }
  }
}
