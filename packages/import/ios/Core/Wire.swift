import Foundation

// JSON payloads for the engine (nn_cookies_import, autofill import), written straight into SecretBytes so no
// String or Data ever holds a cookie value or card number. Each payload ends with a NUL byte for the C side.

public enum CookieWire {
  /// Splits `cookies` into NUL-terminated `{"cookies":[…]}` payloads of at most `size` cookies each.
  /// A cookie whose value isn't valid UTF-8 can't travel in JSON: it's left out and counted in `dropped`.
  public static func batches(_ cookies: [Cookie], size: Int = 500) -> (batches: [SecretBytes], dropped: Int) {
    let size = max(1, size)
    var out: [SecretBytes] = []
    var dropped = 0
    var writer: SecretWriter?
    var inBatch = 0

    func close() {
      guard let w = writer else { return }
      w.append("]}")
      w.append(0)
      out.append(w.finish())
      writer = nil
      inBatch = 0
    }

    for cookie in cookies {
      guard cookie.value.isValidUTF8 else {
        dropped += 1
        continue
      }
      if writer == nil {
        writer = SecretWriter(capacity: 64 * 1024)
        writer!.append("{\"cookies\":[")
      }
      let w = writer!
      if inBatch > 0 { w.append(UInt8(ascii: ",")) }
      write(cookie, to: w)
      inBatch += 1
      if inBatch == size { close() }
    }
    close()
    return (out, dropped)
  }

  static func write(_ c: Cookie, to w: SecretWriter) {
    w.append("{\"name\":")
    JSON.string(c.name, to: w)
    w.append(",\"value\":")
    c.value.withUnsafeBytes { JSON.string($0, to: w) }
    w.append(",\"domain\":")
    JSON.string(c.domain, to: w)
    w.append(",\"path\":")
    JSON.string(c.path, to: w)
    if let v = c.created { JSON.number("created", v, to: w) }
    if let v = c.expires { JSON.number("expires", v, to: w) }
    if let v = c.lastAccess { JSON.number("lastAccess", v, to: w) }
    w.append(",\"secure\":\(c.secure),\"httpOnly\":\(c.httpOnly),\"sameSite\":")
    JSON.string(c.sameSite, to: w)
    w.append(",\"priority\":")
    JSON.string(c.priority, to: w)
    if let p = c.partition {
      w.append(",\"partitionKey\":{\"topLevelSite\":")
      JSON.string(p.topLevelSite, to: w)
      w.append(",\"crossSite\":\(p.crossSite)}")
    }
    w.append(",\"sourceScheme\":")
    JSON.string(c.sourceScheme, to: w)
    w.append(",\"sourcePort\":\(c.sourcePort)}")
  }
}

public enum AutofillWire {
  /// One NUL-terminated payload for nn_autofill_import:
  /// `{"addresses":[{name?,organization?,street?,city?,state?,postalCode?,country?,phone?,email?}],
  ///   "cards":[{name?,number,expMonth?,expYear?,nickname?}]}`.
  /// Unset fields are left out. A card is left out unless its number is 12–19 digits (spaces and dashes are
  /// dropped from the number).
  public static func batch(addresses: [ImportedAddress], cards: [ImportedCard]) -> SecretBytes {
    let w = SecretWriter(capacity: 1024)
    w.append("{\"addresses\":[")
    var firstAddress = true
    for a in addresses where !a.isEmpty {
      if !firstAddress { w.append(UInt8(ascii: ",")) }
      firstAddress = false
      w.append(UInt8(ascii: "{"))
      var first = true
      for (key, value) in [("name", a.name), ("organization", a.organization), ("street", a.street), ("city", a.city),
                           ("state", a.state), ("postalCode", a.postalCode), ("country", a.country), ("phone", a.phone),
                           ("email", a.email)] {
        guard let value else { continue }
        if !first { w.append(UInt8(ascii: ",")) }
        first = false
        JSON.string(key, to: w)
        w.append(UInt8(ascii: ":"))
        JSON.string(value, to: w)
      }
      w.append(UInt8(ascii: "}"))
    }
    w.append("],\"cards\":[")
    var firstCard = true
    for c in cards where cardDigitCount(c.number) != nil {
      if !firstCard { w.append(UInt8(ascii: ",")) }
      firstCard = false
      w.append(UInt8(ascii: "{"))
      if let name = c.name {
        w.append("\"name\":")
        JSON.string(name, to: w)
        w.append(UInt8(ascii: ","))
      }
      w.append("\"number\":\"")
      c.number.withUnsafeBytes { bytes in
        for b in bytes where b >= 0x30 && b <= 0x39 { w.append(b) }
      }
      w.append(UInt8(ascii: "\""))
      if let m = c.expMonth { w.append(",\"expMonth\":\(m)") }
      if let y = c.expYear { w.append(",\"expYear\":\(y)") }
      if let nickname = c.nickname {
        w.append(",\"nickname\":")
        JSON.string(nickname, to: w)
      }
      w.append(UInt8(ascii: "}"))
    }
    w.append("]}")
    w.append(0)
    return w.finish()
  }

  /// Number of digits when the number is 12–19 digits (ignoring spaces and dashes), else nil.
  static func cardDigitCount(_ number: SecretBytes) -> Int? {
    number.withUnsafeBytes { bytes in
      var digits = 0
      for b in bytes {
        switch b {
        case 0x30...0x39: digits += 1
        case 0x20, 0x2D: continue
        default: return nil
        }
      }
      return (12...19).contains(digits) ? digits : nil
    }
  }
}

enum JSON {
  static let hex: [UInt8] = Array("0123456789abcdef".utf8)

  static func string(_ s: String, to w: SecretWriter) {
    var s = s
    s.withUTF8 { string(UnsafeRawBufferPointer($0), to: w) }
  }

  /// Writes a quoted, escaped JSON string. The bytes must be valid UTF-8 (checked by the caller for secrets).
  static func string(_ bytes: UnsafeRawBufferPointer, to w: SecretWriter) {
    w.append(UInt8(ascii: "\""))
    var runStart = 0
    for i in 0..<bytes.count {
      let b = bytes[i]
      guard b == 0x22 || b == 0x5C || b < 0x20 else { continue }
      w.append(UnsafeRawBufferPointer(rebasing: bytes[runStart..<i]))
      switch b {
      case 0x22: w.append("\\\"")
      case 0x5C: w.append("\\\\")
      default:
        w.append("\\u00")
        w.append(hex[Int(b >> 4)])
        w.append(hex[Int(b & 0xF)])
      }
      runStart = i + 1
    }
    w.append(UnsafeRawBufferPointer(rebasing: bytes[runStart..<bytes.count]))
    w.append(UInt8(ascii: "\""))
  }

  static func number(_ key: String, _ v: Double, to w: SecretWriter) {
    guard v.isFinite else { return }
    w.append(",\"\(key)\":")
    if v == v.rounded(), abs(v) < 9e15 {
      w.append(String(Int64(v)))
    } else {
      w.append(String(v))
    }
  }
}
