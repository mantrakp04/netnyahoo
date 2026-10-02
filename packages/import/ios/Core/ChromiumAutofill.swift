import Foundation

// Addresses and local cards from a Chromium profile's `Web Data`. Server (masked) cards live in other tables
// and are never read.
public enum ChromiumAutofill {
  public struct Outcome {
    public var addresses: [ImportedAddress]
    public var cards: [ImportedCard]
    /// Cards whose number didn't decrypt to 12–19 digits.
    public var undecryptable: Int
    /// Cards present but not read because no key was given.
    public var lockedCards: Int
  }

  // Chromium FieldType values.
  enum Field {
    static let nameFirst = 3, nameLast = 5, nameFull = 7, email = 9, phone = 14
    static let line1 = 30, line2 = 31, city = 33, state = 34, zip = 35, country = 36
    static let company = 60, street = 77
  }

  public static func load(profile: URL, key: Data?, cancellation: Cancellation = .init()) throws -> Outcome {
    let file = profile.appendingPathComponent("Web Data")
    guard FileManager.default.fileExists(atPath: file.path) else { throw ImportError.notFound("No autofill data in this profile") }
    return try load(database: file, key: key, cancellation: cancellation)
  }

  public static func load(database: URL, key: Data?, cancellation: Cancellation = .init()) throws -> Outcome {
    let db = try SQLiteSnapshot(copying: database)
    var addresses: [ImportedAddress] = []
    var guids = Set<String>()
    for (table, tokens) in [("addresses", "address_type_tokens"), ("local_addresses", "local_addresses_type_tokens"),
                            ("contact_info", "contact_info_type_tokens")]
    where db.tableExists(table) && db.tableExists(tokens) {
      try cancellation.check()
      for (guid, address) in try tokenAddresses(db, table: table, tokens: tokens) where guids.insert(guid).inserted {
        addresses.append(address)
      }
    }
    if db.tableExists("autofill_profiles") {
      try cancellation.check()
      for (guid, address) in try legacyAddresses(db) where guids.insert(guid).inserted { addresses.append(address) }
    }
    var unique: [ImportedAddress] = []
    for a in addresses where !a.isEmpty && !unique.contains(a) { unique.append(a) }

    var cards: [ImportedCard] = []
    var bad = 0
    var locked = 0
    if db.tableExists("credit_cards") {
      try db.query("SELECT * FROM credit_cards") { row in
        try cancellation.check()
        guard let blob = row.blob("card_number_encrypted"), !blob.isEmpty else { return true }
        guard let key else {
          locked += 1
          return true
        }
        guard let number = ChromiumCrypto.decryptSecret(blob, key: key), AutofillWire.cardDigitCount(number) != nil else {
          bad += 1
          return true
        }
        let month = row.int("expiration_month").map(Int.init).flatMap { (1...12).contains($0) ? $0 : nil }
        let year = row.int("expiration_year").map(Int.init).flatMap { $0 > 0 ? ($0 < 100 ? 2000 + $0 : $0) : nil }
        cards.append(ImportedCard(name: nonEmpty(row.text("name_on_card")), number: number, expMonth: month,
                                  expYear: year, nickname: nonEmpty(row.text("nickname"))))
        return true
      }
    }
    guard db.tableExists("credit_cards") || db.tableExists("addresses") || db.tableExists("local_addresses")
      || db.tableExists("contact_info") || db.tableExists("autofill_profiles") else {
      throw ImportError.unreadable("Web Data has no autofill tables")
    }
    return Outcome(addresses: unique, cards: cards, undecryptable: bad, lockedCards: locked)
  }

  static func nonEmpty(_ s: String?) -> String? {
    guard let t = s?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else { return nil }
    return t
  }

  static func join(_ parts: String?..., separator: String) -> String? {
    let kept = parts.compactMap(nonEmpty)
    return kept.isEmpty ? nil : kept.joined(separator: separator)
  }

  static func tokenAddresses(_ db: SQLiteSnapshot, table: String, tokens: String) throws -> [(String, ImportedAddress)] {
    var order: [String] = []
    try db.query("SELECT guid FROM \(table) ORDER BY rowid") { row in
      if let g = row.text(0) { order.append(g) }
      return true
    }
    var values: [String: [Int: String]] = [:]
    try db.query("SELECT guid, type, value FROM \(tokens)") { row in
      guard let g = row.text(0), let v = nonEmpty(row.text(2)) else { return true }
      values[g, default: [:]][Int(row.int(1))] = v
      return true
    }
    return order.compactMap { guid in
      guard let f = values[guid] else { return nil }
      return (guid, ImportedAddress(
        name: f[Field.nameFull] ?? join(f[Field.nameFirst], f[Field.nameLast], separator: " "),
        organization: f[Field.company],
        street: f[Field.street] ?? join(f[Field.line1], f[Field.line2], separator: "\n"),
        city: f[Field.city],
        state: f[Field.state],
        postalCode: f[Field.zip],
        country: f[Field.country]?.uppercased(),
        phone: f[Field.phone],
        email: f[Field.email]
      ))
    }
  }

  static func legacyAddresses(_ db: SQLiteSnapshot) throws -> [(String, ImportedAddress)] {
    func firstValues(_ table: String, _ build: (SQLiteSnapshot.Row) -> String?) throws -> [String: String] {
      guard db.tableExists(table) else { return [:] }
      var out: [String: String] = [:]
      try db.query("SELECT * FROM \(table) ORDER BY rowid") { row in
        if let g = row.text("guid"), out[g] == nil, let v = build(row) { out[g] = v }
        return true
      }
      return out
    }
    let names = try firstValues("autofill_profile_names") { row in
      nonEmpty(row.text("full_name")) ?? join(row.text("first_name"), row.text("middle_name"), row.text("last_name"), separator: " ")
    }
    let emails = try firstValues("autofill_profile_emails") { nonEmpty($0.text("email")) }
    let phones = try firstValues("autofill_profile_phones") { nonEmpty($0.text("number")) }
    var out: [(String, ImportedAddress)] = []
    try db.query("SELECT * FROM autofill_profiles ORDER BY rowid") { row in
      guard let guid = row.text("guid") else { return true }
      out.append((guid, ImportedAddress(
        name: names[guid],
        organization: nonEmpty(row.text("company_name")),
        street: nonEmpty(row.text("street_address")) ?? join(row.text("address_line_1"), row.text("address_line_2"), separator: "\n"),
        city: nonEmpty(row.text("city")),
        state: nonEmpty(row.text("state")),
        postalCode: nonEmpty(row.text("zipcode")),
        country: nonEmpty(row.text("country_code"))?.uppercased(),
        phone: phones[guid],
        email: emails[guid]
      )))
      return true
    }
    return out
  }
}
