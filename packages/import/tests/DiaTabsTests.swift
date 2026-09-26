import AppKit
import Foundation
import XCTest
@testable import NetnyahooImportCore

/// A Dia that answers from a fixture shaped like its AppleScript dictionary (window → profile → tab).
struct FixtureDia: DiaScriptingSource {
  var result: Result<[DiaScript.Window], ImportError>

  static func load(_ path: String = "dia/applescript-windows.json") throws -> FixtureDia {
    FixtureDia(result: .success(try JSONDecoder().decode([DiaScript.Window].self, from: Data(contentsOf: Fixtures.url(path)))))
  }

  func windows() throws -> [DiaScript.Window] { try result.get() }
}

final class DiaTabsTests: XCTestCase {
  func testMergesWindowsPerProfileWithPinnedFirstAndDeduplicated() throws {
    let result = try DiaTabsImport.read(from: FixtureDia.load())
    XCTAssertEqual(result.windowCount, 2)
    // "Side project" only has Dia's New Tab page: nothing to bring, so it isn't offered.
    XCTAssertEqual(result.profiles.map(\.name), ["Personal", "Work"])
    XCTAssertEqual(result.profiles.map(\.id), ["1:Personal", "2:Work"])

    let personal = result.profiles[0]
    // Pinned in Dia's order, once, although every window lists them (and spells a host in capitals).
    XCTAssertEqual(personal.pinned.map(\.url), ["https://mail.example.com/", "https://docs.example.com/"])
    XCTAssertTrue(personal.pinned.allSatisfy(\.pinned))
    // Open tabs: front window first; "a#" and "a" are the same page; the open copy of a pinned page goes.
    XCTAssertEqual(personal.tabs.map(\.url), ["https://news.example.com/a#", "https://shop.example.com/cart",
                                              "https://food.example.com/soup?page=2"])
    XCTAssertEqual(personal.tabs.map(\.windowIndex), [0, 0, 1])
    XCTAssertEqual(personal.tabs.map(\.active), [false, true, false])
    XCTAssertEqual(personal.tabs.map(\.title), ["Story A", "Cart", "Recipes"])
    XCTAssertFalse(personal.tabs.contains(where: \.pinned))

    let work = result.profiles[1]
    // A page pinned in one window and open in another comes over pinned only.
    XCTAssertEqual(work.pinned.map(\.url), ["https://status.example.com", "https://linear.example.com/"])
    // The same page in two profiles stays in both: they become different Netnyahoo profiles.
    XCTAssertEqual(work.tabs.map(\.url), ["https://news.example.com/a"])

    // chrome://settings, about:blank, a tab with no URL yet, and two dia://newtab pages.
    XCTAssertEqual(result.skipped, 5)
    // Personal: an open copy of a pinned page, and the back window's mail, Docs and story A; Work: status.
    XCTAssertEqual(result.duplicates, 5)
  }

  func testNoWindowsMeansNothingToImport() throws {
    let result = try DiaTabsImport.read(from: FixtureDia(result: .success([])))
    XCTAssertEqual(result, DiaTabsResult(profiles: [], windowCount: 0, skipped: 0, duplicates: 0))
  }

  func testUnnamedProfileGetsANameAndProfilesFollowDiaOrder() {
    let tab = DiaScript.Tab(id: "1", title: "A", url: "https://a.example/", isPinned: false)
    let result = DiaTabsImport.build([
      DiaScript.Window(id: "w", name: "", index: 1, profiles: [
        DiaScript.Profile(name: "Later", index: 2, tabs: [tab]),
        DiaScript.Profile(name: "", index: 1, tabs: [tab]),
      ]),
    ])
    XCTAssertEqual(result.profiles.map(\.name), ["Profile 1", "Later"])
  }

  func testErrorsFromTheSourcePassThrough() {
    XCTAssertThrowsError(try DiaTabsImport.read(from: FixtureDia(result: .failure(.notRunning("Dia isn't running"))))) {
      XCTAssertEqual(($0 as? ImportError)?.code, "notRunning")
    }
  }

