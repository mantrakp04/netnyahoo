import Foundation
import XCTest
@testable import NetnyahooImportCore

final class FirefoxTests: XCTestCase {
  let profile = Fixtures.support("Firefox/Profiles/abcd1234.default-release")
  let work = Fixtures.support("Firefox/Profiles/zzzz9999.work")

  func testProfilesIniPrefersInstallDefault() throws {
    let ini = try String(contentsOf: Fixtures.support("Firefox/profiles.ini"), encoding: .utf8)
    XCTAssertEqual(Firefox.profiles(ini: ini), [
      Firefox.Profile(name: "default-release", path: "Profiles/abcd1234.default-release", isDefault: true),
      Firefox.Profile(name: "Work", path: "Profiles/zzzz9999.work", isDefault: false),
      Firefox.Profile(name: "elsewhere", path: "/Volumes/External/firefox-profile", isDefault: false),
    ])
  }

  func testBookmarksTreeIncludingUncheckpointedWAL() throws {
    let root = try Firefox.bookmarks(places: profile.appendingPathComponent("places.sqlite"))
    // Separator, `place:` query and tag folders are dropped; "WAL bookmark" only exists in -wal.
    XCTAssertEqual(root.outline, """
      Bookmarks[Bookmarks Toolbar{toolbar}[Mozilla<https://www.mozilla.example/>, Dev & Docs[MDN<https://developer.mozilla.example/docs>]], \
      Bookmarks Menu{menu}[Never visited<https://bookmarked-never-visited.example/>], \
      Other Bookmarks{other}[WAL bookmark<https://in-wal.example/>]]
      """)
    XCTAssertEqual(root.children?[0].children?[0].dateAdded, Double(1788220800 - 86400) * 1000)
  }

  func testHistory() throws {
    let (entries, count) = try HistoryReader.read(profile.appendingPathComponent("places.sqlite"), flavor: .firefox)
    XCTAssertEqual(count, 4)
    XCTAssertEqual(entries.map(\.url), ["https://in-wal.example/", "https://developer.mozilla.example/docs",
                                        "https://www.mozilla.example/", "https://tagged.example/"])
    XCTAssertEqual(entries[2], HistoryEntry(url: "https://www.mozilla.example/", title: "Mozilla", visits: 10,
                                            lastVisit: Double(1788220800 - 100) * 1000, typedCount: 1))
  }

  func testSessionStore() throws {
    let session = try Firefox.loadSession(profile: profile)
    XCTAssertEqual(session.tabs, [
      ImportedTab(url: "https://www.mozilla.example/", title: "Mozilla", pinned: true, windowIndex: 0, lastActive: 1788220800 * 1000),
      ImportedTab(url: "https://a.example/", title: "A", groupId: "g-1", windowIndex: 0, active: true, lastActive: 1788220800 * 1000 - 5),
      ImportedTab(url: "https://second.example/", title: "Second", windowIndex: 1, active: true),
    ])
    XCTAssertEqual(session.groups, [ImportedTabGroup(id: "g-1", title: "Shopping", color: "orange", collapsed: false)])
  }

  func testMozLz4RejectsOtherData() {
    XCTAssertThrowsError(try Firefox.decompressMozLz4(Data("{\"windows\":[]}".utf8)))
  }

  func testLoginsWith3DESKeyAndNoPrimaryPassword() throws {
    let logins = try FirefoxLogins.logins(profile: profile)
    XCTAssertEqual(logins.map { "\($0.username)@\($0.url)=\($0.password)" }, [
      "fox@example.com@https://accounts.mozilla.example=fire & fox",
      "ユーザー@https://unicode.example=パスワード🔒",
    ])
    XCTAssertEqual(logins[0].created, Double(1788220800 - 86400) * 1000)
    XCTAssertEqual(logins[1].timesUsed, 2)
  }

  func testLoginsWithAESKeyAndPrimaryPassword() throws {
    XCTAssertThrowsError(try FirefoxLogins.logins(profile: work)) { error in
      XCTAssertEqual((error as? ImportError)?.code, "locked")
    }
    XCTAssertThrowsError(try FirefoxLogins.logins(profile: work, primaryPassword: "wrong"))
    let logins = try FirefoxLogins.logins(profile: work, primaryPassword: "hunter2")
    XCTAssertEqual(logins.map(\.password), ["aes-protected"])
  }

  func testLegacyTripleDESPBE() throws {
    let vector = try JSONSerialization.jsonObject(with: Data(contentsOf: Fixtures.url("misc/nss-legacy-pbe.json"))) as! [String: String]
    let node = try DER.parse(Data(base64Encoded: vector["der"]!)!)
    let clear = try FirefoxLogins.decryptPBE(node, globalSalt: Data(base64Encoded: vector["globalSalt"]!)!,
                                             password: Data(vector["password"]!.utf8))
    XCTAssertEqual(String(data: clear, encoding: .utf8), vector["plain"])
  }

  func testCookies() throws {
    let cookies = try Firefox.cookies(profile: profile)
    XCTAssertEqual(cookies.map(\.name), ["ff", "ms"])
    XCTAssertEqual(cookies[0].expires, 4102444800 * 1000)
    XCTAssertEqual(cookies[0].sameSite, "lax")
    XCTAssertEqual(cookies[0].created, 1788220800 * 1000)
    XCTAssertEqual(cookies[1].expires, 4102444800000)
    XCTAssertEqual(cookies[1].sameSite, "strict")
  }
}
