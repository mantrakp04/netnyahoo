import Foundation
import XCTest
@testable import NetnyahooImportCore

final class ArcTests: XCTestCase {
  func testSidebarSpacesPinnedTodayAndFavorites() throws {
    let sidebar = try ArcSidebar.parse(Data(contentsOf: Fixtures.support("Arc/StorableSidebar.json")))
    XCTAssertEqual(sidebar.spaces.map(\.name), ["Personal", "Work", "Space 1"])
    XCTAssertEqual(sidebar.spaces.map(\.profileId), ["Default", "Profile 1", "Default"])

    let personal = sidebar.spaces[0]
    XCTAssertEqual(personal.color, "#3366CC")
    XCTAssertEqual(personal.emoji, "🏡")
    XCTAssertNil(personal.icon)
    XCTAssertEqual(personal.pinned.map(\.outline), [
      "Cal<https://calendar.example/>",
      "Reading[A long blog post<https://blog.example/post>, Later[Later<https://later.example/>]]",
      "Left<https://left.example/>",
      "Right<https://right.example/>",
    ])
    XCTAssertEqual(personal.pinned[0].pageTitle, "Calendar – Week of Sep 1")
    XCTAssertNil(personal.pinned[2].pageTitle)
    // The easel row is skipped; the rename is kept alongside the page title.
    XCTAssertEqual(personal.tabs.map(\.url), ["https://today.example/", "https://today2.example/"])
    XCTAssertEqual(personal.tabs[1].customTitle, "Renamed today")
    XCTAssertEqual(personal.tabs[1].title, "Another today")
    XCTAssertEqual(personal.tabs[0].lastActive, Double(1788220800 - 60) * 1000)
    XCTAssertEqual(personal.tabs[0].pinned, false)

    let work = sidebar.spaces[1]
    XCTAssertEqual(work.icon, "briefcase")
    XCTAssertEqual(work.colors, ["#FF8000", "#FF0080"])  // extended-sRGB channels clamped
    XCTAssertEqual(work.color, "#FF8000")
    XCTAssertEqual(work.pinned.map(\.outline), ["Board<https://jira.example/>"])
    XCTAssertEqual(work.tabs, [])

    XCTAssertEqual(sidebar.spaces[2].emoji, "🚀")

    XCTAssertEqual(sidebar.favorites["Default"]?.map(\.url), ["https://mail.example.com/", "https://music.example/", "https://maps.example/"])
    XCTAssertEqual(sidebar.favorites["Default"]?[1].customTitle, "Tunes")
    XCTAssertEqual(sidebar.favorites["Default"]?.allSatisfy(\.pinned), true)
    XCTAssertEqual(sidebar.favorites["Profile 1"]?.map(\.title), ["Slack"])
  }

  func testRejectsOtherJSON() {
    XCTAssertThrowsError(try ArcSidebar.parse(Data("{\"roots\":{}}".utf8)))
    XCTAssertEqual(try ArcSidebar.parse(Data("{\"sidebar\":{\"containers\":[{\"global\":{}}]}}".utf8)), ArcSidebar())
  }
}

final class NetscapeBookmarksTests: XCTestCase {
  func testChromeExport() throws {
    let root = try NetscapeBookmarks.load(Fixtures.url("html/chrome-bookmarks.html"))
    XCTAssertEqual(root.outline, """
      Bookmarks[Bookmarks bar{toolbar}[Netnyahoo<https://netnyahoo.example/>, Empty folder[], \
      Tools[Tool <beta> ✓<https://tool.example/?q="x"&y='1'>]], \
      Loose link<https://loose.example/>, \
      Other Bookmarks{other}[lowercase, unquoted<https://unquoted.example/>]]
      """)
    XCTAssertEqual(root.children?[0].children?[0].dateAdded, 1_700_000_001_000)
  }

  func testSafariExportHTML() throws {
    let root = try NetscapeBookmarks.load(Fixtures.url("safari/Safari Export/Bookmarks.html"))
    XCTAssertEqual(root.outline, """
      Bookmarks[Favorites[Apple<https://www.apple.example/>, News & Views<https://news.example/?a=1&b=2>], \
      Travel[Japan[京都 guide<https://kyoto.example/>]], \
      Reading List{readingList}[A long read<https://longread.example/article>]]
      """)
  }

