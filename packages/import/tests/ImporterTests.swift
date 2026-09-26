import Foundation
import XCTest
@testable import NetnyahooImportCore

final class DiscoveryTests: XCTestCase {
  func testListsInstalledBrowsersWithProfiles() throws {
    let list = Fixtures.discovery().list()
    // Edge etc. have no data; Safari is listed because its app is "installed".
    XCTAssertEqual(list.map(\.id), ["chrome", "arc", "dia", "diaTabs", "safari", "firefox", "brave", "helium", "opera"])
    let byId = Dictionary(uniqueKeysWithValues: list.map { ($0.id, $0) })

    // Dia: a plain Chromium source (its encrypted sidebar isn't advertised).
    let dia = byId["dia"]!
    XCTAssertTrue(dia.needsKeychain)
    XCTAssertEqual(dia.family, .chromium)
    XCTAssertEqual(dia.profiles.map(\.name), ["Personal", "Work"])
    XCTAssertEqual(dia.profiles[0].available, [.bookmarks, .history, .tabs, .passwords])
    XCTAssertTrue(dia.profiles[0].isDefault)
    XCTAssertEqual(dia.profiles[0].color, "#3F51B5")
    XCTAssertNil(dia.profiles[1].color)  // opaque black = unset

    // Helium: ungoogled-chromium fork; ordinary Chromium profile.
    let helium = byId["helium"]!
    XCTAssertTrue(helium.needsKeychain)
    XCTAssertEqual(helium.profiles.map(\.id), ["Default"])
    XCTAssertEqual(helium.profiles[0].name, "Helium")
    XCTAssertEqual(helium.profiles[0].available, [.bookmarks, .history, .tabs, .passwords])

    let chrome = list[0]
    XCTAssertEqual(chrome.iconPath, "/tmp/icons/chrome.png")
    XCTAssertTrue(chrome.needsKeychain)
    XCTAssertEqual(chrome.profiles.map(\.id), ["Default", "Profile 1"])
    let personal = chrome.profiles[0]
    XCTAssertEqual(personal.name, "Personal")
    XCTAssertEqual(personal.email, "alex@example.com")
    XCTAssertEqual(personal.color, "#3F51B5")
    XCTAssertTrue(personal.isDefault)
    XCTAssertEqual(personal.avatarPath.map { URL(fileURLWithPath: $0).lastPathComponent }, "Google Profile Picture.png")
    XCTAssertEqual(personal.available, [.bookmarks, .history, .tabs, .passwords, .cookies])
    XCTAssertEqual(chrome.profiles[1].available, [.bookmarks, .history])
    XCTAssertFalse(chrome.profiles[1].isDefault)

    let arc = list[1]
    XCTAssertEqual(arc.profiles.map(\.name), ["Your Chromium", "Work"])
    XCTAssertEqual(arc.profiles[0].spaces?.map(\.name), ["Personal", "Space 1"])
    XCTAssertEqual(arc.profiles[0].spaces?[0].pinnedCount, 5)
    XCTAssertEqual(arc.profiles[0].spaces?[0].tabCount, 2)
    XCTAssertEqual(arc.profiles[0].available, [.history, .passwords, .spaces, .pinnedTabs, .tabs, .favorites])
    XCTAssertEqual(arc.profiles[1].spaces?.map(\.name), ["Work"])

    let safari = byId["safari"]!
    XCTAssertTrue(safari.requiresExport)
    XCTAssertTrue(safari.profiles.isEmpty)

    let firefox = byId["firefox"]!
    XCTAssertFalse(firefox.needsKeychain)
    XCTAssertEqual(firefox.profiles.map(\.id), ["Profiles/abcd1234.default-release", "Profiles/zzzz9999.work"])
    XCTAssertEqual(firefox.profiles[0].available, [.bookmarks, .history, .tabs, .passwords, .cookies])
    XCTAssertTrue(firefox.profiles[0].isDefault)

    XCTAssertEqual(byId["opera"]!.profiles.map(\.id), ["."])
    XCTAssertEqual(byId["opera"]!.profiles[0].available, [.bookmarks])
  }

