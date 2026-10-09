import XCTest
@testable import ArcadiaImportCore

// Cases from the Codex review of the cookie import (2026-10-02).
final class ReviewRegressionTests: XCTestCase {
  func testMalformedFirefoxOriginAttributesDoNotTrap() {
    XCTAssertTrue(Firefox.originAttributes("^=").isolated)
    XCTAssertTrue(Firefox.originAttributes("^=1&userContextId=0").isolated)
    XCTAssertFalse(Firefox.originAttributes("").isolated)
  }

  func testNonV10EncryptedValuesAreUndecryptable() {
    let key = Fixtures.chromiumKey
    XCTAssertNil(ChromiumCrypto.decryptSecret(Data("v11garbage-but-printable".utf8), key: key))
    XCTAssertNil(ChromiumCrypto.decryptSecret(Data("v10".utf8) + Data([1, 2, 3]), key: key))
    XCTAssertNil(ChromiumCrypto.decryptSecret(Data("plain".utf8), key: key, hostKey: "example.com"))
  }

  private func record() -> [UInt8] {
    func le32(_ v: Int) -> [UInt8] { (0..<4).map { UInt8((v >> (8 * $0)) & 0xFF) } }
    let strings: [[UInt8]] = ["a.example", "n", "/", "v"].map { Array($0.utf8) + [0] }
    var offsets: [Int] = []
    var at = 56
    for s in strings {
      offsets.append(at)
      at += s.count
    }
    var r = le32(at) + le32(0) + le32(1) + le32(0)
    for o in offsets { r += le32(o) }
    r += [UInt8](repeating: 0, count: 8)
    r += withUnsafeBytes(of: (4_102_444_800.0 - 978_307_200).bitPattern.littleEndian, Array.init)
    r += withUnsafeBytes(of: (1_700_000_000.0 - 978_307_200).bitPattern.littleEndian, Array.init)
    return r + strings.flatMap { $0 }
  }

  private func file(offsets: (Int) -> [Int], records: Int) -> SecretBytes {
    func le32(_ v: Int) -> [UInt8] { (0..<4).map { UInt8((v >> (8 * $0)) & 0xFF) } }
    let rec = record()
    let table = 8 + 4 * offsets(0).count + 4
    var page: [UInt8] = [0, 0, 1, 0] + le32(offsets(0).count)
    for o in offsets(table) { page += le32(o) }
    page += [0, 0, 0, 0]
    for _ in 0..<records { page += rec }
    let size = page.count
    let header: [UInt8] = Array("cook".utf8) + [0, 0, 0, 1] + [UInt8(size >> 24 & 0xFF), UInt8(size >> 16 & 0xFF), UInt8(size >> 8 & 0xFF), UInt8(size & 0xFF)]
    return SecretBytes(header + page + [UInt8](repeating: 0, count: 8))
  }

  func testSafariRecordsMayNotOverlap() throws {
    let len = record().count
    let good = file(offsets: { t in [t, t + len] }, records: 2)
    XCTAssertEqual(try SafariCookies.parse(good).count, 2)
    let repeated = file(offsets: { t in [t, t] }, records: 1)
    XCTAssertThrowsError(try SafariCookies.parse(repeated))
  }

  func testEscapedSafariCardNumberIsMaskedAndSkipped() throws {
    var data = Data(#"{"payment_cards":[{"card_number":"4111\u0031111111111111","cardholder_name":"A"},{"card_number":"4111111111111111"}]}"#.utf8)
    let cards = try SafariExport.paymentCards(&data)
    XCTAssertEqual(cards.count, 1)
    XCTAssertFalse(String(decoding: data, as: UTF8.self).contains("4111"))
    var hidden = Data(#"{"payment_cards":[{"card\u005fnumber":"4111111111111111"}]}"#.utf8)
    XCTAssertThrowsError(try SafariExport.paymentCards(&hidden))
  }
}
