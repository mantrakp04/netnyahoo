import Foundation
import XCTest
@testable import NetnyahooImportCore

// Cookie values are secrets: they're read into SecretBytes, never into Strings, and only leave as wire JSON.
final class CookieTests: XCTestCase {
  let chrome = Fixtures.support("Google/Chrome/Default")
  let firefox = Fixtures.support("Firefox/Profiles/abcd1234.default-release")
  let future = 4_102_444_800_000.0

  func secret(_ s: String) -> SecretBytes { SecretBytes(Array(s.utf8)) }

  func testSecretBytesWipeAndEquality() {
    let a = secret("hunter2")
    XCTAssertEqual(a, secret("hunter2"))
    XCTAssertNotEqual(a, secret("hunter3"))
    XCTAssertEqual("\(a)", "SecretBytes(7 bytes)")
    a.wipe()
    a.withUnsafeBytes { XCTAssertTrue($0.allSatisfy { $0 == 0 }) }
    XCTAssertEqual(SecretBytes(count: 0), SecretBytes([UInt8]()))
  }

  func testChromiumCookiesMapEveryColumn() throws {
    let outcome = try ChromiumSecrets.cookies(profile: chrome, key: Fixtures.chromiumKey)
    // wrong key, a v24 value without the host hash, and a row with both value and encrypted_value
    XCTAssertEqual(outcome.undecryptable, 3)
    let byName = Dictionary(uniqueKeysWithValues: outcome.items.map { ($0.name, $0) })
    XCTAssertEqual(Set(byName.keys), ["sid", "pref", "tmp", "chips", "esc", "bin"])  // expired one skipped

    let sid = try XCTUnwrap(byName["sid"])
    XCTAssertEqual(sid, Cookie(domain: ".example.com", name: "sid", value: secret("s3ss10n"), path: "/",
                               created: Double(1788220800 - 7200) * 1000, expires: future,
                               lastAccess: Double(1788220800 - 60) * 1000, secure: true, httpOnly: true,
                               sameSite: "lax", priority: "high", partition: nil, sourceScheme: "secure", sourcePort: 443))

    let pref = try XCTUnwrap(byName["pref"])  // plaintext `value` column
    XCTAssertEqual(pref.value, secret("dark"))
    XCTAssertEqual([pref.sameSite, pref.priority, pref.sourceScheme], ["unspecified", "low", "nonSecure"])
    XCTAssertEqual(pref.sourcePort, 80)
    XCTAssertFalse(pref.secure)

    let tmp = try XCTUnwrap(byName["tmp"])  // session cookie kept
    XCTAssertNil(tmp.expires)
    XCTAssertEqual(tmp.value, secret("until-quit"))
    XCTAssertEqual(tmp.path, "/app")
    XCTAssertEqual([tmp.sameSite, tmp.priority, tmp.sourceScheme], ["none", "medium", "unset"])
    XCTAssertEqual(tmp.sourcePort, -1)

    let chips = try XCTUnwrap(byName["chips"])
    XCTAssertEqual(chips.partition, CookiePartition(topLevelSite: "https://top.example", crossSite: true))
    XCTAssertEqual(chips.value, secret("partitioned"))
    XCTAssertEqual(chips.sameSite, "strict")
    XCTAssertEqual(chips.sourcePort, 8443)

    XCTAssertEqual(byName["bin"]?.value, SecretBytes([0xFF, 0xFE]))
  }

  func testChromiumOldSchemaHasNoHostHash() throws {
    let outcome = try ChromiumSecrets.cookies(database: Fixtures.url("misc/Cookies-v23"), key: Fixtures.chromiumKey)
    XCTAssertEqual(outcome.undecryptable, 0)
    XCTAssertEqual(outcome.items.count, 2)
    let legacy = outcome.items[0]
    XCTAssertEqual(legacy.value, secret("no-host-prefix"))
    XCTAssertTrue(legacy.secure)
    XCTAssertEqual(legacy.expires, future)
    XCTAssertEqual([legacy.sameSite, legacy.priority, legacy.sourceScheme], ["strict", "high", "unset"])
    XCTAssertNil(legacy.partition)
    let session = outcome.items[1]
    XCTAssertNil(session.expires)
    XCTAssertTrue(session.httpOnly)
    XCTAssertEqual(session.value, secret("old-session"))
  }

