import Foundation

public struct SafariExport: Codable, Equatable, Sendable {
  public struct Profile: Codable, Equatable, Sendable {
    public var name: String?
    public var history: [HistoryEntry]
    public var extensions: [String]
  }

  public var bookmarks: BookmarkNode?
  public var credentials: [Credential] = []
  public var profiles: [Profile] = []
  public var tabs: [ImportedTab] = []
  public var warnings: [ImportWarning] = []
  public var vaultToken: String?

  // Secrets: never encoded to JSON. Only their counts are.
  public var cookies: [Cookie] = [] { didSet { cookieCount = cookies.count } }
  public var cards: [ImportedCard] = [] { didSet { cardCount = cards.count } }
  public private(set) var cookieCount = 0
  public private(set) var cardCount = 0

  enum CodingKeys: String, CodingKey {
    case bookmarks, credentials, profiles, tabs, warnings, vaultToken, cookieCount, cardCount
  }

  public init() {}

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
          var data = try file.read()
          // Card numbers must never reach JSONSerialization (it would make Strings of them).
          if data.range(of: Data("\"payment_cards\"".utf8)) != nil {
            defer { data.resetBytes(in: 0..<data.count) }
            recognised = true
            out.cards += try paymentCards(&data)
            continue
          }
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

  // PaymentCards.json: {"payment_cards":[{"card_number","card_name","cardholder_name","card_expiration_month",
  // "card_expiration_year"}]}. card_name is the card's nickname. Numbers are plaintext in the file: they're
  // copied from the raw bytes into SecretBytes and masked in `data` before JSONSerialization sees it, so no
  // String ever holds one. The caller zeroes `data` afterwards.
  static func paymentCards(_ data: inout Data) throws -> [ImportedCard] {
    var numbers: [SecretBytes] = []
    data.withUnsafeMutableBytes { (buf: UnsafeMutableRawBufferPointer) in
      let key = Array("\"card_number\"".utf8)
      var i = 0
      func isSpace(_ b: UInt8) -> Bool { b == 0x20 || b == 0x09 || b == 0x0A || b == 0x0D }
      while i + key.count <= buf.count {
        guard (0..<key.count).allSatisfy({ buf[i + $0] == key[$0] }) else {
          i += 1
          continue
        }
        var j = i + key.count
        while j < buf.count, isSpace(buf[j]) { j += 1 }
        guard j < buf.count, buf[j] == UInt8(ascii: ":") else { i = j; continue }
        j += 1
        while j < buf.count, isSpace(buf[j]) { j += 1 }
        guard j < buf.count, buf[j] == UInt8(ascii: "\"") else {
          numbers.append(SecretBytes(count: 0))
          i = j
          continue
        }
        let start = j + 1
        var end = start
        while end < buf.count, buf[end] != UInt8(ascii: "\""), buf[end] != UInt8(ascii: "\\") { end += 1 }
        if end < buf.count, buf[end] == UInt8(ascii: "\"") {
          numbers.append(SecretBytes(copying: UnsafeRawBufferPointer(rebasing: buf[start..<end])))
          for k in start..<end { buf[k] = UInt8(ascii: "X") }
        } else {
          numbers.append(SecretBytes(count: 0))
        }
        i = end
      }
    }
    guard let top = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          let rows = top["payment_cards"] as? [[String: Any]] else { return [] }
    let withNumbers = rows.filter { $0["card_number"] != nil }
    guard withNumbers.count == numbers.count else { throw ImportError.unreadable("PaymentCards.json is malformed") }
    var out: [ImportedCard] = []
    for (row, number) in zip(withNumbers, numbers) {
      guard AutofillWire.cardDigitCount(number) != nil else { continue }
      func int(_ key: String) -> Int? {
        (row[key] as? NSNumber)?.intValue ?? (row[key] as? String).flatMap { Int($0) }
      }
      out.append(ImportedCard(
        name: ChromiumAutofill.nonEmpty(row["cardholder_name"] as? String),
        number: number,
        expMonth: int("card_expiration_month").flatMap { (1...12).contains($0) ? $0 : nil },
        expYear: int("card_expiration_year").flatMap { $0 > 0 ? ($0 < 100 ? 2000 + $0 : $0) : nil },
        nickname: ChromiumAutofill.nonEmpty(row["card_name"] as? String)
      ))
    }
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
