import Foundation

// The normalized shapes every importer produces. They map onto Netnyahoo's own concepts
// (bookmark tree, history entries, tabs, saved logins, profiles/spaces), and are what the
// JS side receives as JSON. Timestamps are Unix milliseconds, like `Date.now()`.

/// A category of data, as the import UI lists them.
public enum ImportKind: String, Codable, CaseIterable, Sendable {
  case bookmarks, history, tabs, passwords, cookies
  /// Arc only: spaces → profile/space suggestions (name, colour, icon).
  case spaces
  /// Arc only: each space's pinned tree, with the user's custom tab names.
  case pinnedTabs
  /// Arc only: the favourites row ("top apps").
  case favorites
}

public struct BookmarkNode: Codable, Equatable, Sendable {
  public enum NodeType: String, Codable, Sendable { case folder, url }

  public var type: NodeType
  public var title: String
  public var url: String?
  public var dateAdded: Double?
  public var children: [BookmarkNode]?
  /// Where the folder lived in the source browser: "toolbar", "other", "mobile", "menu",
  /// "readingList". Lets the UI put the toolbar's contents on Netnyahoo's bookmarks bar.
  public var role: String?
  /// Arc pinned tabs: the page's own title when `title` is the user's rename.
  public var pageTitle: String?

  public static func folder(_ title: String, _ children: [BookmarkNode], role: String? = nil, dateAdded: Double? = nil) -> BookmarkNode {
    BookmarkNode(type: .folder, title: title, url: nil, dateAdded: dateAdded, children: children, role: role, pageTitle: nil)
  }

  public static func link(_ title: String, _ url: String, dateAdded: Double? = nil) -> BookmarkNode {
    BookmarkNode(type: .url, title: title, url: url, dateAdded: dateAdded, children: nil, role: nil, pageTitle: nil)
  }

  /// Number of links in this subtree.
  public var linkCount: Int {
    type == .url ? 1 : (children ?? []).reduce(0) { $0 + $1.linkCount }
  }
}

public struct HistoryEntry: Codable, Equatable, Sendable {
  public var url: String
  public var title: String
  public var visits: Int
  public var lastVisit: Double
  public var typedCount: Int?
}

public struct ImportedTab: Codable, Equatable, Sendable {
  public var url: String
  public var title: String
  public var pinned: Bool
  /// A name the user typed over the page title (Arc renames).
  public var customTitle: String?
  public var groupId: String?
  public var windowIndex: Int
  /// The selected tab of its window.
  public var active: Bool
  public var lastActive: Double?

  public init(url: String, title: String, pinned: Bool = false, customTitle: String? = nil, groupId: String? = nil,
              windowIndex: Int = 0, active: Bool = false, lastActive: Double? = nil) {
    self.url = url
    self.title = title
    self.pinned = pinned
    self.customTitle = customTitle
    self.groupId = groupId
    self.windowIndex = windowIndex
    self.active = active
    self.lastActive = lastActive
  }
}

/// A browser's open windows, flattened: tabs in window/visual order plus their groups.
public struct OpenTabs: Equatable, Sendable {
  public var tabs: [ImportedTab]
  public var groups: [ImportedTabGroup]
}

public struct ImportedTabGroup: Codable, Equatable, Sendable {
  public var id: String
  public var title: String
  /// Chromium/Firefox colour name: grey, blue, red, yellow, green, pink, purple, cyan, orange.
  public var color: String
  public var collapsed: Bool
}

public struct Credential: Codable, Equatable, Sendable {
  /// The page the login was saved on (Chromium `origin_url`, Firefox `hostname`, CSV `url`).
  public var url: String
  public var username: String
  public var password: String
  /// Chromium's `signon_realm` / Firefox's `httpRealm`: what the login actually matches.
  public var realm: String?
  public var title: String?
  public var note: String?
  /// `otpauth://` URL from Safari exports.
  public var otpAuth: String?
  public var created: Double?
  public var lastUsed: Double?
  public var timesUsed: Int?

  public init(url: String, username: String, password: String, realm: String? = nil, title: String? = nil,
              note: String? = nil, otpAuth: String? = nil, created: Double? = nil, lastUsed: Double? = nil,
              timesUsed: Int? = nil) {
    self.url = url
    self.username = username
    self.password = password
    self.realm = realm
    self.title = title
    self.note = note
    self.otpAuth = otpAuth
    self.created = created
    self.lastUsed = lastUsed
    self.timesUsed = timesUsed
  }
}

public struct Cookie: Codable, Equatable, Sendable {
  /// Chromium `host_key`: a leading dot means the cookie applies to subdomains.
  public var domain: String
  public var name: String
  public var value: String
  public var path: String
  /// nil for a session cookie.
  public var expires: Double?
  public var secure: Bool
  public var httpOnly: Bool
  /// "unspecified", "none", "lax" or "strict".
  public var sameSite: String
  public var created: Double?
}

/// An Arc space, proposed as a Netnyahoo profile/space.
public struct SpaceSuggestion: Codable, Equatable, Sendable {
  public var id: String
  public var name: String
  /// `#RRGGBB`, the theme's mid tone.
  public var color: String?
  /// Every base colour of the theme's gradient, when it has one.
  public var colors: [String]?
  public var emoji: String?
  /// SF Symbol-style icon name Arc uses when the space has no emoji.
  public var icon: String?
  /// Source browser profile directory the space browses with.
  public var profileId: String
  /// Pinned section as a tree (folders + tabs with custom titles).
  public var pinned: [BookmarkNode]
  /// Unpinned ("Today") tabs.
  public var tabs: [ImportedTab]
}

