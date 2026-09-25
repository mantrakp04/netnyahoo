import Foundation

/// Password exports as CSV, recognised by header:
///
/// - Chrome/Edge/Brave/Arc: `name,url,username,password,note`
/// - Safari: `Title,URL,Username,Password,Notes,OTPAuth`
/// - Firefox: `"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"`
/// - 1Password / Bitwarden style variants (`login_uri`, `login_username`, `login_password`, `website`, …)
public enum PasswordsCSV {
  static let urlKeys = ["url", "login_uri", "website", "web site", "origin", "hostname", "login url"]
  static let userKeys = ["username", "login_username", "login", "user", "email", "user name"]
  static let passKeys = ["password", "login_password", "pass"]
  static let titleKeys = ["name", "title"]
  static let noteKeys = ["note", "notes", "extra"]

  public static func parse(_ text: String) throws -> [Credential] {
    let rows = CSV.parse(text)
    guard let header = rows.first?.map({ $0.trimmingCharacters(in: .whitespaces).lowercased() }) else {
      throw ImportError.unreadable("The file is empty")
    }
    func column(_ keys: [String]) -> Int? { keys.lazy.compactMap { header.firstIndex(of: $0) }.first }
    guard let url = column(urlKeys), let pass = column(passKeys) else {
      throw ImportError.unsupported("This CSV doesn't have url and password columns")
    }
    let user = column(userKeys)
    let title = column(titleKeys)
    let note = column(noteKeys)
    let otp = header.firstIndex(of: "otpauth")
    let realm = header.firstIndex(of: "httprealm")
    let created = header.firstIndex(of: "timecreated")
    let lastUsed = header.firstIndex(of: "timelastused")

    func field(_ row: [String], _ i: Int?) -> String? {
      guard let i, i < row.count else { return nil }
      let v = row[i]
      return v.isEmpty ? nil : v
    }

    var out: [Credential] = []
    for row in rows.dropFirst() {
      guard let site = field(row, url), let password = field(row, pass) else { continue }
      out.append(Credential(
        url: site,
        username: field(row, user) ?? "",
        password: password,
        realm: field(row, realm),
        title: field(row, title),
        note: field(row, note),
        otpAuth: field(row, otp),
        created: field(row, created).flatMap(Double.init),
        lastUsed: field(row, lastUsed).flatMap(Double.init)
      ))
    }
    return out
  }

  public static func load(_ url: URL) throws -> [Credential] {
    let data = try Data(contentsOf: url)
    guard let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) else {
      throw ImportError.unreadable("Couldn't read \(url.lastPathComponent)")
    }
    return try parse(text)
  }
}

/// RFC 4180 CSV: quoted fields with doubled quotes, embedded commas and newlines, CRLF or LF,
/// optional UTF-8 BOM.
enum CSV {
  static func parse(_ text: String) -> [[String]] {
    var rows: [[String]] = []
    var row: [String] = []
    var field = ""
    var quoted = false
    var iterator = text.unicodeScalars.makeIterator()
    var pending: Unicode.Scalar? = iterator.next()
    if pending == "\u{FEFF}" { pending = iterator.next() }

    func endRow() {
      row.append(field)
      field = ""
      if !(row.count == 1 && row[0].isEmpty) { rows.append(row) }
      row = []
    }

    while let c = pending {
      pending = iterator.next()
      if quoted {
        if c == "\"" {
          if pending == "\"" {
            field.unicodeScalars.append("\"")
            pending = iterator.next()
          } else {
            quoted = false
          }
        } else {
          field.unicodeScalars.append(c)
        }
        continue
      }
      switch c {
      case "\"" where field.isEmpty: quoted = true
      case ",": row.append(field); field = ""
      case "\r":
        if pending == "\n" { pending = iterator.next() }
        endRow()
      case "\n": endRow()
      default: field.unicodeScalars.append(c)
      }
    }
    if !field.isEmpty || !row.isEmpty { endRow() }
    return rows
  }
}