  func testChromiumWrongKeyDecryptsNothing() throws {
    let wrong = ChromiumCrypto.deriveKey(secret: Data("nope".utf8))
    let outcome = try ChromiumSecrets.cookies(profile: chrome, key: wrong)
    XCTAssertEqual(outcome.items.map(\.name), ["pref"])
  }

  func testFirefoxCookies() throws {
    let outcome = try Firefox.cookies(profile: firefox)
    XCTAssertEqual(outcome.skipped, 3)  // container, private window, unconvertible partition key
    let byName = Dictionary(uniqueKeysWithValues: outcome.items.map { ($0.name, $0) })
    XCTAssertEqual(Set(byName.keys), ["ff", "ms", "part", "port", "none", "lbd"])

    XCTAssertEqual(byName["ff"], Cookie(domain: ".mozilla.example", name: "ff", value: secret("1"), path: "/",
                                        created: 1788220800 * 1000, expires: future,
                                        lastAccess: Double(1788220800 - 60) * 1000, secure: true, httpOnly: true,
                                        sameSite: "lax", priority: "medium", partition: nil, sourceScheme: "secure",
                                        sourcePort: -1))
    let ms = try XCTUnwrap(byName["ms"])
    XCTAssertEqual(ms.expires, future)
    XCTAssertEqual(ms.sameSite, "strict")
    XCTAssertEqual(ms.sourceScheme, "nonSecure")
    XCTAssertNil(ms.created)

    XCTAssertEqual(byName["part"]?.partition, CookiePartition(topLevelSite: "https://top.example", crossSite: false))
    XCTAssertEqual(byName["part"]?.sameSite, "unspecified")  // SAMESITE_UNSET
    XCTAssertEqual(byName["port"]?.partition, CookiePartition(topLevelSite: "https://ported.example", crossSite: false))
    XCTAssertEqual(byName["port"]?.sameSite, "none")
    XCTAssertEqual(byName["port"]?.sourceScheme, "secure")
    XCTAssertEqual(byName["none"]?.sameSite, "unspecified")  // insecure NONE
    XCTAssertEqual(byName["lbd"]?.sameSite, "unspecified")   // Firefox applied its own default
  }

  func testSafariBinaryCookies() throws {
    let cookies = try SafariCookies.load(home: Fixtures.home)
    XCTAssertEqual(cookies.map(\.name), ["dc", "hc", "both"])  // expired one skipped
    XCTAssertEqual(cookies[0], Cookie(domain: ".apple.example", name: "dc", value: secret("domain-cookie"), path: "/",
                                      created: 1788220800 * 1000, expires: future, secure: true, httpOnly: false))
    XCTAssertEqual(cookies[1].domain, "host.example")
    XCTAssertEqual(cookies[1].path, "/path")
    XCTAssertEqual(cookies[1].sourcePort, 8443)
    XCTAssertTrue(cookies[1].httpOnly)
    XCTAssertFalse(cookies[1].secure)
    XCTAssertEqual(cookies[1].created, Double(1788220800 - 10) * 1000)
    XCTAssertTrue(cookies[2].secure && cookies[2].httpOnly)
    XCTAssertEqual(cookies[2].value, secret("v\"al\\ue"))

    let direct = try SafariDirect.load(home: Fixtures.home)
    XCTAssertEqual(direct.cookies.count, 3)
    XCTAssertEqual(direct.cookieCount, 3)
  }

  func testMalformedBinaryCookiesThrow() throws {
    for name in ["truncated", "bad-magic", "page-count", "bad-offset", "no-nul", "small-cookie"] {
      let url = Fixtures.url("misc/binarycookies/\(name).binarycookies")
      XCTAssertThrowsError(try SafariCookies.parse(SafariCookies.read(url)), name) { error in
        XCTAssertEqual((error as? ImportError)?.code, "unreadable", name)
      }
    }
    // Every prefix of a good file must fail cleanly, never crash.
    let good = try SafariCookies.read(Fixtures.url("home/Library/Containers/com.apple.Safari/Data/Library/Cookies/Cookies.binarycookies"))
    let pagesEnd = good.count - 12
    for n in 0..<pagesEnd {
      let prefix = good.withUnsafeBytes { SecretBytes(copying: UnsafeRawBufferPointer(rebasing: $0[0..<n])) }
      XCTAssertThrowsError(try SafariCookies.parse(prefix), "prefix \(n)")
    }
  }