  func testProtectedDataFolderIsListedAsNeedingFullDiskAccess() throws {
    // Chrome and Brave protect their data from other apps: entries can be stat'ed but the folder can't be
    // listed without Full Disk Access. Such a browser is still offered, flagged, with no profiles.
    let support = FileManager.default.temporaryDirectory.appendingPathComponent("nn-fda-\(UUID().uuidString)")
    let chrome = support.appendingPathComponent("Google/Chrome")
    try FileManager.default.createDirectory(at: chrome.appendingPathComponent("Default"), withIntermediateDirectories: true)
    try Data("{}".utf8).write(to: chrome.appendingPathComponent("Default/Preferences"))
    try FileManager.default.setAttributes([.posixPermissions: 0o100], ofItemAtPath: chrome.path)
    defer {
      try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: chrome.path)
      try? FileManager.default.removeItem(at: support)
    }
    let list = BrowserDiscovery(applicationSupport: support).list()
    XCTAssertEqual(list.map(\.id), ["chrome"])
    XCTAssertTrue(list[0].needsFullDiskAccess)
    XCTAssertTrue(list[0].profiles.isEmpty)
    // An unreadable folder with no profile markers (a leftover NativeMessagingHosts dir) isn't offered.
    let edge = support.appendingPathComponent("Microsoft Edge")
    try FileManager.default.createDirectory(at: edge.appendingPathComponent("NativeMessagingHosts"), withIntermediateDirectories: true)
    try FileManager.default.setAttributes([.posixPermissions: 0o100], ofItemAtPath: edge.path)
    defer { try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: edge.path) }
    XCTAssertEqual(BrowserDiscovery(applicationSupport: support).list().map(\.id), ["chrome"])
    // Readable folders aren't flagged.
    XCTAssertFalse(Fixtures.discovery().list().contains { $0.needsFullDiskAccess })
  }

  func testSafariHiddenWhenNotInstalled() {
    let d = BrowserDiscovery(applicationSupport: Fixtures.support)
    XCTAssertFalse(d.list().contains { $0.id == "safari" })
    XCTAssertTrue(d.list().contains { $0.id == "chrome" && $0.appPath == nil })
  }

  func testProfileIdCannotEscapeDataDirectory() throws {
    let d = Fixtures.discovery()
    let chrome = BrowserDefinition.find("chrome")!
    XCTAssertNoThrow(try d.profileDirectory(chrome, "Profile 1"))
    XCTAssertThrowsError(try d.profileDirectory(chrome, "../../Firefox"))
    XCTAssertThrowsError(try d.profileDirectory(chrome, "../Chrome Beta"))
    XCTAssertThrowsError(try d.profileDirectory(chrome, "Nope"))
  }
}

final class ImporterTests: XCTestCase {
  func importer() -> Importer { Importer(discovery: Fixtures.discovery()) }

  func testHeliumImportsAsChromium() throws {
    let importer = importer()
    let locked = try importer.importData(browserId: "helium", profileId: "Default",
                                         kinds: [.bookmarks, .history, .tabs, .passwords])
    XCTAssertEqual(locked.bookmarks?.linkCount, 2)
    XCTAssertEqual(locked.historyCount, 2)
    XCTAssertEqual(locked.tabs.map(\.url), ["https://helium.example/"])
    XCTAssertEqual(locked.failed, [.passwords])  // locked until unlocked

    // Helium's Keychain item is "Helium Storage Key" / "Helium".
    var asked = ""
    try importer.unlock(browserId: "helium") { service, account in
      asked = "\(service)/\(account)"
      return Fixtures.chromiumSecret
    }
    XCTAssertEqual(asked, "Helium Storage Key/Helium")
    let unlocked = try importer.importData(browserId: "helium", profileId: "Default", kinds: [.passwords])
    XCTAssertEqual(unlocked.credentials.map(\.password), ["helium-pass"])
  }

  func testDiaImportsAsChromiumWithSessionsAndProfiles() throws {
    let importer = importer()
    let r = try importer.importData(browserId: "dia", profileId: "Default", kinds: [.bookmarks, .history, .tabs])
    XCTAssertEqual(r.profile?.name, "Personal")
    XCTAssertEqual(r.bookmarks?.linkCount, 3)
    XCTAssertEqual(r.historyCount, 2)
    // Plaintext SNSS session: pinned tab first, "Long read" selected.
    XCTAssertEqual(r.tabs.map(\.url), ["https://dia.example/", "https://read.example/"])
    XCTAssertEqual(r.tabs[0].pinned, true)
    XCTAssertEqual(r.tabs.first(where: { $0.active })?.url, "https://read.example/")

    var service = ""
    try importer.unlock(browserId: "dia") { s, _ in service = s; return Fixtures.chromiumSecret }
    XCTAssertEqual(service, "Dia Safe Storage")
    XCTAssertEqual(try importer.importData(browserId: "dia", profileId: "Default", kinds: [.passwords])
      .credentials.map(\.password), ["dia-pass"])

    // Second Dia profile imports on its own.
    XCTAssertEqual(try importer.importData(browserId: "dia", profileId: "Profile 2", kinds: [.bookmarks]).bookmarks?.linkCount, 1)
  }

