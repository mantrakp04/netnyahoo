import Foundation

public enum ChromiumSecrets {
  public struct Outcome<T> {
    public var items: [T]
    public var undecryptable: Int
  }

  public static func logins(profile: URL, key: Data, cancellation: Cancellation = .init()) throws -> Outcome<Credential> {
    let files = ["Login Data", "Login Data For Account"].map { profile.appendingPathComponent($0) }
      .filter { FileManager.default.fileExists(atPath: $0.path) }
    guard !files.isEmpty else { throw ImportError.notFound("No saved passwords in this profile") }
    var items: [Credential] = []
    var seen = Set<String>()
    var bad = 0
    for file in files {
      let r = try logins(database: file, key: key, cancellation: cancellation)
      bad += r.undecryptable
      for c in r.items where seen.insert("\(c.realm ?? c.url)\u{0}\(c.username)").inserted { items.append(c) }
    }
    return Outcome(items: items, undecryptable: bad)
  }

  public static func logins(database: URL, key: Data, cancellation: Cancellation = .init()) throws -> Outcome<Credential> {
    let db = try SQLiteSnapshot(copying: database)
    guard db.tableExists("logins") else { throw ImportError.unreadable("Login Data has no logins table") }
    var items: [Credential] = []
    var bad = 0
    try db.query("SELECT * FROM logins") { row in
      if items.count % 128 == 0 { try cancellation.check() }
      if row.int("blacklisted_by_user") ?? 0 != 0 { return true }
      guard let blob = row.blob("password_value"), !blob.isEmpty else { return true }
      guard let password = ChromiumCrypto.decrypt(blob, key: key) else {
        bad += 1
        return true
      }
      guard !password.isEmpty else { return true }
      let origin = row.text("origin_url") ?? ""
      let realm = row.text("signon_realm")
      items.append(Credential(
        url: origin.isEmpty ? (realm ?? "") : origin,
        username: row.text("username_value") ?? "",
        password: password,
        realm: realm,
        created: row.int("date_created").flatMap(Time.fromWebKit),
        lastUsed: row.int("date_last_used").flatMap(Time.fromWebKit),
        timesUsed: row.int("times_used").map(Int.init)
      ))
      return true
    }
    return Outcome(items: items, undecryptable: bad)
  }

  public static func cookies(profile: URL, key: Data, cancellation: Cancellation = .init()) throws -> Outcome<Cookie> {
    let candidates = [profile.appendingPathComponent("Network/Cookies"), profile.appendingPathComponent("Cookies")]
    guard let file = candidates.first(where: { FileManager.default.fileExists(atPath: $0.path) }) else {
      throw ImportError.notFound("No cookies in this profile")
    }
    return try cookies(database: file, key: key, cancellation: cancellation)
  }

  public static func cookies(database: URL, key: Data, cancellation: Cancellation = .init()) throws -> Outcome<Cookie> {
    let db = try SQLiteSnapshot(copying: database)
    guard db.tableExists("cookies") else { throw ImportError.unreadable("Cookies has no cookies table") }
    // Version 24+ prefixes every encrypted value with SHA-256(host_key); older databases never do.
    let version = db.tableExists("meta")
      ? (try? db.scalar("SELECT CAST(value AS INTEGER) FROM meta WHERE key='version'")).flatMap { $0 } ?? 0 : 0
    let hostHashed = version >= 24
    let now = Date().timeIntervalSince1970 * 1000
    var items: [Cookie] = []
    var bad = 0
    var seen = 0
    try db.query("SELECT * FROM cookies") { row in
      seen += 1
      if seen % 256 == 0 { try cancellation.check() }
      guard let host = row.text("host_key"), let name = row.text("name") else { return true }
      // Columns were renamed over the years (secure → is_secure, persistent → is_persistent → has_expires).
      func flag(_ names: String...) -> Bool? {
        for n in names { if let v = row.int(n) { return v != 0 } }
        return nil
      }
      let persistent = flag("has_expires", "is_persistent", "persistent") ?? true
      let expires = persistent ? row.int("expires_utc").flatMap(Time.fromWebKit) : nil
      if let expires, expires < now { return true }

      let value: SecretBytes
      let plain = row.index("value").flatMap(row.blobPointer) ?? UnsafeRawBufferPointer(start: nil, count: 0)
      let encrypted = row.blob("encrypted_value") ?? Data()
      if !plain.isEmpty && !encrypted.isEmpty {
        bad += 1  // Chromium rejects a row with both.
        return true
      } else if !plain.isEmpty {
        value = SecretBytes(copying: plain)
      } else if !encrypted.isEmpty {
        guard let decrypted = ChromiumCrypto.decryptSecret(encrypted, key: key, hostKey: hostHashed ? host : nil) else {
          bad += 1
          return true
        }
        value = decrypted
      } else {
        value = SecretBytes(count: 0)
      }

      let topFrame = row.text("top_frame_site_key") ?? ""
      let port = row.int("source_port").map(Int.init) ?? -1
      items.append(Cookie(
        domain: host,
        name: name,
        value: value,
        path: row.text("path").flatMap { $0.isEmpty ? nil : $0 } ?? "/",
        created: row.int("creation_utc").flatMap(Time.fromWebKit),
        expires: expires,
        lastAccess: row.int("last_access_utc").flatMap(Time.fromWebKit),
        secure: flag("is_secure", "secure") ?? false,
        httpOnly: flag("is_httponly", "httponly") ?? false,
        sameSite: sameSite(row.int("samesite") ?? row.int("firstpartyonly")),
        priority: priority(row.int("priority")),
        partition: topFrame.isEmpty ? nil
          : CookiePartition(topLevelSite: topFrame, crossSite: (row.int("has_cross_site_ancestor") ?? 0) != 0),
        sourceScheme: sourceScheme(row.int("source_scheme")),
        sourcePort: (0...65535).contains(port) ? port : -1
      ))
      return true
    }
    return Outcome(items: items, undecryptable: bad)
  }

  static func priority(_ v: Int64?) -> String {
    switch v {
    case 0: "low"
    case 2: "high"
    default: "medium"
    }
  }

  static func sourceScheme(_ v: Int64?) -> String {
    switch v {
    case 1: "nonSecure"
    case 2: "secure"
    default: "unset"
    }
  }

  static func sameSite(_ v: Int64?) -> String {
    switch v {
    case 0: "none"
    case 1: "lax"
    case 2: "strict"
    default: "unspecified"
    }
  }
}
