import Compression
import Foundation

/// Firefox (and forks with the same profile layout): `profiles.ini`, bookmarks from
/// `places.sqlite`, and open tabs from the mozlz4 session store.
public enum Firefox {
  public struct Profile: Equatable {
    public var name: String
    /// Relative to the Firefox data directory for `IsRelative=1` profiles.
    public var path: String
    public var isDefault: Bool
  }

  /// `profiles.ini`: `[ProfileN]` sections with `Name`, `Path`, `IsRelative`, `Default`, plus
  /// `[Install…]` sections whose `Default=` names the profile that install actually opens —
  /// that one wins over the legacy `Default=1` flag.
  public static func profiles(ini: String) -> [Profile] {
    var sections: [(name: String, values: [String: String])] = []
    for raw in ini.split(whereSeparator: \.isNewline) {
      let line = raw.trimmingCharacters(in: .whitespaces)
      if line.isEmpty || line.hasPrefix(";") || line.hasPrefix("#") { continue }
      if line.hasPrefix("["), line.hasSuffix("]") {
        sections.append((String(line.dropFirst().dropLast()), [:]))
      } else if let eq = line.firstIndex(of: "="), !sections.isEmpty {
        sections[sections.count - 1].values[String(line[..<eq])] = String(line[line.index(after: eq)...])
      }
    }
    let installDefaults = Set(sections.filter { $0.name.hasPrefix("Install") }.compactMap { $0.values["Default"] })
    var out: [Profile] = []
    for s in sections where s.name.hasPrefix("Profile") {
      guard let path = s.values["Path"], !path.isEmpty else { continue }
      let isDefault = installDefaults.isEmpty ? s.values["Default"] == "1" : installDefaults.contains(path)
      out.append(Profile(name: s.values["Name"] ?? path, path: path, isDefault: isDefault))
    }
    return out.sorted { $0.isDefault && !$1.isDefault }
  }

  // MARK: Bookmarks

  static let roots: [String: (role: String, title: String)] = [
    "toolbar_____": ("toolbar", "Bookmarks Toolbar"),
    "menu________": ("menu", "Bookmarks Menu"),
    "unfiled_____": ("other", "Other Bookmarks"),
    "mobile______": ("mobile", "Mobile Bookmarks"),
  ]

  /// `moz_bookmarks` (type 1 = bookmark, 2 = folder, 3 = separator) joined to `moz_places`.
  /// Tags (`tags________`) and `place:` queries (smart folders) are left out.
  public static func bookmarks(places: URL, cancellation: Cancellation = .init()) throws -> BookmarkNode {
    let db = try SQLiteSnapshot(copying: places)
    guard db.tableExists("moz_bookmarks") else { throw ImportError.unreadable("places.sqlite has no bookmarks") }
    struct Row { var id: Int64; var type: Int64; var parent: Int64; var title: String; var url: String?; var added: Double?; var guid: String }
    var children: [Int64: [Row]] = [:]
    var rootId: Int64?
    try db.query("""
      SELECT b.id, b.type, b.parent, b.title, p.url, b.dateAdded, b.guid
      FROM moz_bookmarks b LEFT JOIN moz_places p ON b.fk = p.id
      ORDER BY b.parent, b.position
      """) { r in
      let row = Row(id: r.int(0), type: r.int(1), parent: r.int(2), title: r.text(3) ?? "", url: r.text(4),
                    added: r.isNull(5) ? nil : Time.fromUnixMicros(r.int(5)), guid: r.text(6) ?? "")
      if row.guid == "root________" { rootId = row.id } else { children[row.parent, default: []].append(row) }
      return true
    }
    try cancellation.check()
    func build(_ parent: Int64, depth: Int) -> [BookmarkNode] {
      guard depth < 64 else { return [] }
      return (children[parent] ?? []).compactMap { row in
        switch row.type {
        case 1:
          guard let url = row.url, !url.hasPrefix("place:") else { return nil }
          return .link(row.title, url, dateAdded: row.added)
        case 2:
          return .folder(row.title, build(row.id, depth: depth + 1), dateAdded: row.added)
        default:
          return nil
        }
      }
    }
    guard let rootId else { throw ImportError.unreadable("places.sqlite has no bookmarks root") }
    var top: [BookmarkNode] = []
    // Toolbar first, like Chromium's bookmark bar.
    let order = ["toolbar_____", "menu________", "unfiled_____", "mobile______"]
    for row in (children[rootId] ?? []).sorted(by: { (order.firstIndex(of: $0.guid) ?? 99) < (order.firstIndex(of: $1.guid) ?? 99) }) {
      guard let root = roots[row.guid] else { continue }
      let kids = build(row.id, depth: 0)
      guard !kids.isEmpty else { continue }
      top.append(.folder(root.title, kids, role: root.role, dateAdded: row.added))
    }
    return .folder("Bookmarks", top)
  }

  // MARK: Cookies

