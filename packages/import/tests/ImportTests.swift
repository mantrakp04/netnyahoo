import Foundation
import XCTest
@testable import ArcadiaImportCore

// Importing reads another browser's live profile: it must never change it, never leave its data folder, and
// never read secrets without the user's consent (Keychain, Firefox's primary password).
final class ImportTests: XCTestCase {
  let chrome = Fixtures.support("Google/Chrome/Default")

  func testHistoryLeavesSourceUntouched() throws {
    let file = chrome.appendingPathComponent("History")
    let before = try Data(contentsOf: file)
    _ = try HistoryReader.read(file, flavor: .chromium)
    XCTAssertEqual(try Data(contentsOf: file), before)
    XCTAssertFalse(FileManager.default.fileExists(atPath: file.path + "-journal"))
  }

  func testDecryptRejectsWrongKeyAndPassesLegacyPlaintext() {
    let wrong = ChromiumCrypto.deriveKey(secret: Data("nope".utf8))
    XCTAssertNil(ChromiumCrypto.decrypt(Data("v10".utf8) + Data(repeating: 1, count: 16), key: wrong))
    XCTAssertEqual(ChromiumCrypto.decrypt(Data("plain".utf8), key: wrong), "plain")
  }

  func testLoginsDecryptAndDedupeAcrossAccountStore() throws {
    let outcome = try ChromiumSecrets.logins(profile: chrome, key: Fixtures.chromiumKey)
    let pairs = outcome.items.map { "\($0.username)@\($0.url)=\($0.password)" }
    XCTAssertEqual(pairs, [
      "alex@example.com@https://accounts.example.com/login=correct horse",
      "alex@https://shop.example/=pässwörd 🔑",
      "alex@android://hash@com.example.app/=from-android",
      "old@https://legacy.example/=plain-legacy",
      "sam@https://account-only.example/=only-in-account",
    ])
    XCTAssertEqual(outcome.undecryptable, 1)
    let first = outcome.items[0]
    XCTAssertEqual(first.realm, "https://accounts.example.com/")
    XCTAssertEqual(first.timesUsed, 12)
    XCTAssertEqual(first.lastUsed, Double(1788220800 - 3600) * 1000)
    XCTAssertEqual(first.created, Double(1788220800 - 86400 * 30) * 1000)
  }

  func testProfileIdCannotEscapeDataDirectory() throws {
    let d = Fixtures.discovery()
    let chrome = BrowserDefinition.find("chrome")!
    XCTAssertNoThrow(try d.profileDirectory(chrome, "Profile 1"))
    XCTAssertThrowsError(try d.profileDirectory(chrome, "../../Firefox"))
    XCTAssertThrowsError(try d.profileDirectory(chrome, "../Chrome Beta"))
    XCTAssertThrowsError(try d.profileDirectory(chrome, "Nope"))
  }

  func testFirefoxNeedsConsentForPasswordsNotCookies() throws {
    let importer = Importer(discovery: Fixtures.discovery())
    let id = "Profiles/abcd1234.default-release"
    let locked = try importer.importData(browserId: "firefox", profileId: id, kinds: [.bookmarks, .history, .tabs, .passwords, .cookies])
    XCTAssertEqual(locked.failed, [.passwords])
    XCTAssertEqual(locked.bookmarks?.linkCount, 4)
    XCTAssertEqual(locked.historyCount, 4)
    XCTAssertEqual(locked.tabs.count, 3)
    XCTAssertEqual(locked.cookieCount, 6)  // cookies.sqlite is plaintext: no consent step
    XCTAssertTrue(locked.warnings.contains { $0.kind == .cookies && $0.code == "skipped" })

    try importer.unlock(browserId: "firefox")
    let open = try importer.importData(browserId: "firefox", profileId: id, kinds: [.passwords])
    XCTAssertEqual(open.failed, [])
    XCTAssertEqual(open.credentials.count, 2)

    let work = try importer.importData(browserId: "firefox", profileId: "Profiles/zzzz9999.work", kinds: [.passwords])
    XCTAssertEqual(work.failed, [.passwords])
    XCTAssertEqual(work.warnings.first?.code, "locked")
    try importer.unlock(browserId: "firefox", primaryPassword: "hunter2")
    XCTAssertEqual(try importer.importData(browserId: "firefox", profileId: "Profiles/zzzz9999.work", kinds: [.passwords])
      .credentials.map(\.password), ["aes-protected"])
  }
}