  func testUnterminatedMarkupStillParses() {
    let root = NetscapeBookmarks.parse("<DL><p><DT><H3>Loose<DL><p><DT><A HREF=\"https://x.example/\">X<DT><A HREF='https://y.example/'>Y</A>")
    XCTAssertEqual(root.linkCount, 2)
    XCTAssertEqual(root.children?.first?.title, "Loose")
  }
}

final class PasswordsCSVTests: XCTestCase {
  func testChrome() throws {
    let rows = try PasswordsCSV.load(Fixtures.url("csv/chrome-passwords.csv"))
    XCTAssertEqual(rows.count, 2)
    XCTAssertEqual(rows[1].password, "with \"quotes\", commas")
    XCTAssertEqual(rows[1].note, "gift card in note")
    XCTAssertEqual(rows[1].title, "shop.example")
  }

  func testFirefox() throws {
    let rows = try PasswordsCSV.load(Fixtures.url("csv/firefox-passwords.csv"))
    XCTAssertEqual(rows.map(\.username), ["fox@example.com", "admin"])
    XCTAssertEqual(rows[1].realm, "Router")
    XCTAssertEqual(rows[0].lastUsed, 1788220800000)
  }

  func testSafariWithBOMQuotesAndNewlines() throws {
    let rows = try PasswordsCSV.load(Fixtures.url("safari/Safari Export/Passwords.csv"))
    XCTAssertEqual(rows.count, 2)  // the row without a password is skipped
    XCTAssertEqual(rows[0].password, "pa,ss\"word")
    XCTAssertEqual(rows[0].note, "line one\nline two")
    XCTAssertEqual(rows[0].otpAuth, "otpauth://totp/Example?secret=JBSWY3DPEHPK3PXP")
    XCTAssertEqual(rows[1].username, "")
  }

  func testBitwardenAndUnknown() throws {
    XCTAssertEqual(try PasswordsCSV.load(Fixtures.url("csv/bitwarden.csv")).map(\.password), ["bw-pass"])
    XCTAssertThrowsError(try PasswordsCSV.load(Fixtures.url("csv/not-passwords.csv"))) { error in
      XCTAssertEqual((error as? ImportError)?.code, "unsupported")
    }
  }
}

final class SafariExportTests: XCTestCase {
  func testZipAndFolderAgree() throws {
    let zip = try SafariExport.load(Fixtures.url("safari/Safari Export.zip"))
    let folder = try SafariExport.load(Fixtures.url("safari/Safari Export"))
    XCTAssertEqual(zip, folder)

    XCTAssertEqual(zip.bookmarks?.linkCount, 4)
    XCTAssertEqual(zip.credentials.count, 2)
    XCTAssertEqual(zip.profiles.map(\.name), [nil, "Work"])
    let history = zip.profiles[0].history
    // The redirecting hop and the file:// entry are dropped; newest first; either visit-count spelling.
    XCTAssertEqual(history.map(\.url), ["https://newest.safari.example/", "https://www.apple.example/maps/"])
    XCTAssertEqual(history.map(\.visits), [9, 3])
    XCTAssertEqual(history[1].lastVisit, Double((1788220800 - 100) * 1_000_000 + 97) / 1000)
    XCTAssertEqual(zip.profiles[0].extensions, ["Example Blocker"])
    XCTAssertEqual(zip.profiles[1].history.map(\.title), ["Work thing"])
    XCTAssertTrue(zip.warnings.isEmpty)
  }

  func testRejectsOtherArchives() {
    XCTAssertThrowsError(try SafariExport.load(Fixtures.url("safari/not-an-export.zip")))
    XCTAssertThrowsError(try SafariExport.load(Fixtures.url("misc")))
    XCTAssertThrowsError(try SafariExport.load(Fixtures.url("safari/missing.zip"))) { error in
      XCTAssertEqual((error as? ImportError)?.code, "notFound")
    }
  }
}
