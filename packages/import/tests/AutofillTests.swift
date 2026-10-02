import Foundation
import XCTest
@testable import NetnyahooImportCore

// Card numbers are secrets: they're decrypted into SecretBytes and need the browser key; addresses don't.
final class AutofillTests: XCTestCase {
  let chrome = Fixtures.support("Google/Chrome/Default")

  func secret(_ s: String) -> SecretBytes { SecretBytes(Array(s.utf8)) }

  func testWebDataAddressesAndCards() throws {
    let outcome = try ChromiumAutofill.load(profile: chrome, key: Fixtures.chromiumKey)
    XCTAssertEqual(outcome.addresses, [
      ImportedAddress(name: "Alex Example", organization: "Netnyahoo Ltd", street: "1 Example Way\nSuite 2",
                      city: "Cupertino", state: "CA", postalCode: "95014", country: "US", phone: "+14155550100",
                      email: "alex@example.com"),
      ImportedAddress(name: "Sam Smith", street: "10 High Street\nFlat 1", city: "London", postalCode: "SW1A 1AA",
                      country: "GB"),
      ImportedAddress(name: "Lee Legacy", street: "5 Old Road", city: "Berlin", postalCode: "10115", country: "DE",
                      phone: "+49301234567", email: "lee@example.de"),
    ])
    XCTAssertEqual(outcome.cards, [
      ImportedCard(name: "Alex Example", number: secret("4111111111111111"), expMonth: 4, expYear: 2030, nickname: "Travel"),
      ImportedCard(name: nil, number: secret("5555555555554444"), expMonth: 12, expYear: 2031, nickname: nil),
    ])  // the server card in masked_credit_cards is never read
    XCTAssertEqual(outcome.undecryptable, 1)
    XCTAssertEqual(outcome.lockedCards, 0)

    let locked = try ChromiumAutofill.load(profile: chrome, key: nil)
    XCTAssertEqual(locked.addresses.count, 3)
    XCTAssertEqual(locked.cards, [])
    XCTAssertEqual(locked.lockedCards, 3)
  }

  func testImporterImportsAddressesWithoutKeyAndCardsWithIt() throws {
    let importer = Importer(discovery: Fixtures.discovery())
    let locked = try importer.importData(browserId: "chrome", profileId: "Default", kinds: [.autofill])
    XCTAssertEqual(locked.failed, [])
    XCTAssertEqual(locked.addressCount, 3)
    XCTAssertEqual(locked.cardCount, 0)
    XCTAssertEqual(locked.warnings.map(\.code), ["locked"])

    importer.setKey(Fixtures.chromiumKey, for: "chrome")
    let open = try importer.importData(browserId: "chrome", profileId: "Default", kinds: [.autofill, .cookies])
    XCTAssertEqual(open.failed, [])
    XCTAssertEqual(open.cardCount, 2)
    XCTAssertEqual(open.cookieCount, 6)
    XCTAssertEqual(Set(open.warnings.map(\.code)), ["undecryptable"])
  }

  func testUnlockAfterForgetDropsKey() throws {
    let importer = Importer(discovery: Fixtures.discovery())
    try importer.unlock(browserId: "chrome") { _, _ in
      importer.forgetKeys()  // the user cancels while the Keychain prompt is up
      return Fixtures.chromiumSecret
    }
    XCTAssertFalse(importer.isUnlocked("chrome"))
    try importer.unlock(browserId: "chrome") { _, _ in Fixtures.chromiumSecret }
    XCTAssertTrue(importer.isUnlocked("chrome"))
  }

  func testAutofillWire() throws {
    let addresses = [
      ImportedAddress(name: "Q \"Quote\" \\ Person", street: "1 Way\nUnit\t2", country: "US"),
      ImportedAddress(),
    ]
    let cards = [
      ImportedCard(name: "Alex", number: secret("4111 1111-1111 1111"), expMonth: 4, expYear: 2030, nickname: "Trip"),
      ImportedCard(number: secret("5555555555554444")),
      ImportedCard(number: secret("12345")),
      ImportedCard(number: secret("41111111111111x1")),
    ]
    let wire = AutofillWire.batch(addresses: addresses, cards: cards)
    let top = try wire.withUnsafeBytes { bytes -> [String: Any] in
      XCTAssertEqual(bytes.last, 0)
      XCTAssertFalse(bytes.dropLast().contains(0))
      return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(bytes.dropLast())) as? [String: Any])
    }
    let a = try XCTUnwrap(top["addresses"] as? [[String: Any]])
    XCTAssertEqual(a.count, 1)  // the empty address is left out
    XCTAssertEqual(Set(a[0].keys), ["name", "street", "country"])
    XCTAssertEqual(a[0]["name"] as? String, "Q \"Quote\" \\ Person")
    XCTAssertEqual(a[0]["street"] as? String, "1 Way\nUnit\t2")
    let c = try XCTUnwrap(top["cards"] as? [[String: Any]])
    XCTAssertEqual(c.count, 2)
    XCTAssertEqual(c[0]["number"] as? String, "4111111111111111")
    XCTAssertEqual(c[0]["name"] as? String, "Alex")
    XCTAssertEqual(c[0]["expMonth"] as? Int, 4)
    XCTAssertEqual(c[0]["expYear"] as? Int, 2030)
    XCTAssertEqual(c[0]["nickname"] as? String, "Trip")
    XCTAssertEqual(Set(c[1].keys), ["number"])

    let empty = AutofillWire.batch(addresses: [], cards: [])
    empty.withUnsafeBytes { XCTAssertEqual(Array($0), Array("{\"addresses\":[],\"cards\":[]}\0".utf8)) }
  }

  func testSafariExportCards() throws {
    for url in [Fixtures.url("safari/Safari Export"), Fixtures.url("safari/Safari Export.zip")] {
      let export = try SafariExport.load(url)
      XCTAssertEqual(export.cards, [
        ImportedCard(name: "Alex Example", number: secret("4111 1111 1111 1111"), expMonth: 4, expYear: 2030, nickname: "Travel"),
        ImportedCard(name: nil, number: secret("0000000000000000"), expMonth: nil, expYear: nil, nickname: "Test card"),
      ], url.lastPathComponent)
      XCTAssertEqual(export.cardCount, 2)
      XCTAssertEqual(export.profiles.first?.history.isEmpty, false)  // the rest still parses
      let json = String(decoding: try JSONEncoder().encode(export), as: UTF8.self)
      XCTAssertFalse(json.contains("4111"))
      XCTAssertTrue(json.contains("\"cardCount\":2"))
    }
  }

  func testDiscoveryListsAutofillAndCookies() throws {
    let chrome = try XCTUnwrap(Fixtures.discovery().source(BrowserDefinition.find("chrome")!))
    let available = Dictionary(uniqueKeysWithValues: chrome.profiles.map { ($0.id, $0.available) })
    XCTAssertTrue(available["Default"]!.contains(.autofill))
    XCTAssertTrue(available["Default"]!.contains(.cookies))
    XCTAssertFalse(available["Profile 1"]!.contains(.autofill))
    let firefox = try XCTUnwrap(Fixtures.discovery().source(BrowserDefinition.find("firefox")!))
    XCTAssertTrue(firefox.profiles.first { $0.id == "Profiles/abcd1234.default-release" }!.available.contains(.cookies))
  }
}