  func testDedupeKey() {
    XCTAssertEqual(DiaTabsImport.dedupeKey("HTTPS://Example.COM"), "https://example.com/")
    XCTAssertEqual(DiaTabsImport.dedupeKey("https://example.com/Path#"), "https://example.com/Path")
    XCTAssertNotEqual(DiaTabsImport.dedupeKey("https://example.com/a#x"), DiaTabsImport.dedupeKey("https://example.com/a"))
    XCTAssertNotEqual(DiaTabsImport.dedupeKey("https://example.com/a?b=1"), DiaTabsImport.dedupeKey("https://example.com/a"))
    XCTAssertNil(DiaTabsImport.dedupeKey("https:///nohost"))
  }

  func testAutomationStatusCodes() {
    XCTAssertEqual(DiaAutomation.status(noErr), .granted)
    XCTAssertEqual(DiaAutomation.status(-1744), .notDetermined)  // errAEEventWouldRequireUserConsent
    XCTAssertEqual(DiaAutomation.status(-1743), .denied)  // errAEEventNotPermitted
    XCTAssertEqual(DiaAutomation.status(-600), .notRunning)  // procNotFound
    XCTAssertEqual(DiaAutomation.error(-1743, timeout: 10).code, "locked")
    XCTAssertEqual(DiaAutomation.error(-600, timeout: 10).code, "notRunning")
    XCTAssertEqual(DiaAutomation.error(-1712, timeout: 10).description, "Dia didn't answer within 10 seconds")
  }

  /// `URL of every tab of every profile of every window`, as AppleScript itself encodes it.
  func testObjectSpecifierShape() {
    typealias Spec = DiaAppleEvents.Spec
    let spec = Spec.property(fourCC("URL "), of: Spec.every(fourCC("DiaT"), of: Spec.every(fourCC("DiaP"),
      of: Spec.every(fourCC("cwin"), of: .null()))))
    XCTAssertEqual(spec.descriptorType, fourCC("obj "))
    func field(_ d: NSAppleEventDescriptor, _ key: StaticString) -> NSAppleEventDescriptor {
      d.coerce(toDescriptorType: fourCC("reco"))!.forKeyword(fourCC(key))!
    }
    XCTAssertEqual(field(spec, "want").typeCodeValue, fourCC("prop"))
    XCTAssertEqual(field(spec, "seld").typeCodeValue, fourCC("URL "))
    var level = field(spec, "from")
    for cls: StaticString in ["DiaT", "DiaP", "cwin"] {
      XCTAssertEqual(field(level, "want").typeCodeValue, fourCC(cls))
      XCTAssertEqual(field(level, "form").enumCodeValue, fourCC("indx"))
      XCTAssertEqual(field(level, "seld").descriptorType, fourCC("abso"))
      level = field(level, "from")
    }
    XCTAssertEqual(level.descriptorType, fourCC("null"))
  }

  func testListsTheDiaTabsSourceAfterDia() {
    let list = Fixtures.discovery().list()
    let index = list.firstIndex { $0.id == "diaTabs" }
    XCTAssertEqual(index, list.firstIndex { $0.id == "dia" }.map { $0 + 1 })
    let source = list.first { $0.id == "diaTabs" }!
    XCTAssertEqual(source.name, "Dia: open and pinned tabs (via Dia)")
    XCTAssertEqual(source.family, .automation)
    XCTAssertEqual(source.iconPath, "/tmp/icons/dia.png")
    XCTAssertFalse(source.needsKeychain)
    XCTAssertTrue(source.profiles.isEmpty)
    // Not a file-backed browser: importData can't be pointed at it.
    XCTAssertThrowsError(try Importer(discovery: Fixtures.discovery()).importData(browserId: "diaTabs", profileId: "Default", kinds: [.tabs]))
  }
}
