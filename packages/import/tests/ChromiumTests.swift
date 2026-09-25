import Foundation
import XCTest
@testable import NetnyahooImportCore

final class ChromiumTests: XCTestCase {
  let chrome = Fixtures.support("Google/Chrome/Default")

  // MARK: Bookmarks

  func testBookmarksMergeLocalAndAccountRoots() throws {
    let root = try ChromiumBookmarks.load(profile: chrome)
    XCTAssertEqual(root.outline, """
      Bookmarks[Bookmarks bar{toolbar}[Netnyahoo<https://netnyahoo.example/>, \
      Dev[Swift Forums<https://forums.swift.example/>, Docs[SQLite — Docs<https://sqlite.example/docs.html>]], \
      Bookmarklet<javascript:alert(1)>, From account<https://account.example/>], \
      Other bookmarks{other}[Café ☕<https://cafe.example/menu?a=1&b=2>], \
      Mobile bookmarks{mobile}[Phone link<https://phone.example/>]]
      """)
    XCTAssertEqual(root.linkCount, 7)
    // date_added "13…" µs since 1601 → Unix ms.
    let first = root.children![0].children![0]
    XCTAssertEqual(first.dateAdded, Double(1788220800 - 86400 * 100) * 1000)
  }

  func testBookmarksRejectsNonBookmarkJSON() {
    XCTAssertThrowsError(try ChromiumBookmarks.parse(Data("{\"foo\": 1}".utf8)))
  }

  // MARK: History

  func testHistoryNewestFirstWebOnly() throws {
    let (entries, count) = try HistoryReader.read(chrome.appendingPathComponent("History"), flavor: .chromium)
    // 2,500 pages + "Newest" + the untitled one; hidden, chrome:// and file:// rows are dropped.
    XCTAssertEqual(count, 2502)
    XCTAssertEqual(entries.count, 2502)
    XCTAssertEqual(entries.first, HistoryEntry(url: "https://newest.example/", title: "Newest", visits: 42,
                                               lastVisit: 1788220800 * 1000, typedCount: 5))
    XCTAssertEqual(entries[1].url, "https://site0.example/page/0")
    XCTAssertEqual(entries.last?.url, "https://no-title.example/")
    XCTAssertEqual(entries.last?.title, "")
    XCTAssertFalse(entries.contains { $0.url.hasPrefix("chrome:") || $0.url.hasPrefix("file:") || $0.url.contains("hidden") })
    XCTAssertEqual(zip(entries, entries.dropFirst()).allSatisfy { $0.lastVisit >= $1.lastVisit }, true)
  }

  func testHistoryLimitSinceAndStreaming() throws {
    let file = chrome.appendingPathComponent("History")
    let limited = try HistoryReader.read(file, flavor: .chromium, options: ImportOptions(historyLimit: 10))
    XCTAssertEqual(limited.entries.count, 10)

    // Visited within the last 30 minutes before BASE: "Newest" + pages 0…29.
    let since = Double(1788220800 - 30 * 60) * 1000
    let recent = try HistoryReader.read(file, flavor: .chromium, options: ImportOptions(historySince: since))
    XCTAssertEqual(recent.count, 31)

    let recorder = Recorder()
    let streamed = try HistoryReader.read(file, flavor: .chromium, options: ImportOptions(streamHistory: true),
                                          observer: recorder.observer(chunkSize: 1000))
    XCTAssertTrue(streamed.entries.isEmpty)
    XCTAssertEqual(streamed.count, 2502)
    XCTAssertEqual(recorder.chunks.map(\.count), [1000, 1000, 502])
    XCTAssertEqual(recorder.events.first?.phase, .start)
    XCTAssertEqual(recorder.events.first?.total, 2502)
    XCTAssertEqual(recorder.events.last?.phase, .end)
    XCTAssertEqual(recorder.events.filter { $0.phase == .progress }.map(\.processed), [1000, 2000])
  }

  func testHistoryCancellation() {
    let cancellation = Cancellation()
    let recorder = Recorder()
    let observer = recorder.observer(chunkSize: 100) { e in if e.processed >= 300 { cancellation.cancel() } }
    XCTAssertThrowsError(try HistoryReader.read(chrome.appendingPathComponent("History"), flavor: .chromium,
                                                options: ImportOptions(streamHistory: true), observer: observer,
                                                cancellation: cancellation)) { error in
      XCTAssertEqual(error as? ImportError, .cancelled)
    }
    XCTAssertLessThan(recorder.chunks.count, 10)
  }

  func testHistoryLeavesSourceUntouched() throws {
    let file = chrome.appendingPathComponent("History")
    let before = try Data(contentsOf: file)
    _ = try HistoryReader.read(file, flavor: .chromium)
    XCTAssertEqual(try Data(contentsOf: file), before)
    XCTAssertFalse(FileManager.default.fileExists(atPath: file.path + "-journal"))
  }

  // MARK: Crypto

