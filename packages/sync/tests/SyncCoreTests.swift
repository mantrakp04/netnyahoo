import CoreImage
import CryptoKit
import Foundation
import PDFKit
import XCTest
@testable import NetnyahooSyncCore

final class RecoveryPhraseTests: XCTestCase {
  func testWordlistIsBIP39English() {
    let file = Wordlist.english.joined(separator: "\n") + "\n"
    XCTAssertEqual(Data(SHA256.hash(data: Data(file.utf8))).map { String(format: "%02x", $0) }.joined(),
                   "2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda")
    XCTAssertEqual(Set(Wordlist.english).count, 2048)
  }

  /// Trezor's reference vectors for 256-bit entropy.
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

  func testGeneratedPhrasesRoundTripAndDiffer() throws {
    var seen = Set<Data>()
    for _ in 0..<50 {
      let entropy = RecoveryPhrase.generateEntropy()
      XCTAssertEqual(entropy.count, 32)
      XCTAssertTrue(seen.insert(entropy).inserted)
      let words = RecoveryPhrase.words(for: entropy)
      XCTAssertEqual(words.count, 24)
      XCTAssertEqual(try RecoveryPhrase.entropy(from: words.joined(separator: " ")), entropy)
    }
  }

  func testLenientInput() throws {
    let entropy = RecoveryPhrase.generateEntropy()
    let words = RecoveryPhrase.words(for: entropy)
    // The kit's numbered lines, upper case, commas, extra spaces.
    let numbered = words.enumerated().map { "\($0 + 1). \($1.uppercased())," }.joined(separator: "\n  ")
    XCTAssertEqual(try RecoveryPhrase.entropy(from: numbered), entropy)
    // Words cut to their first four letters (unique in BIP-39).
    let short = words.map { String($0.prefix(4)) }.joined(separator: " ")
    XCTAssertEqual(try RecoveryPhrase.entropy(from: short), entropy)
  }

  func testProblems() {
    let words = RecoveryPhrase.words(for: RecoveryPhrase.generateEntropy())
    XCTAssertThrowsError(try RecoveryPhrase.entropy(from: words.dropLast().joined(separator: " "))) {
      XCTAssertEqual($0 as? RecoveryPhrase.Problem, .wordCount(23))
    }
    XCTAssertThrowsError(try RecoveryPhrase.entropy(from: (words + ["zoo"]).joined(separator: " "))) {
      XCTAssertEqual($0 as? RecoveryPhrase.Problem, .wordCount(25))
    }
    var typo = words
    typo[5] = "netnyahoo"
    XCTAssertThrowsError(try RecoveryPhrase.entropy(from: typo.joined(separator: " "))) {
      XCTAssertEqual($0 as? RecoveryPhrase.Problem, .unknownWord("netnyahoo"))
    }
    // A wrong word that is on the list fails the checksum (255 times in 256).
    var failures = 0
    for i in 0..<24 {
      var wrong = words
      wrong[i] = wrong[i] == "abandon" ? "ability" : "abandon"
      if (try? RecoveryPhrase.entropy(from: wrong.joined(separator: " "))) == nil { failures += 1 }
    }
    XCTAssertGreaterThanOrEqual(failures, 22)
  }
}

final class SyncCryptoTests: XCTestCase {
  let keys = SyncKeys(entropy: RecoveryPhrase.generateEntropy())

  func testRoundTrip() throws {
    for size in [0, 1, 1019, 1020, 1021, 100_000] {
      let payload = Data((0..<size).map { UInt8($0 % 251) })
      let sealed = try keys.seal(payload, scopeTag: "s", fileId: "f")
      // Padded to 1 KiB, plus magic, nonce and tag.
      XCTAssertEqual((sealed.count - 4 - 12 - 16) % 1024, 0)
      XCTAssertEqual(try keys.open(sealed, scopeTag: "s", fileId: "f"), payload)
    }
  }

  func testSealIsRandomizedAndHidesThePayload() throws {
    let secret = Data("https://bank.example/login hunter2 Secret Bookmark".utf8)
    let a = try keys.seal(secret, scopeTag: "s", fileId: "f")
    let b = try keys.seal(secret, scopeTag: "s", fileId: "f")
    XCTAssertNotEqual(a, b)
    for needle in ["bank.example", "hunter2", "Secret", "https"] {
      XCTAssertNil(a.range(of: Data(needle.utf8)))
    }
  }

