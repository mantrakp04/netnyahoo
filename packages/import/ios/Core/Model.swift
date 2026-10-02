import Foundation

public enum ImportKind: String, Codable, CaseIterable, Sendable {
  case bookmarks, history, tabs, passwords, cookies
  case autofill
  case spaces
  case pinnedTabs
  case favorites
}

public struct BookmarkNode: Codable, Equatable, Sendable {
  public enum NodeType: String, Codable, Sendable { case folder, url }

  public var type: NodeType
  public var title: String
  public var url: String?
  public var dateAdded: Double?
  public var children: [BookmarkNode]?
  public var role: String?
  public var pageTitle: String?

  public static func folder(_ title: String, _ children: [BookmarkNode], role: String? = nil, dateAdded: Double? = nil) -> BookmarkNode {
    BookmarkNode(type: .folder, title: title, url: nil, dateAdded: dateAdded, children: children, role: role, pageTitle: nil)
  }

  public static func link(_ title: String, _ url: String, dateAdded: Double? = nil) -> BookmarkNode {
    BookmarkNode(type: .url, title: title, url: url, dateAdded: dateAdded, children: nil, role: nil, pageTitle: nil)
  }

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
  public var customTitle: String?
  public var groupId: String?
  public var windowIndex: Int
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

public struct OpenTabs: Equatable, Sendable {
  public var tabs: [ImportedTab]
  public var groups: [ImportedTabGroup]
}

public struct ImportedTabGroup: Codable, Equatable, Sendable {
  public var id: String
  public var title: String
  public var color: String
  public var collapsed: Bool
}

public struct Credential: Codable, Equatable, Sendable {
  public var url: String
  public var username: String
  public var password: String
  public var realm: String?
  public var title: String?
  public var note: String?
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

public struct CookiePartition: Equatable, Sendable {
  public var topLevelSite: String
  public var crossSite: Bool

  public init(topLevelSite: String, crossSite: Bool) {
    self.topLevelSite = topLevelSite
    self.crossSite = crossSite
  }
}

// Times are ms since the Unix epoch. `expires` nil = session cookie. `value` never leaves SecretBytes.
public struct Cookie: Equatable, Sendable {
  public var domain: String
  public var name: String
  public var value: SecretBytes
  public var path: String
  public var created: Double?
  public var expires: Double?
  public var lastAccess: Double?
  public var secure: Bool
  public var httpOnly: Bool
  public var sameSite: String      // "unspecified" | "none" | "lax" | "strict"
  public var priority: String      // "low" | "medium" | "high"
  public var partition: CookiePartition?
  public var sourceScheme: String  // "unset" | "nonSecure" | "secure"
  public var sourcePort: Int       // -1 = unspecified

  public init(domain: String, name: String, value: SecretBytes, path: String = "/", created: Double? = nil,
              expires: Double? = nil, lastAccess: Double? = nil, secure: Bool = false, httpOnly: Bool = false,
              sameSite: String = "unspecified", priority: String = "medium", partition: CookiePartition? = nil,
              sourceScheme: String = "unset", sourcePort: Int = -1) {
    self.domain = domain
    self.name = name
    self.value = value
    self.path = path
    self.created = created
    self.expires = expires
    self.lastAccess = lastAccess
    self.secure = secure
    self.httpOnly = httpOnly
    self.sameSite = sameSite
    self.priority = priority
    self.partition = partition
    self.sourceScheme = sourceScheme
    self.sourcePort = sourcePort
  }
}

public struct ImportedAddress: Codable, Equatable, Sendable {
  public var name: String?
  public var organization: String?
  public var street: String?
  public var city: String?
  public var state: String?
  public var postalCode: String?
  public var country: String?  // ISO 3166-1 alpha-2 ("US")
  public var phone: String?
  public var email: String?