  func testKeyDerivationMatchesIndependentImplementation() {
    // secrets.json's key was derived by Python's hashlib, not by the code under test.
    XCTAssertEqual(Fixtures.chromiumKey.map { String(format: "%02x", $0) }.joined(), Fixtures.secrets["chromiumKeyHex"])
  }

  func testDecryptRejectsWrongKeyAndPassesLegacyPlaintext() {
    let wrong = ChromiumCrypto.deriveKey(secret: Data("nope".utf8))
    XCTAssertNil(ChromiumCrypto.decrypt(Data("v10".utf8) + Data(repeating: 1, count: 16), key: wrong))
    XCTAssertEqual(ChromiumCrypto.decrypt(Data("plain".utf8), key: wrong), "plain")
  }

  // MARK: Logins

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

  func testLoginsWithWrongKeyDecryptNothing() throws {
    let outcome = try ChromiumSecrets.logins(profile: chrome, key: ChromiumCrypto.deriveKey(secret: Data("x".utf8)))
    XCTAssertEqual(outcome.items.map(\.password), ["plain-legacy"])
    XCTAssertEqual(outcome.undecryptable, 6)
  }

  // MARK: Cookies

  func testCookiesStripHostHashAndSkipExpired() throws {
    let outcome = try ChromiumSecrets.cookies(profile: chrome, key: Fixtures.chromiumKey)
    let byName = Dictionary(uniqueKeysWithValues: outcome.items.map { ($0.name, $0) })
    XCTAssertEqual(Set(byName.keys), ["sid", "legacy", "pref", "tmp"])
    XCTAssertEqual(byName["sid"]?.value, "s3ss10n")
    XCTAssertEqual(byName["sid"]?.domain, ".example.com")
    XCTAssertEqual(byName["sid"]?.secure, true)
    XCTAssertEqual(byName["sid"]?.httpOnly, true)
    XCTAssertEqual(byName["sid"]?.sameSite, "lax")
    XCTAssertEqual(byName["sid"]?.expires, 4102444800 * 1000)
    XCTAssertEqual(byName["legacy"]?.value, "no-host-prefix")
    XCTAssertEqual(byName["legacy"]?.sameSite, "strict")
    XCTAssertEqual(byName["pref"]?.value, "dark")
    XCTAssertEqual(byName["pref"]?.sameSite, "unspecified")
    XCTAssertNil(byName["tmp"]?.expires)
    XCTAssertEqual(byName["tmp"]?.path, "/app")
    XCTAssertEqual(byName["tmp"]?.value, "until-quit")
    XCTAssertEqual(outcome.undecryptable, 1)
  }

  // MARK: Sessions

  static let expectedTabs = [
    ImportedTab(url: "https://mail.example.com/", title: "Inbox", pinned: true, windowIndex: 0),
    ImportedTab(url: "https://c.example.com/", title: "C", windowIndex: 0),
    ImportedTab(url: "https://news.example.com/", title: "News", windowIndex: 0, active: true),
    ImportedTab(url: "https://docs.example.com/", title: "Docs 文档", groupId: "112233445566778899AABBCCDDEEFF00", windowIndex: 0),
    ImportedTab(url: "https://second.example.com/", title: "Second window", windowIndex: 1, active: true,
                lastActive: Double(1788220800 - 120) * 1000),
  ]

  func testSessionReplaysCommands() throws {
    let file = try XCTUnwrap(ChromiumSessions.latestFile(profile: chrome))
    XCTAssertEqual(file.lastPathComponent, "Session_13432694400000000")
    let session = try ChromiumSessions.load(profile: chrome, key: nil)
    XCTAssertEqual(session.tabs, Self.expectedTabs)
    XCTAssertEqual(session.groups, [ImportedTabGroup(id: "112233445566778899AABBCCDDEEFF00", title: "Research", color: "green", collapsed: true)])
  }

  func testEncryptedSessionNeedsKey() throws {
    let data = try Data(contentsOf: Fixtures.url("misc/Session_v5_encrypted"))
    XCTAssertThrowsError(try ChromiumSessions.parse(data, key: nil)) { error in
      XCTAssertEqual((error as? ImportError)?.code, "locked")
    }
    XCTAssertThrowsError(try ChromiumSessions.parse(data, key: ChromiumCrypto.deriveKey(secret: Data("x".utf8))))
    XCTAssertEqual(try ChromiumSessions.parse(data, key: Fixtures.chromiumKey).tabs, Self.expectedTabs)
  }

  func testSessionRejectsGarbage() {
    XCTAssertThrowsError(try ChromiumSessions.parse(Data("not a session".utf8), key: nil))
    var v1 = Data("SNSS".utf8)
    v1.append(contentsOf: [9, 0, 0, 0])
    XCTAssertThrowsError(try ChromiumSessions.parse(v1, key: nil)) { error in
      XCTAssertEqual((error as? ImportError)?.code, "unsupported")
    }
  }
}