/// A source browser profile, proposed as a Netnyahoo profile.
public struct ProfileSuggestion: Codable, Equatable, Sendable {
  public var name: String
  public var color: String?
  public var avatarPath: String?
}

public struct ImportWarning: Codable, Equatable, Sendable {
  public var kind: ImportKind?
  public var code: String
  public var message: String

  public init(_ kind: ImportKind?, _ code: String, _ message: String) {
    self.kind = kind
    self.code = code
    self.message = message
  }
}

public struct ImportResult: Codable, Equatable, Sendable {
  public var browserId: String
  public var profileId: String
  public var profile: ProfileSuggestion?
  public var bookmarks: BookmarkNode?
  /// Empty when the caller streamed history in chunks instead (see `ImportOptions.streamHistory`).
  public var history: [HistoryEntry] = []
  public var historyCount = 0
  public var tabs: [ImportedTab] = []
  public var tabGroups: [ImportedTabGroup] = []
  public var credentials: [Credential] = []
  public var cookies: [Cookie] = []
  public var spaces: [SpaceSuggestion] = []
  public var favorites: [ImportedTab] = []
  /// Kinds that were asked for and could not be read ("Some import steps failed:").
  public var failed: [ImportKind] = []
  public var warnings: [ImportWarning] = []

  public init(browserId: String, profileId: String) {
    self.browserId = browserId
    self.profileId = profileId
  }
}

public enum ImportError: Error, Equatable, CustomStringConvertible {
  case cancelled
  case notFound(String)
  case unreadable(String)
  case unsupported(String)
  /// The user denied (or hasn't yet granted) the Keychain / primary password, or Automation.
  case locked(String)
  /// The source app has to be running (Dia's tabs come from Dia itself).
  case notRunning(String)

  public var code: String {
    switch self {
    case .cancelled: "cancelled"
    case .notFound: "notFound"
    case .unreadable: "unreadable"
    case .unsupported: "unsupported"
    case .locked: "locked"
    case .notRunning: "notRunning"
    }
  }

  public var description: String {
    switch self {
    case .cancelled: "Import cancelled"
    case .notFound(let s), .unreadable(let s), .unsupported(let s), .locked(let s), .notRunning(let s): s
    }
  }
}

/// Checked by every parser between items so the UI's Cancel is honoured mid-file.
public final class Cancellation: @unchecked Sendable {
  private let lock = NSLock()
  private var flag = false

  public init() {}

  public var isCancelled: Bool { lock.withLock { flag } }
  public func cancel() { lock.withLock { flag = true } }
  public func check() throws { if isCancelled { throw ImportError.cancelled } }
}

public struct ImportProgress: Equatable, Sendable {
  public enum Phase: String, Sendable { case start, progress, end }
  public var kind: ImportKind
  public var phase: Phase
  public var processed: Int
  public var total: Int?
}

/// Callbacks for long imports. `history` receives chunks of `chunkSize` entries.
public struct ImportObserver: Sendable {
  public var progress: @Sendable (ImportProgress) -> Void
  public var history: (@Sendable ([HistoryEntry]) -> Void)?
  public var chunkSize: Int

  public init(chunkSize: Int = 1000, progress: @escaping @Sendable (ImportProgress) -> Void = { _ in },
              history: (@Sendable ([HistoryEntry]) -> Void)? = nil) {
    self.chunkSize = max(1, chunkSize)
    self.progress = progress
    self.history = history
  }

  public static let silent = ImportObserver()
}

public struct ImportOptions: Sendable {
  /// Newest-first cap on history entries (nil = everything).
  public var historyLimit: Int?
  /// Only history visited at or after this Unix ms time.
  public var historySince: Double?
  /// Arc: only these space ids ("Customize which spaces to bring over").
  public var spaceIds: Set<String>?
  /// Deliver history through `ImportObserver.history` instead of `ImportResult.history`.
  public var streamHistory = false

  public init(historyLimit: Int? = nil, historySince: Double? = nil, spaceIds: Set<String>? = nil, streamHistory: Bool = false) {
    self.historyLimit = historyLimit
    self.historySince = historySince
    self.spaceIds = spaceIds
    self.streamHistory = streamHistory
  }
}

enum Time {
  /// Chromium/WebKit time: microseconds since 1601-01-01 UTC.
  static func fromWebKit(_ micros: Int64) -> Double? {
    guard micros > 0 else { return nil }
    return Double(micros - 11_644_473_600_000_000) / 1000
  }

  static func fromWebKit(_ string: String?) -> Double? {
    string.flatMap { Int64($0) }.flatMap { fromWebKit($0) }
  }

  /// Firefox/Safari PRTime: microseconds since the Unix epoch.
  static func fromUnixMicros(_ micros: Int64) -> Double? {
    micros > 0 ? Double(micros) / 1000 : nil
  }
}

enum Hex {
  static func color(red: Double, green: Double, blue: Double) -> String {
    func byte(_ v: Double) -> Int { Int((min(max(v, 0), 1) * 255).rounded()) }
    return String(format: "#%02X%02X%02X", byte(red), byte(green), byte(blue))
  }

  /// Skia `SkColor` (ARGB packed in a signed 32-bit int, as Local State stores it).
  static func color(skColor: Int) -> String {
    let v = UInt32(truncatingIfNeeded: skColor)
    return String(format: "#%02X%02X%02X", (v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF)
  }
}

extension URL {
  /// http(s) only: `chrome://`, `about:`, `javascript:` and `file:` rows have nowhere useful to go.
  static func isWebURL(_ string: String) -> Bool {
    guard let scheme = string.split(separator: ":", maxSplits: 1).first?.lowercased() else { return false }
    return scheme == "http" || scheme == "https"
  }
}