  func testCookieWireJSON() throws {
    let cookies = try ChromiumSecrets.cookies(profile: chrome, key: Fixtures.chromiumKey).items
    let wire = CookieWire.batches(cookies, size: 4)
    XCTAssertEqual(wire.dropped, 1)  // the non-UTF-8 value
    XCTAssertEqual(wire.batches.count, 2)
    var parsed: [[String: Any]] = []
    for batch in wire.batches {
      try batch.withUnsafeBytes { bytes in
        XCTAssertEqual(bytes.last, 0)
        XCTAssertFalse(bytes.dropLast().contains(0))
        let json = Data(bytes.dropLast())
        let top = try XCTUnwrap(JSONSerialization.jsonObject(with: json) as? [String: Any])
        parsed += try XCTUnwrap(top["cookies"] as? [[String: Any]])
        let raw = String(decoding: json, as: UTF8.self)
        if raw.contains("\"esc\"") {
          XCTAssertTrue(raw.contains(#"q\"b\\s\u0001\u000a\u001f é🍪"#), raw)
        }
      }
    }
    XCTAssertEqual(wire.batches.map { b in b.withUnsafeBytes { bytes in
      ((try? JSONSerialization.jsonObject(with: Data(bytes.dropLast()))) as? [String: Any])?["cookies"] as? [Any]
    }?.count ?? -1 }, [4, 1])
    let byName = Dictionary(uniqueKeysWithValues: parsed.map { ($0["name"] as! String, $0) })
    XCTAssertEqual(Set(byName.keys), ["sid", "pref", "tmp", "chips", "esc"])

    let sid = try XCTUnwrap(byName["sid"])
    XCTAssertEqual(Set(sid.keys), ["name", "value", "domain", "path", "created", "expires", "lastAccess", "secure",
                                   "httpOnly", "sameSite", "priority", "sourceScheme", "sourcePort"])
    XCTAssertEqual(sid["value"] as? String, "s3ss10n")
    XCTAssertEqual(sid["domain"] as? String, ".example.com")
    XCTAssertEqual(sid["path"] as? String, "/")
    XCTAssertEqual((sid["created"] as? NSNumber)?.doubleValue, Double(1788220800 - 7200) * 1000)
    XCTAssertEqual((sid["expires"] as? NSNumber)?.doubleValue, future)
    XCTAssertEqual((sid["lastAccess"] as? NSNumber)?.doubleValue, Double(1788220800 - 60) * 1000)
    XCTAssertEqual(sid["secure"] as? Bool, true)
    XCTAssertEqual(sid["httpOnly"] as? Bool, true)
    XCTAssertEqual(sid["sameSite"] as? String, "lax")
    XCTAssertEqual(sid["priority"] as? String, "high")
    XCTAssertEqual(sid["sourceScheme"] as? String, "secure")
    XCTAssertEqual(sid["sourcePort"] as? Int, 443)

    XCTAssertNil(byName["tmp"]?["expires"])
    XCTAssertEqual(byName["tmp"]?["sourcePort"] as? Int, -1)
    let key = try XCTUnwrap(byName["chips"]?["partitionKey"] as? [String: Any])
    XCTAssertEqual(key["topLevelSite"] as? String, "https://top.example")
    XCTAssertEqual(key["crossSite"] as? Bool, true)
    XCTAssertEqual(byName["esc"]?["value"] as? String, "q\"b\\s\u{01}\n\u{1f} é🍪")

    XCTAssertEqual(CookieWire.batches([]).batches.count, 0)
  }

  func testResultJSONCarriesCountsNotSecrets() throws {
    var result = ImportResult(browserId: "chrome", profileId: "Default")
    result.cookies = try ChromiumSecrets.cookies(profile: chrome, key: Fixtures.chromiumKey).items
    result.cards = [ImportedCard(number: secret("4111111111111111"))]
    result.vaultToken = "token-1"
    let json = String(decoding: try JSONEncoder().encode(result), as: UTF8.self)
    XCTAssertFalse(json.contains("s3ss10n"))
    XCTAssertFalse(json.contains("4111"))
    let top = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
    XCTAssertNil(top["cookies"])
    XCTAssertNil(top["cards"])
    XCTAssertEqual(top["cookieCount"] as? Int, 6)
    XCTAssertEqual(top["cardCount"] as? Int, 1)
    XCTAssertEqual(top["addressCount"] as? Int, 0)
    XCTAssertEqual(top["vaultToken"] as? String, "token-1")
    let decoded = try JSONDecoder().decode(ImportResult.self, from: Data(json.utf8))
    XCTAssertEqual(decoded.cookieCount, 6)
    XCTAssertTrue(decoded.cookies.isEmpty)
  }
}
