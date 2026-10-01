import Foundation
import XCTest
@testable import NetnyahooSyncCore

final class RecoveryPhraseTests: XCTestCase {
  func testReferenceVectors() throws {
    let vectors: [(UInt8, String)] = [
      (0x00, Array(repeating: "abandon", count: 23).joined(separator: " ") + " art"),
      (0x7f, "legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title"),
      (0x80, "letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic bless"),
      (0xff, Array(repeating: "zoo", count: 23).joined(separator: " ") + " vote"),
    ]
    for (byte, phrase) in vectors {
      let entropy = Data(repeating: byte, count: 32)
      XCTAssertEqual(RecoveryPhrase.words(for: entropy).joined(separator: " "), phrase)
      XCTAssertEqual(try RecoveryPhrase.entropy(from: phrase), entropy)
    }
  }
}

final class SyncCryptoTests: XCTestCase {
  let keys = SyncKeys(entropy: RecoveryPhrase.generateEntropy())

  func testTamperingIsDetected() throws {
    let sealed = try keys.seal(Data("bookmark".utf8), scopeTag: "s", fileId: "f")
    for index in [4, 10, 16, 40, sealed.count - 1] {
      var bad = sealed
      bad[index] ^= 0x01
      XCTAssertThrowsError(try keys.open(bad, scopeTag: "s", fileId: "f")) { XCTAssertEqual($0 as? SyncKeys.Failure, .authentication) }
    }
    XCTAssertThrowsError(try keys.open(sealed.prefix(sealed.count / 2), scopeTag: "s", fileId: "f"))
    XCTAssertThrowsError(try keys.open(sealed.prefix(10), scopeTag: "s", fileId: "f")) { XCTAssertEqual($0 as? SyncKeys.Failure, .format) }
    XCTAssertThrowsError(try keys.open(Data(), scopeTag: "s", fileId: "f")) { XCTAssertEqual($0 as? SyncKeys.Failure, .format) }
    XCTAssertThrowsError(try keys.open(sealed, scopeTag: "s", fileId: "g")) { XCTAssertEqual($0 as? SyncKeys.Failure, .authentication) }
    XCTAssertThrowsError(try keys.open(sealed, scopeTag: "t", fileId: "f")) { XCTAssertEqual($0 as? SyncKeys.Failure, .authentication) }
  }

  func testWrongPhraseCantOpen() throws {
    let sealed = try keys.seal(Data("bookmark".utf8), scopeTag: "s", fileId: "f")
    let other = SyncKeys(entropy: RecoveryPhrase.generateEntropy())
    XCTAssertThrowsError(try other.open(sealed, scopeTag: "s", fileId: "f")) { XCTAssertEqual($0 as? SyncKeys.Failure, .authentication) }
    XCTAssertNotEqual(other.chainTag, keys.chainTag)
  }
}

final class SyncVaultTests: XCTestCase {
  var folder: URL!
  let entropy = RecoveryPhrase.generateEntropy()
  var vault: SyncVault!

  override func setUpWithError() throws {
    folder = FileManager.default.temporaryDirectory.appendingPathComponent("nn-sync-tests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    vault = SyncVault(folder: folder, keys: SyncKeys(entropy: entropy))
  }

  override func tearDownWithError() throws {
    try? FileManager.default.removeItem(at: folder)
  }

  func testFolderHoldsNoPlaintext() throws {
    try vault.createChain()
    let secrets = ["https://secret-bank.example/login", "Quarterly Plans", "hunter2-password", "alice@example.com"]
    try vault.write(scope: "p:default", payload: try JSONSerialization.data(withJSONObject: ["secrets": secrets]))
    let files = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: nil)!.compactMap { $0 as? URL }
    XCTAssertFalse(files.isEmpty)
    for url in files {
      let name = url.deletingPathExtension().lastPathComponent
      XCTAssertTrue(Base32.isTag(name), name)
      for secret in secrets + ["default", "app"] {
        XCTAssertFalse(url.path.dropFirst(folder.path.count).contains(secret))
      }
      guard let data = try? Data(contentsOf: url) else { continue }
      for secret in secrets { XCTAssertNil(data.range(of: Data(secret.utf8)), "\(secret) in \(url.lastPathComponent)") }
    }
  }

  func testDeleteChainLeavesOtherPhrases() throws {
    try vault.createChain()
    try vault.write(scope: "app", payload: Data("mine".utf8))
    let other = SyncVault(folder: folder, keys: SyncKeys(entropy: RecoveryPhrase.generateEntropy()))
    try other.createChain()
    try other.write(scope: "app", payload: Data("theirs".utf8))
    try vault.deleteChain()
    XCTAssertFalse(vault.chainExists())
    XCTAssertEqual(other.read(scope: "app", skipping: []).files.count, 1)
  }
}