  /// `cookies.sqlite` `moz_cookies`: stored in the clear (expiry in seconds, creation in µs).
  public static func cookies(profile: URL, cancellation: Cancellation = .init()) throws -> [Cookie] {
    let db = try SQLiteSnapshot(copying: profile.appendingPathComponent("cookies.sqlite"))
    guard db.tableExists("moz_cookies") else { throw ImportError.unreadable("cookies.sqlite has no cookies") }
    let now = Date().timeIntervalSince1970 * 1000
    var out: [Cookie] = []
    try db.query("SELECT * FROM moz_cookies") { row in
      if out.count % 256 == 0 { try cancellation.check() }
      guard let host = row.text("host"), let name = row.text("name") else { return true }
      // Firefox ≥ 110 writes expiry in ms, older builds in seconds.
      let expiry = row.int("expiry").map { Double($0) }.map { $0 > 100_000_000_000 ? $0 : $0 * 1000 }
      if let expiry, expiry < now { return true }
      let sameSite: String
      switch row.int("sameSite") {
      case 0: sameSite = "none"
      case 1: sameSite = "lax"
      case 2: sameSite = "strict"
      default: sameSite = "unspecified"
      }
      out.append(Cookie(domain: host, name: name, value: row.text("value") ?? "", path: row.text("path") ?? "/",
                        expires: expiry, secure: (row.int("isSecure") ?? 0) != 0, httpOnly: (row.int("isHttpOnly") ?? 0) != 0,
                        sameSite: sameSite, created: row.int("creationTime").flatMap(Time.fromUnixMicros)))
      return true
    }
    return out
  }

  // MARK: Session store

  /// The freshest session store: `sessionstore-backups/recovery.jsonlz4` while Firefox runs,
  /// `sessionstore.jsonlz4` after a clean quit, else the previous backup.
  public static func sessionFile(profile: URL) -> URL? {
    let candidates = ["sessionstore-backups/recovery.jsonlz4", "sessionstore.jsonlz4", "sessionstore-backups/previous.jsonlz4"]
      .map { profile.appendingPathComponent($0) }
      .filter { FileManager.default.fileExists(atPath: $0.path) }
    return candidates.max { modified($0) < modified($1) }
  }

  private static func modified(_ url: URL) -> Date {
    (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
  }

  /// mozlz4: "mozLz40\0", uint32 LE decompressed size, one raw LZ4 block.
  public static func decompressMozLz4(_ data: Data) throws -> Data {
    let magic = Data("mozLz40\0".utf8)
    guard data.count > 12, data.prefix(8) == magic else { throw ImportError.unreadable("Not a mozlz4 file") }
    var sizeReader = ByteReader(data.subdata(in: 8..<12))
    guard let size = sizeReader.u32(), size > 0, size < 1 << 30 else { throw ImportError.unreadable("Bad mozlz4 size") }
    let src = data.subdata(in: 12..<data.count)
    var out = Data(count: Int(size))
    let written = out.withUnsafeMutableBytes { dst in
      src.withUnsafeBytes { s in
        compression_decode_buffer(dst.bindMemory(to: UInt8.self).baseAddress!, Int(size),
                                  s.bindMemory(to: UInt8.self).baseAddress!, src.count, nil, COMPRESSION_LZ4_RAW)
      }
    }
    guard written == Int(size) else { throw ImportError.unreadable("Couldn't decompress the session store") }
    return out
  }

  /// `windows[].tabs[]`: `entries[{url,title}]`, 1-based `index` of the current entry,
  /// `pinned`, `hidden`, `lastAccessed` (ms), `groupId`; `windows[].groups[]` (Firefox 137+
  /// tab groups) and `windows[].selected` (1-based).
  public static func session(_ json: Data) throws -> OpenTabs {
    guard let top = try? JSONSerialization.jsonObject(with: json) as? [String: Any],
          let windows = top["windows"] as? [[String: Any]] else {
      throw ImportError.unreadable("Session store has no windows")
    }
    var tabs: [ImportedTab] = []
    var groups: [ImportedTabGroup] = []
    for (w, window) in windows.enumerated() {
      let selected = (window["selected"] as? Int ?? 1) - 1
      for (position, tab) in (window["tabs"] as? [[String: Any]] ?? []).enumerated() {
        if tab["hidden"] as? Bool == true { continue }
        let entries = tab["entries"] as? [[String: Any]] ?? []
        guard !entries.isEmpty else { continue }
        let index = min(max((tab["index"] as? Int ?? entries.count) - 1, 0), entries.count - 1)
        guard let url = entries[index]["url"] as? String, !url.isEmpty else { continue }
        tabs.append(ImportedTab(url: url, title: entries[index]["title"] as? String ?? "",
                                pinned: tab["pinned"] as? Bool ?? false, groupId: tab["groupId"] as? String,
                                windowIndex: w, active: position == selected,
                                lastActive: (tab["lastAccessed"] as? NSNumber)?.doubleValue))
      }
      for g in window["groups"] as? [[String: Any]] ?? [] {
        guard let id = g["id"] as? String else { continue }
        groups.append(ImportedTabGroup(id: id, title: g["name"] as? String ?? "", color: g["color"] as? String ?? "grey",
                                       collapsed: g["collapsed"] as? Bool ?? false))
      }
    }
    return OpenTabs(tabs: tabs, groups: groups)
  }

  public static func loadSession(profile: URL) throws -> OpenTabs {
    guard let file = sessionFile(profile: profile) else { throw ImportError.notFound("No session store in this profile") }
    return try session(decompressMozLz4(Data(contentsOf: file)))
  }
}