  func testTamperingIsDetected() throws {
    let sealed = try keys.seal(Data("bookmark".utf8), scopeTag: "s", fileId: "f")
    for index in [4, 10, 16, 40, sealed.count - 1] {
      var bad = sealed
      bad[index] ^= 0x01
      XCTAssertThrowsError(try keys.open(bad, scopeTag: "s", fileId: "f")) { XCTAssertEqual($0 as? SyncKeys.Failure, .authentication) }
    }
    // Cut short, as a file still being copied.
    XCTAssertThrowsError(try keys.open(sealed.prefix(sealed.count / 2), scopeTag: "s", fileId: "f"))
    XCTAssertThrowsError(try keys.open(sealed.prefix(10), scopeTag: "s", fileId: "f")) { XCTAssertEqual($0 as? SyncKeys.Failure, .format) }
    XCTAssertThrowsError(try keys.open(Data(), scopeTag: "s", fileId: "f")) { XCTAssertEqual($0 as? SyncKeys.Failure, .format) }
    // Moved to another name or scope.
    XCTAssertThrowsError(try keys.open(sealed, scopeTag: "s", fileId: "g")) { XCTAssertEqual($0 as? SyncKeys.Failure, .authentication) }
    XCTAssertThrowsError(try keys.open(sealed, scopeTag: "t", fileId: "f")) { XCTAssertEqual($0 as? SyncKeys.Failure, .authentication) }
  }

  func testWrongPhraseCantOpen() throws {
    let sealed = try keys.seal(Data("bookmark".utf8), scopeTag: "s", fileId: "f")
    let other = SyncKeys(entropy: RecoveryPhrase.generateEntropy())
    XCTAssertThrowsError(try other.open(sealed, scopeTag: "s", fileId: "f")) { XCTAssertEqual($0 as? SyncKeys.Failure, .authentication) }
    XCTAssertNotEqual(other.chainTag, keys.chainTag)
  }

  func testTagsAreStableAndOpaque() {
    let entropy = RecoveryPhrase.generateEntropy()
    XCTAssertEqual(SyncKeys(entropy: entropy).chainTag, SyncKeys(entropy: entropy).chainTag)
    XCTAssertEqual(SyncKeys(entropy: entropy).scopeTag("app"), SyncKeys(entropy: entropy).scopeTag("app"))
    XCTAssertNotEqual(keys.scopeTag("app"), keys.scopeTag("p:1"))
    XCTAssertTrue(Base32.isTag(keys.chainTag))
    XCTAssertTrue(Base32.isTag(keys.scopeTag("p:default")))
    XCTAssertTrue(Base32.isTag(SyncKeys.newFileId()))
    XCTAssertNotEqual(SyncKeys.newFileId(), SyncKeys.newFileId())
  }

