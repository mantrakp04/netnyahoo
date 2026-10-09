import XCTest
@testable import ArcadiaImportCore

final class ExtensionsTests: XCTestCase {
  func testListsWebStoreExtensionsWithNames() {
    let list = ChromiumExtensions.list(profile: Fixtures.url("extensions/Default"))
    XCTAssertEqual(list.map(\.name), ["Localized Blocker", "Older Chrome Keeps Manifests", "Plain Name"])
    XCTAssertEqual(list.map(\.id), ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"])
    XCTAssertEqual(list.first?.webStoreUrl, "https://chromewebstore.google.com/detail/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
  }

  func testMissingProfileListsNothing() {
    XCTAssertEqual(ChromiumExtensions.list(profile: Fixtures.url("extensions/Nope")), [])
  }
}