  func testChromeProfileLockedThenUnlocked() throws {
    let importer = importer()
    let recorder = Recorder()
    let all = ImportKind.allCases
    let locked = try importer.importData(browserId: "chrome", profileId: "Default", kinds: all,
                                         options: ImportOptions(historyLimit: 100), observer: recorder.observer(stream: false))
    XCTAssertEqual(locked.profile, ProfileSuggestion(name: "Personal", color: "#3F51B5",
                                                     avatarPath: Fixtures.support("Google/Chrome/Default/Google Profile Picture.png").path))
    XCTAssertEqual(locked.bookmarks?.linkCount, 7)
    XCTAssertEqual(locked.history.count, 100)
    XCTAssertEqual(locked.historyCount, 100)
    XCTAssertEqual(locked.tabs, ChromiumTests.expectedTabs)
    XCTAssertEqual(locked.tabGroups.map(\.title), ["Research"])
    XCTAssertEqual(locked.failed, [.passwords, .cookies, .spaces, .pinnedTabs, .favorites])
    XCTAssertEqual(locked.warnings.filter { $0.code == "locked" }.map(\.kind), [.passwords, .cookies])
    XCTAssertTrue(locked.credentials.isEmpty)
    XCTAssertEqual(recorder.events.filter { $0.phase == .end }.map(\.kind), all)
    XCTAssertEqual(recorder.events.filter { $0.kind == .bookmarks }.map(\.phase), [.start, .end])

    var asked: [String] = []
    try importer.unlock(browserId: "chrome") { service, account in
      asked.append("\(service)/\(account)")
      return Fixtures.chromiumSecret
    }
    XCTAssertEqual(asked, ["Chrome Safe Storage/Chrome"])
    XCTAssertTrue(importer.isUnlocked("chrome"))
    let unlocked = try importer.importData(browserId: "chrome", profileId: "Default", kinds: [.passwords, .cookies])
    XCTAssertEqual(unlocked.failed, [])
    XCTAssertEqual(unlocked.credentials.count, 5)
    XCTAssertEqual(unlocked.cookies.count, 4)
    XCTAssertEqual(unlocked.warnings.map(\.code), ["undecryptable", "undecryptable"])

    importer.forgetKeys()
    XCTAssertFalse(importer.isUnlocked("chrome"))
  }

  func testDeniedKeychainLeavesBrowserLocked() {
    let importer = importer()
    XCTAssertThrowsError(try importer.unlock(browserId: "brave") { _, _ in throw ImportError.locked("denied") })
    XCTAssertFalse(importer.isUnlocked("brave"))
  }

  func testWrongKeychainSecretFailsPasswords() throws {
    let importer = importer()
    try importer.unlock(browserId: "chrome") { _, _ in Data("not the secret".utf8) }
    let result = try importer.importData(browserId: "chrome", profileId: "Default", kinds: [.passwords])
    // Only the pre-encryption row reads; the rest are reported.
    XCTAssertEqual(result.credentials.map(\.password), ["plain-legacy"])
    XCTAssertEqual(result.warnings.first?.code, "undecryptable")
  }

  func testMissingDataIsEmptyNotFailed() throws {
    let result = try importer().importData(browserId: "chrome", profileId: "Profile 1", kinds: [.bookmarks, .tabs, .passwords])
    XCTAssertEqual(result.bookmarks?.linkCount, 1)
    XCTAssertEqual(result.failed, [.passwords])  // locked, even though there's also nothing there
    XCTAssertEqual(result.warnings.first { $0.kind == .tabs }?.code, "empty")
  }

