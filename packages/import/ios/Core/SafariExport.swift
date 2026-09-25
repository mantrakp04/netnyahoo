import Foundation

/// Safari's File › Export Browsing Data archive (Safari 18.2+), as a .zip or an unzipped
/// folder. With Full Disk Access, `SafariDirect` reads Safari's live data instead; the archive
/// stays the fallback and the only way to bring Safari's passwords.
///
/// Contents (en_US names; other locales translate them, so files are recognised by type and
/// by the JSON `metadata.data_type`, not by name):
/// - `Bookmarks.html`: Netscape format; the Reading List is the folder with
///   `id="com.apple.ReadingList"`.
/// - `Passwords.csv`: `Title,URL,Username,Password,Notes,OTPAuth`.
/// - `History.json` (one per Safari profile, suffixed with the profile name):
///   `{"metadata": {"data_type": "history", …}, "history": [{"url", "title"?, "time_usec",
///   "visit_count", "destination_url"?, "source_url"?, …}]}`.
/// - `Extensions.json`: `{"extensions": [{"display_name", "developer_name", …}]}`.
/// - `PaymentCards.json`: not imported (Netnyahoo has no card storage).
public struct SafariExport: Codable, Equatable, Sendable {
  public struct Profile: Codable, Equatable, Sendable {
    /// nil for the default profile.
    public var name: String?
    public var history: [HistoryEntry]
    public var extensions: [String]
  }

  public var bookmarks: BookmarkNode?
  public var credentials: [Credential] = []
  public var profiles: [Profile] = []
  /// Open tabs, only from a direct import (`SafariDirect`); the export archive has none.
  public var tabs: [ImportedTab] = []
  public var warnings: [ImportWarning] = []

  public static func load(_ url: URL, cancellation: Cancellation = .init()) throws -> SafariExport {
    var isDir: ObjCBool = false
    guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir) else {
      throw ImportError.notFound("\(url.lastPathComponent) doesn't exist")
    }
    var files: [(name: String, read: () throws -> Data)] = []
    if isDir.boolValue {
      let walker = FileManager.default.enumerator(at: url, includingPropertiesForKeys: [.isRegularFileKey])
      while let file = walker?.nextObject() as? URL {
        guard (try? file.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true else { continue }
        files.append((file.lastPathComponent, { try Data(contentsOf: file) }))
      }
    } else {
      let zip = try ZipArchive(Data(contentsOf: url, options: .mappedIfSafe))
      for entry in zip.entries where !entry.name.hasSuffix("/") && !entry.name.hasPrefix("__MACOSX/") {
        files.append(((entry.name as NSString).lastPathComponent, { try zip.extract(entry) }))
      }
    }
    return try parse(files: files.filter { !$0.name.hasPrefix(".") }, cancellation: cancellation)
  }

  static func parse(files: [(name: String, read: () throws -> Data)], cancellation: Cancellation) throws -> SafariExport {
    var out = SafariExport()
    var recognised = false
    for file in files.sorted(by: { $0.name < $1.name }) {
      try cancellation.check()
      let ext = (file.name as NSString).pathExtension.lowercased()
      do {
        switch ext {
        case "html", "htm":
          let data = try file.read()
          let html = String(data: data, encoding: .utf8) ?? String(decoding: data, as: UTF8.self)
          guard html.range(of: "NETSCAPE-Bookmark-file", options: .caseInsensitive) != nil else { continue }
          recognised = true
          let parsed = NetscapeBookmarks.parse(html)
          if out.bookmarks == nil {
            out.bookmarks = parsed
          } else {
            out.bookmarks?.children?.append(contentsOf: parsed.children ?? [])
          }
        case "csv":
          let data = try file.read()
          out.credentials += try PasswordsCSV.parse(String(decoding: data, as: UTF8.self))
          recognised = true
        case "json":
          let data = try file.read()
          guard let top = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
          let type = (top["metadata"] as? [String: Any])?["data_type"] as? String
          let profile = profileName(file.name)
          switch type ?? (top["history"] != nil ? "history" : top["extensions"] != nil ? "extensions" : "") {
          case "history":
            recognised = true
            let history = entries(top["history"] as? [[String: Any]] ?? [])
            out.update(profile) { $0.history += history }
          case "extensions":
            recognised = true
            let names = (top["extensions"] as? [[String: Any]] ?? []).compactMap { $0["display_name"] as? String }
            out.update(profile) { $0.extensions += names }
          default:
            continue
          }
        default:
          continue
        }
      } catch let error as ImportError where error == .cancelled {
        throw error
      } catch {
        out.warnings.append(ImportWarning(nil, "unreadableFile", "Couldn't read \(file.name): \(error)"))
      }
    }
    guard recognised else { throw ImportError.unreadable("This doesn't look like a Safari export. Choose the .zip file Safari saved.") }
    return out
  }

  private mutating func update(_ name: String?, _ change: (inout Profile) -> Void) {
    if let i = profiles.firstIndex(where: { $0.name == name }) {
      change(&profiles[i])
    } else {
      var p = Profile(name: name, history: [], extensions: [])
      change(&p)
      profiles.append(p)
    }
  }

  /// "History.json" → nil (default profile); "History_Work.json" / "History - Work.json" → "Work".
  static func profileName(_ file: String) -> String? {
    let stem = (file as NSString).deletingPathExtension
    for separator in [" - ", "_"] {
      if let r = stem.range(of: separator) {
        let name = stem[r.upperBound...].trimmingCharacters(in: .whitespaces)
        return name.isEmpty ? nil : name
      }
    }
    return nil
  }

  /// Newest first. Hops that redirected elsewhere (`destination_url`) are dropped: the page
  /// the user actually landed on is its own entry.
  static func entries(_ rows: [[String: Any]]) -> [HistoryEntry] {
    rows.compactMap { row -> HistoryEntry? in
      guard let url = row["url"] as? String, URL.isWebURL(url), row["destination_url"] == nil else { return nil }
      let micros = (row["time_usec"] as? NSNumber)?.int64Value ?? 0
      let visits = (row["visit_count"] as? Int) ?? (row["visits_count"] as? Int) ?? 1
      return HistoryEntry(url: url, title: row["title"] as? String ?? "", visits: max(1, visits),
                          lastVisit: Time.fromUnixMicros(micros) ?? 0, typedCount: nil)
    }
    .sorted { $0.lastVisit > $1.lastVisit }
  }
}