  public init(name: String? = nil, organization: String? = nil, street: String? = nil, city: String? = nil,
              state: String? = nil, postalCode: String? = nil, country: String? = nil, phone: String? = nil,
              email: String? = nil) {
    self.name = name
    self.organization = organization
    self.street = street
    self.city = city
    self.state = state
    self.postalCode = postalCode
    self.country = country
    self.phone = phone
    self.email = email
  }

  var isEmpty: Bool {
    [name, organization, street, city, state, postalCode, country, phone, email].allSatisfy { $0 == nil }
  }
}

public struct ImportedCard: Equatable, Sendable {
  public var name: String?
  public var number: SecretBytes
  public var expMonth: Int?
  public var expYear: Int?
  public var nickname: String?

  public init(name: String? = nil, number: SecretBytes, expMonth: Int? = nil, expYear: Int? = nil, nickname: String? = nil) {
    self.name = name
    self.number = number
    self.expMonth = expMonth
    self.expYear = expYear
    self.nickname = nickname
  }
}

public struct SpaceSuggestion: Codable, Equatable, Sendable {
  public var id: String
  public var name: String
  public var color: String?
  public var colors: [String]?
  public var emoji: String?
  public var icon: String?
  public var profileId: String
  public var pinned: [BookmarkNode]
  public var tabs: [ImportedTab]
}

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
  public var history: [HistoryEntry] = []
  public var historyCount = 0
  public var tabs: [ImportedTab] = []
  public var tabGroups: [ImportedTabGroup] = []
  public var credentials: [Credential] = []
  public var spaces: [SpaceSuggestion] = []
  public var favorites: [ImportedTab] = []
  public var failed: [ImportKind] = []
  public var warnings: [ImportWarning] = []
  public var vaultToken: String?

  // Secrets: never encoded to JSON. Only their counts are.
  public var cookies: [Cookie] = [] { didSet { cookieCount = cookies.count } }
  public var addresses: [ImportedAddress] = [] { didSet { addressCount = addresses.count } }
  public var cards: [ImportedCard] = [] { didSet { cardCount = cards.count } }
  public private(set) var cookieCount = 0
  public private(set) var addressCount = 0
  public private(set) var cardCount = 0

  enum CodingKeys: String, CodingKey {
    case browserId, profileId, profile, bookmarks, history, historyCount, tabs, tabGroups, credentials, spaces, favorites,
         failed, warnings, vaultToken, cookieCount, addressCount, cardCount
  }

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
  case locked(String)
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
  public var historyLimit: Int?
  public var historySince: Double?
  public var spaceIds: Set<String>?
  public var streamHistory = false

  public init(historyLimit: Int? = nil, historySince: Double? = nil, spaceIds: Set<String>? = nil, streamHistory: Bool = false) {
    self.historyLimit = historyLimit
    self.historySince = historySince
    self.spaceIds = spaceIds
    self.streamHistory = streamHistory
  }
}

enum Time {
  static func fromWebKit(_ micros: Int64) -> Double? {
    guard micros > 0 else { return nil }
    return Double(micros - 11_644_473_600_000_000) / 1000
  }

  static func fromWebKit(_ string: String?) -> Double? {
    string.flatMap { Int64($0) }.flatMap { fromWebKit($0) }
  }

  static func fromUnixMicros(_ micros: Int64) -> Double? {
    micros > 0 ? Double(micros) / 1000 : nil
  }
}

enum Hex {
  static func color(red: Double, green: Double, blue: Double) -> String {
    func byte(_ v: Double) -> Int { Int((min(max(v, 0), 1) * 255).rounded()) }
    return String(format: "#%02X%02X%02X", byte(red), byte(green), byte(blue))
  }

  static func color(skColor: Int) -> String {
    let v = UInt32(truncatingIfNeeded: skColor)
    return String(format: "#%02X%02X%02X", (v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF)
  }
}

extension URL {
  static func isWebURL(_ string: String) -> Bool {
    guard let scheme = string.split(separator: ":", maxSplits: 1).first?.lowercased() else { return false }
    return scheme == "http" || scheme == "https"
  }
}