  func testStreamingAndCancellation() throws {
    let recorder = Recorder()
    let result = try importer().importData(browserId: "chrome", profileId: "Default", kinds: [.history],
                                           options: ImportOptions(streamHistory: true), observer: recorder.observer(chunkSize: 500))
    XCTAssertTrue(result.history.isEmpty)
    XCTAssertEqual(result.historyCount, 2502)
    XCTAssertEqual(recorder.chunks.reduce(0) { $0 + $1.count }, 2502)

    let cancellation = Cancellation()
    cancellation.cancel()
    XCTAssertThrowsError(try importer().importData(browserId: "chrome", profileId: "Default", kinds: [.bookmarks],
                                                   cancellation: cancellation)) { error in
      XCTAssertEqual(error as? ImportError, .cancelled)
    }
  }

  func testArcSpacesFilteredBySelection() throws {
    let importer = importer()
    let result = try importer.importData(browserId: "arc", profileId: "Default",
                                         kinds: [.spaces, .pinnedTabs, .favorites, .history],
                                         options: ImportOptions(spaceIds: ["S-PERSONAL"]))
    XCTAssertEqual(result.failed, [])
    XCTAssertEqual(result.spaces.map(\.name), ["Personal"])
    XCTAssertEqual(result.spaces[0].pinned.count, 4)
    XCTAssertEqual(result.spaces[0].tabs, [])  // `.tabs` wasn't asked for
    XCTAssertEqual(result.favorites.map(\.title), ["Mail", "Music", "Maps"])
    XCTAssertEqual(result.history.map(\.url), ["https://arc-history.example/"])
    XCTAssertEqual(result.profile?.name, "Your Chromium")

    try importer.unlock(browserId: "arc") { service, _ in
      XCTAssertEqual(service, "Arc Safe Storage")
      return Fixtures.chromiumSecret
    }
    let secrets = try importer.importData(browserId: "arc", profileId: "Default", kinds: [.passwords, .tabs])
    XCTAssertEqual(secrets.credentials.map(\.password), ["arc-pass"])
    XCTAssertEqual(secrets.tabs.map(\.url), ["https://today.example/", "https://today2.example/"])
    XCTAssertEqual(secrets.spaces.map(\.name), ["Personal", "Space 1"])
  }

  func testFirefoxNeedsConsentForSecrets() throws {
    let importer = importer()
    let id = "Profiles/abcd1234.default-release"
    let locked = try importer.importData(browserId: "firefox", profileId: id, kinds: [.bookmarks, .history, .tabs, .passwords, .cookies])
    XCTAssertEqual(locked.failed, [.passwords, .cookies])
    XCTAssertEqual(locked.bookmarks?.linkCount, 4)
    XCTAssertEqual(locked.historyCount, 4)
    XCTAssertEqual(locked.tabs.count, 3)

    try importer.unlock(browserId: "firefox")
    let open = try importer.importData(browserId: "firefox", profileId: id, kinds: [.passwords, .cookies])
    XCTAssertEqual(open.failed, [])
    XCTAssertEqual(open.credentials.count, 2)
    XCTAssertEqual(open.cookies.count, 2)

    let work = try importer.importData(browserId: "firefox", profileId: "Profiles/zzzz9999.work", kinds: [.passwords])
    XCTAssertEqual(work.failed, [.passwords])
    XCTAssertEqual(work.warnings.first?.code, "locked")
    try importer.unlock(browserId: "firefox", primaryPassword: "hunter2")
    XCTAssertEqual(try importer.importData(browserId: "firefox", profileId: "Profiles/zzzz9999.work", kinds: [.passwords])
      .credentials.map(\.password), ["aes-protected"])
  }

  func testRejectsUnknownBrowserAndSafari() {
    XCTAssertThrowsError(try importer().importData(browserId: "netscape", profileId: "Default", kinds: [.bookmarks]))
    XCTAssertThrowsError(try importer().importData(browserId: "safari", profileId: "Default", kinds: [.bookmarks]))
    XCTAssertThrowsError(try importer().importData(browserId: "chrome", profileId: "../../..", kinds: [.bookmarks]))
  }

  func testResultEncodesToJSONForTheBridge() throws {
    let result = try importer().importData(browserId: "chrome", profileId: "Default", kinds: [.bookmarks, .tabs])
    let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(result)) as! [String: Any]
    XCTAssertEqual(json["browserId"] as? String, "chrome")
    XCTAssertEqual((json["tabs"] as? [[String: Any]])?.first?["pinned"] as? Bool, true)
    XCTAssertEqual((json["bookmarks"] as? [String: Any])?["type"] as? String, "folder")
  }
}
