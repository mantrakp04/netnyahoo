import Foundation

public enum SafariDirect {
  static let cocoaEpoch = 978_307_200.0

  static func directory(home: URL) -> URL {
    home.appendingPathComponent("Library/Safari", isDirectory: true)
  }

  public static func hasAccess(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> Bool {
    let dir = directory(home: home)
    for name in ["Bookmarks.plist", "History.db"] {
      let file = dir.appendingPathComponent(name)
      guard FileManager.default.fileExists(atPath: file.path) else { continue }
      if let handle = try? FileHandle(forReadingFrom: file) {
        try? handle.close()
        return true
      }
    }
    return false
  }

  public static func load(home: URL = FileManager.default.homeDirectoryForCurrentUser,
                          cancellation: Cancellation = .init()) throws -> SafariExport {
    let dir = directory(home: home)
    guard hasAccess(home: home) else {
      throw ImportError.locked("Netnyahoo needs Full Disk Access to read Safari's data.")
    }
    var out = SafariExport()
    var history: [HistoryEntry] = []

    func step(_ code: String, _ body: () throws -> Void) {
      do { try body() } catch let error as ImportError where error == .cancelled {
      } catch let error as ImportError {
        out.warnings.append(ImportWarning(nil, code, error.description))
      } catch {
        out.warnings.append(ImportWarning(nil, code, error.localizedDescription))
      }
    }

    try cancellation.check()
    step("unreadableBookmarks") {
      out.bookmarks = try bookmarks(dir.appendingPathComponent("Bookmarks.plist"))
    }
    try cancellation.check()
    step("unreadableHistory") {
      history = try readHistory(dir.appendingPathComponent("History.db"), cancellation: cancellation)
    }
    try cancellation.check()
    step("unreadableTabs") {
      out.tabs = tabs(dir.appendingPathComponent("LastSession.plist"))
    }
    out.profiles = [SafariExport.Profile(name: nil, history: history, extensions: [])]
    return out
  }

  // MARK: Bookmarks

  static func bookmarks(_ url: URL) throws -> BookmarkNode {
    guard FileManager.default.fileExists(atPath: url.path) else { throw ImportError.notFound("No Safari bookmarks") }
    let data = try Data(contentsOf: url)
    guard let top = try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any] else {
      throw ImportError.unreadable("Bookmarks.plist isn't a Safari bookmarks file")
    }
    var children: [BookmarkNode] = []
    for child in top["Children"] as? [[String: Any]] ?? [] {
      guard let node = parse(child) else { continue }
      children.append(role(node, child))
    }
    return .folder("Bookmarks", children)
  }

  private static func role(_ node: BookmarkNode, _ json: [String: Any]) -> BookmarkNode {
    var node = node
    let id = (json["WebBookmarkIdentifier"] as? String) ?? (json["Title"] as? String) ?? ""
    switch id {
    case "BookmarksBar": node.role = "toolbar"; node.title = "Bookmarks Bar"
    case "BookmarksMenu": node.role = "menu"; node.title = "Bookmarks Menu"
    case "com.apple.ReadingList": node.role = "readingList"; node.title = "Reading List"
    default: node.role = "other"
    }
    return node
  }

  private static func parse(_ json: [String: Any]) -> BookmarkNode? {
    switch json["WebBookmarkType"] as? String {
    case "WebBookmarkTypeLeaf":
      guard let url = json["URLString"] as? String, !url.isEmpty else { return nil }
      let title = (json["URIDictionary"] as? [String: Any])?["title"] as? String ?? url
      let added = (json["ReadingList"] as? [String: Any])?["DateAdded"] as? Date
      return .link(title, url, dateAdded: added.map { $0.timeIntervalSince1970 * 1000 })
    case "WebBookmarkTypeList":
      let kids = (json["Children"] as? [[String: Any]] ?? []).compactMap(parse)
      if kids.isEmpty, json["WebBookmarkIdentifier"] != nil { return nil }
      return .folder(json["Title"] as? String ?? "", kids)
    default:
      return nil
    }
  }

  // MARK: History

  static func readHistory(_ url: URL, cancellation: Cancellation) throws -> [HistoryEntry] {
    guard FileManager.default.fileExists(atPath: url.path) else { throw ImportError.notFound("No Safari history") }
    let db = try SQLiteSnapshot(copying: url)
    guard db.tableExists("history_items"), db.tableExists("history_visits") else {
      throw ImportError.unreadable("History.db isn't a Safari history database")
    }
    let sql = """
      SELECT i.url AS url, i.visit_count AS visit_count, MAX(v.visit_time) AS visit_time,
             (SELECT title FROM history_visits WHERE history_item = i.id AND title IS NOT NULL
              ORDER BY visit_time DESC LIMIT 1) AS title
      FROM history_items i JOIN history_visits v ON v.history_item = i.id
      GROUP BY i.id ORDER BY visit_time DESC
      """
    var entries: [HistoryEntry] = []
    var count = 0
    try db.query(sql) { row in
      if count % 256 == 0 { try cancellation.check() }
      count += 1
      guard let url = row.text("url"), URL.isWebURL(url) else { return true }
      let seconds = row.int("visit_time") ?? 0
      entries.append(HistoryEntry(url: url, title: row.text("title") ?? "",
                                  visits: max(1, Int(row.int("visit_count") ?? 1)),
                                  lastVisit: seconds > 0 ? (Double(seconds) + cocoaEpoch) * 1000 : 0,
                                  typedCount: nil))
      return true
    }
    return entries
  }

  // MARK: Open tabs

  static func tabs(_ url: URL) -> [ImportedTab] {
    guard FileManager.default.fileExists(atPath: url.path),
          let data = try? Data(contentsOf: url),
          let top = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any] else { return [] }
    var out: [ImportedTab] = []
    for (windowIndex, window) in (top["SessionWindows"] as? [[String: Any]] ?? []).enumerated() {
      let selected = (window["SelectedTabIndex"] as? NSNumber)?.intValue ?? 0
      for (i, tab) in (window["TabStates"] as? [[String: Any]] ?? []).enumerated() {
        guard let url = tab["TabURL"] as? String, URL.isWebURL(url) else { continue }
        out.append(ImportedTab(url: url, title: tab["TITLE"] as? String ?? "", pinned: false,
                               windowIndex: windowIndex, active: i == selected))
      }
    }
    return out
  }
}
