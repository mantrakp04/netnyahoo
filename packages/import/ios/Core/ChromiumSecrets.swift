import Foundation

/// Saved logins (`Login Data`, `Login Data For Account`) and cookies (`Cookies`) of a
/// Chromium profile, decrypted with the key from `ChromiumCrypto.deriveKey`.
///
/// Columns are read by name (`SELECT *`): both tables have grown columns across versions
/// and a fixed column list would break on the next one.
public enum ChromiumSecrets {
  public struct Outcome<T> {
    public var items: [T]
    /// Rows that didn't decrypt — almost always a key from the wrong Keychain item.
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
      // "Never save" entries carry no credential.
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
    // Chrome ≥ 96 moved `Cookies` under `Network/`; older profiles and some forks keep it at the root.
    let candidates = [profile.appendingPathComponent("Network/Cookies"), profile.appendingPathComponent("Cookies")]
    guard let file = candidates.first(where: { FileManager.default.fileExists(atPath: $0.path) }) else {
      throw ImportError.notFound("No cookies in this profile")
    }
    return try cookies(database: file, key: key, cancellation: cancellation)
  }

  public static func cookies(database: URL, key: Data, cancellation: Cancellation = .init()) throws -> Outcome<Cookie> {
    let db = try SQLiteSnapshot(copying: database)
    guard db.tableExists("cookies") else { throw ImportError.unreadable("Cookies has no cookies table") }
    let now = Date().timeIntervalSince1970 * 1000
    var items: [Cookie] = []
    var bad = 0
    try db.query("SELECT * FROM cookies") { row in
      if items.count % 256 == 0 { try cancellation.check() }
      guard let host = row.text("host_key"), let name = row.text("name") else { return true }
      var value = row.text("value") ?? ""
      if value.isEmpty, let blob = row.blob("encrypted_value"), !blob.isEmpty {
        guard let plain = ChromiumCrypto.decrypt(blob, key: key, hostKey: host) else {
          bad += 1
          return true
        }
        value = plain
      }
      let persistent = (row.int("is_persistent") ?? row.int("has_expires") ?? 0) != 0
      let expires = persistent ? row.int("expires_utc").flatMap(Time.fromWebKit) : nil
      if let expires, expires < now { return true }
      items.append(Cookie(
        domain: host,
        name: name,
        value: value,
        path: row.text("path") ?? "/",
        expires: expires,
        secure: (row.int("is_secure") ?? 0) != 0,
        httpOnly: (row.int("is_httponly") ?? 0) != 0,
        sameSite: sameSite(row.int("samesite")),
        created: row.int("creation_utc").flatMap(Time.fromWebKit)
      ))
      return true
    }
    return Outcome(items: items, undecryptable: bad)
  }

  /// `net::CookieSameSite` as persisted: -1 unspecified, 0 none, 1 lax, 2 strict.
  static func sameSite(_ v: Int64?) -> String {
    switch v {
    case 0: "none"
    case 1: "lax"
    case 2: "strict"
    default: "unspecified"
    }
  }
}