  func testBase32() {
    // RFC 4648 test vectors, lowercased and unpadded.
    for (input, output) in [("", ""), ("f", "my"), ("fo", "mzxq"), ("foo", "mzxw6"), ("foob", "mzxw6yq"), ("fooba", "mzxw6ytb"), ("foobar", "mzxw6ytboi")] {
      XCTAssertEqual(Base32.encode(Data(input.utf8)), output)
    }
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

  func scopeDirectory(_ scope: String) -> URL { vault.scopeURL(scope) }

  func testWriteThenReadNewFilesOnly() throws {
    XCTAssertFalse(vault.chainExists())
    XCTAssertFalse(SyncFolder.hasSyncData(folder))
    try vault.createChain()
    XCTAssertTrue(vault.chainExists())
    XCTAssertTrue(SyncFolder.hasSyncData(folder))
    let a = try vault.write(scope: "app", payload: Data("one".utf8))
    let b = try vault.write(scope: "app", payload: Data("two".utf8))
    try vault.write(scope: "p:default", payload: Data("other scope".utf8))

    var listing = vault.read(scope: "app", skipping: [])
    XCTAssertEqual(Set(listing.files.map { String(decoding: $0.payload, as: UTF8.self) }), ["one", "two"])
    XCTAssertEqual(Set(listing.present), [a, b])
    listing = vault.read(scope: "app", skipping: [a])
    XCTAssertEqual(listing.files.map(\.id), [b])
    XCTAssertEqual(Set(listing.present), [a, b])

    // Another Mac with the same phrase reads the same files.
    let other = SyncVault(folder: folder, keys: SyncKeys(entropy: entropy))
    XCTAssertEqual(other.read(scope: "app", skipping: []).files.count, 2)

    vault.remove(scope: "app", ids: [a])
    listing = vault.read(scope: "app", skipping: [])
    XCTAssertEqual(listing.files.map(\.id), [b])
    XCTAssertEqual(listing.present, [b])
  }

  func testWrongPhraseFindsNothing() throws {
    try vault.createChain()
    try vault.write(scope: "app", payload: Data("one".utf8))
    let stranger = SyncVault(folder: folder, keys: SyncKeys(entropy: RecoveryPhrase.generateEntropy()))
    XCTAssertFalse(stranger.chainExists())
    XCTAssertTrue(stranger.read(scope: "app", skipping: []).files.isEmpty)
    XCTAssertTrue(SyncFolder.hasSyncData(folder))
  }

  func testPartialAndPlaceholderFiles() throws {
    try vault.createChain()
    let whole = try vault.write(scope: "app", payload: Data(repeating: 7, count: 5000))
    let cut = try vault.write(scope: "app", payload: Data(repeating: 8, count: 5000))
    let dir = scopeDirectory("app")
    // Cut short (a copy in progress), and an empty file (just created by the sync client).
    let cutURL = dir.appendingPathComponent("\(cut).nns")
    let full = try Data(contentsOf: cutURL)
    try full.prefix(full.count / 3).write(to: cutURL)
    let empty = SyncKeys.newFileId()
    try Data().write(to: dir.appendingPathComponent("\(empty).nns"))
    // iCloud Drive's placeholder for a file it hasn't downloaded yet.
    let remote = SyncKeys.newFileId()
    try Data("placeholder".utf8).write(to: dir.appendingPathComponent(".\(remote).nns.icloud"))
    // Not ours: ignored.
    try Data("x".utf8).write(to: dir.appendingPathComponent("notes.txt"))
    try Data("x".utf8).write(to: dir.appendingPathComponent(".DS_Store"))

    var listing = vault.read(scope: "app", skipping: [])
    XCTAssertEqual(listing.files.map(\.id), [whole])
    XCTAssertEqual(Set(listing.damaged.map(\.id)), [cut, empty])
    XCTAssertEqual(listing.pending, [remote])
    XCTAssertEqual(Set(listing.present), [whole, cut, empty, remote])

    // The copy finishes: the file opens on the next read.
    try full.write(to: cutURL)
    listing = vault.read(scope: "app", skipping: [whole])
    XCTAssertEqual(listing.files.map(\.id), [cut])
    XCTAssertEqual(listing.files.first?.payload, Data(repeating: 8, count: 5000))
  }

  func testFolderHoldsNoPlaintext() throws {
    try vault.createChain()
    let secrets = ["https://secret-bank.example/login", "Quarterly Plans", "hunter2-password", "alice@example.com"]
    try vault.write(scope: "p:default", payload: try JSONSerialization.data(withJSONObject: ["secrets": secrets]))
    let files = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: nil)!.compactMap { $0 as? URL }
    XCTAssertFalse(files.isEmpty)
    for url in files {
      // Names: base32 tags and ids only.
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

final class KeyStoreTests: XCTestCase {
  func testFileKeyStore() throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("nn-sync-keys-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: dir) }
    let store = FileKeyStore(directory: dir)
    let secret = RecoveryPhrase.generateEntropy()
    XCTAssertNil(store.load(account: "device"))
    XCTAssertTrue(store.save(secret, account: "device"))
    XCTAssertEqual(store.load(account: "device"), secret)
    let mode = try FileManager.default.attributesOfItem(atPath: store.url("device").path)[.posixPermissions] as? Int
    XCTAssertEqual(mode, 0o600)
    store.delete(account: "device")
    XCTAssertNil(store.load(account: "device"))
  }

  func testKeychainKeyStore() throws {
    // A throwaway item, removed again.
    let store = KeychainKeyStore(service: "Netnyahoo Sync Key (tests)")
    let account = UUID().uuidString
    defer { store.delete(account: account) }
    let secret = RecoveryPhrase.generateEntropy()
    try XCTSkipUnless(store.save(secret, account: account), "the login Keychain isn't writable here")
    XCTAssertEqual(store.load(account: account), secret)
    let replacement = RecoveryPhrase.generateEntropy()
    XCTAssertTrue(store.save(replacement, account: account))
    XCTAssertEqual(store.load(account: account), replacement)
    store.delete(account: account)
    XCTAssertNil(store.load(account: account))
  }
}

final class RecoveryKitTests: XCTestCase {
  let words = RecoveryPhrase.words(for: RecoveryPhrase.generateEntropy())

  func testPDFHasEveryWord() throws {
    let pdf = RecoveryKit.pdf(words: words, created: Date(), device: "Test Mac")
    let document = try XCTUnwrap(PDFDocument(data: pdf))
    XCTAssertEqual(document.pageCount, 1)
    XCTAssertEqual(document.page(at: 0)?.bounds(for: .mediaBox).size, CGSize(width: 612, height: 792))
    let text = try XCTUnwrap(document.string)
    XCTAssertTrue(text.contains("Netnyahoo Recovery Kit"))
    for word in words { XCTAssertTrue(text.contains(word), word) }
  }

  func testTextSheetParsesBack() throws {
    let sheet = RecoveryKit.text(words: words, created: Date(), device: "Test Mac")
    let phraseLines = sheet.components(separatedBy: "\n").filter { $0.range(of: #"^ ?\d+\. [a-z]+$"#, options: .regularExpression) != nil }
    XCTAssertEqual(phraseLines.count, 24)
    XCTAssertEqual(RecoveryPhrase.words(for: try RecoveryPhrase.entropy(from: phraseLines.joined(separator: "\n"))), words)
  }

  func testQRCodeReadsBackAsThePhrase() throws {
    let image = try XCTUnwrap(RecoveryKit.qrCode(words: words))
    let detector = try XCTUnwrap(CIDetector(ofType: CIDetectorTypeQRCode, context: nil, options: [CIDetectorAccuracy: CIDetectorAccuracyHigh]))
    let feature = try XCTUnwrap(detector.features(in: CIImage(cgImage: image)).first as? CIQRCodeFeature)
    XCTAssertEqual(feature.messageString, words.joined(separator: " "))
    XCTAssertNotNil(RecoveryKit.png(image))
  }
}
