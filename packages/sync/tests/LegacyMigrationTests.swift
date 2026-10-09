import Foundation
import XCTest
@testable import ArcadiaSyncCore

/// An in-memory keychain whose reads can be refused a number of times.
final class FakeKeychain: SecretStore {
  var items: [String: [String: Data]] = [:]
  var denials: [String: Int] = [:]
  var reads = 0

  var listFails = false
  func accounts(service: String) -> [String]? { listFails ? nil : (items[service] ?? [:]).keys.sorted() }

  func read(service: String, account: String) -> SecretRead {
    reads += 1
    if let left = denials[service], left > 0 {
      denials[service] = left - 1
      return .denied
    }
    return items[service]?[account].map(SecretRead.found) ?? .missing
  }

  func write(service: String, account: String, label: String, accessible: CFString?, data: Data) -> Bool {
    items[service, default: [:]][account] = data
    return true
  }
}

final class FakeGroups: AccessGroupMover {
  var isEntitled = true
  var moves: [(String, String)] = []
  func entitled(to groups: [String]) -> Bool { isEntitled }
  func move(from old: String, to new: String) -> (moved: Int, failure: OSStatus?) {
    moves.append((old, new))
    return (1, nil)
  }
}

/// The old names come from LegacyMigration.swift, the only file that may spell them.
func old(_ new: String) -> String { Renamed.jsonKeys.first { $0.value == new }!.key }
let oldScheme = Renamed.urls[2].old
let oldGame = Renamed.urls[0].old
let oldChromeGame = Renamed.urls[1].old
let oldPath = { (new: String) in Renamed.paths.first { $0.new == new }!.old }
let oldDefault = { (new: String) in Renamed.defaultsKeys.first { $0.value == new }!.key }

final class LegacyMigrationTests: XCTestCase {
  var root: URL!
  var oldData: URL { root.appendingPathComponent("old/\(LegacyName.bundleId)") }
  var newData: URL { root.appendingPathComponent("new/com.arcadia.browser") }
  var oldPrefs: URL { root.appendingPathComponent("prefs/\(LegacyName.bundleId)") }
  var newPrefs: URL { root.appendingPathComponent("prefs/com.arcadia.browser") }
  var oldKeychain = FakeKeychain()
  var newKeychain = FakeKeychain()
  var groups = FakeGroups()
  var answers: [Int?] = []
  var asked: [String] = []
  var oldRunning = false
  /// Answers for oldAppRunning, one per call, before falling back to `oldRunning`.
  var runningAnswers: [Bool] = []

  let safeStorageKey = Data("old safe storage key 16".utf8)

  override func setUpWithError() throws {
    root = FileManager.default.temporaryDirectory.appendingPathComponent("legacy-migration-\(UUID().uuidString)")
    try seedOldInstall()
  }

  override func tearDownWithError() throws {
    try? FileManager.default.removeItem(at: root)
  }

  // MARK: Fixtures

  func write(_ text: String, _ relative: String, in dir: URL? = nil) throws {
    let url = (dir ?? oldData).appendingPathComponent(relative)
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try Data(text.utf8).write(to: url)
  }

  func seedOldInstall() throws {
    let session: [String: Any] = [
      "version": 2,
      "settings": [
        old("openLinksInLittleArcadia"): false,
        old("littleArcadiaSize"): [700, 500],
        "shortcuts": [old("newLittleArcadia"): ["cmd+opt+y"], "newTab": ["cmd+t"]],
        "syncFolderInside": oldData.appendingPathComponent("Arcadia Sync").path,
      ],
      "tabs": [
        ["id": "t1", "url": "\(oldScheme)history", "title": "History", "windowId": "w1"],
        ["id": "t2", "url": oldChromeGame, "title": "Play \(oldGame)", "windowId": "w1"],
        ["id": "t3", "url": "\(oldGame)/?level=2", "title": "Game", "windowId": "w1"],
        ["id": "t4", "url": "https://example.com/?next=\(oldScheme)history", "title": "Example", "windowId": "w1"],
        ["id": "t5", "url": "\(oldChromeGame)u", "title": "Not the game", "windowId": "w1"],
      ],
      "groups": [["id": "g1", "pinned": true, "tabIds": ["t1"], "windowId": "w1"]],
      "launchTab": ["id": "t1", "url": "\(oldScheme)history", "profile": "Default"],
      "weight": 0.1 + 0.2,
    ]
    try FileManager.default.createDirectory(at: oldData, withIntermediateDirectories: true)
    try JSONSerialization.data(withJSONObject: session).write(to: oldData.appendingPathComponent("session.json"))
    try write(#"{"version":2,"downloads":[]}"#, "downloads.json")
    try write("not json", "broken.json")
    try write(#"{"roots":{"bookmark_bar":{"children":[{"type":"url","name":"Handy: OLDdownloads","url":"OLDdownloads","meta_info":{"KEY":"bm-1"}}],"type":"folder"}},"version":1,"checksum":"x"}"#
      .replacingOccurrences(of: "OLD", with: oldScheme).replacingOccurrences(of: "KEY", with: old("ac_sync_key")), "Chromium/Default/Bookmarks")
    try write(#"{"profile":{"info_cache":{"Default":{}}}}"#, "Chromium/Local State")
    try write("<?xml version=\"1.0\"?><plist version=\"1.0\"><array><real>1</real></array></plist>", oldPath("Chromium/ArcadiaPictureInPicture.plist"))
    try write(#"["com.1password.1password.json"]"#, oldPath("Chromium/NativeMessagingHosts/.arcadia-managed.json"))
    try write("png", oldPath("Chromium/*/Arcadia Favicons").replacingOccurrences(of: "*", with: "Default") + "/abc.png")
    try Data(repeating: 7, count: 300_000).write(to: oldData.appendingPathComponent("Chromium/Default/Cookies"))
    try FileManager.default.createSymbolicLink(atPath: oldData.appendingPathComponent("Chromium/SingletonLock").path, withDestinationPath: "host-999999")

    let prefs: [String: Any] = [
      oldDefault("ACAppIcon"): "plum",
      "\(Renamed.defaultsKeyPrefixes[0].0)Settings": "10 10 800 600",
      "NSUserKeyEquivalents": ["New \(Renamed.menuTitleWords[0].0) Window": "@~n", "Quit \(LegacyName.appName)": "@q"],
      "SUAutomaticallyUpdate": false,
      "SULastCheckTime": Date(timeIntervalSince1970: 1_800_000_000),
    ]
    try FileManager.default.createDirectory(at: oldPrefs.deletingLastPathComponent(), withIntermediateDirectories: true)
    try PropertyListSerialization.data(fromPropertyList: prefs, format: .binary, options: 0).write(to: oldPrefs.appendingPathExtension("plist"))

    oldKeychain.items = [
      Renamed.safeStorage.oldService: [Renamed.safeStorage.account!.old: safeStorageKey],
      Renamed.connectedAccounts.oldService: ["github": Data("gh-token".utf8), "google": Data("g-token".utf8)],
      Renamed.syncKey.oldService: ["device-1": Data(repeating: 1, count: 32)],
      "Chrome Safe Storage": ["Chrome": Data("someone else's".utf8)],
    ]
  }

  func context(crashAfter: String? = nil) -> LegacyMigrator.Context {
    LegacyMigrator.Context(
      oldData: oldData, newData: newData,
      oldDefaults: PreferencesDomain(id: oldPrefs.path), newDefaults: PreferencesDomain(id: newPrefs.path),
      oldSecrets: oldKeychain, newSecrets: newKeychain,
      accessGroups: [("T.\(LegacyName.bundleId).webauthn", "T.com.arcadia.browser.webauthn")], groupMover: groups,
      oldAppRunning: { [unowned self] in runningAnswers.isEmpty ? oldRunning : runningAnswers.removeFirst() },
      ask: { [unowned self] title, _, _ in
        asked.append(title)
        return answers.isEmpty ? nil : answers.removeFirst()
      },
      crashAfter: crashAfter)
  }

  func run(crashAfter: String? = nil) -> LegacyMigrator.Outcome { LegacyMigrator(context(crashAfter: crashAfter)).run() }

  func json(_ relative: String) throws -> [String: Any] {
    try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: newData.appendingPathComponent(relative))) as? [String: Any])
  }

  func snapshot(_ dir: URL) -> [String: Data] {
    var files: [String: Data] = [:]
    for case let url as URL in FileManager.default.enumerator(at: dir, includingPropertiesForKeys: nil, options: [])! {
      if let data = try? Data(contentsOf: url) { files[String(url.path.dropFirst(dir.path.count))] = data }
      if let link = try? FileManager.default.destinationOfSymbolicLink(atPath: url.path) {
        files[String(url.path.dropFirst(dir.path.count))] = Data(link.utf8)
      }
    }
    return files
  }

  func assertMigrated() throws {
    let journal = try XCTUnwrap(LegacyMigrator(context()).readJournal())
    XCTAssertEqual(journal.phase, "done")
    XCTAssertEqual(journal.outcome, "migrated")

    let session = try json("session.json")
    let settings = try XCTUnwrap(session["settings"] as? [String: Any])
    XCTAssertEqual(settings["openLinksInLittleArcadia"] as? Bool, false)
    XCTAssertNil(settings[old("openLinksInLittleArcadia")])
    XCTAssertEqual(settings["littleArcadiaSize"] as? [Int], [700, 500])
    XCTAssertEqual(settings["shortcuts"] as? [String: [String]], ["newLittleArcadia": ["cmd+opt+y"], "newTab": ["cmd+t"]])
    XCTAssertEqual(settings["syncFolderInside"] as? String, newData.appendingPathComponent("Arcadia Sync").path)
    let tabs = try XCTUnwrap(session["tabs"] as? [[String: Any]])
    XCTAssertEqual(tabs.map { $0["url"] as? String }, [
      "arcadia://history", "chrome://game", "arcadia://game/?level=2",
      "https://example.com/?next=\(oldScheme)history", "\(oldChromeGame)u",
    ])
    XCTAssertEqual(tabs[1]["title"] as? String, "Play \(oldGame)", "user text keeps what it says")
    XCTAssertEqual((session["groups"] as? [[String: Any]])?.first?["pinned"] as? Bool, true)
    XCTAssertEqual((session["launchTab"] as? [String: Any])?["url"] as? String, "arcadia://history")
    XCTAssertEqual(session["weight"] as? Double, 0.1 + 0.2)
    XCTAssertEqual(try String(contentsOf: newData.appendingPathComponent("broken.json")), "not json")
    XCTAssertEqual(try String(contentsOf: newData.appendingPathComponent("downloads.json")), #"{"version":2,"downloads":[]}"#,
                   "a document that doesn't change isn't rewritten")

    let bookmarks = try String(contentsOf: newData.appendingPathComponent("Chromium/Default/Bookmarks"))
    XCTAssertTrue(bookmarks.contains(#""url":"arcadia://downloads""#))
    XCTAssertTrue(bookmarks.contains(#""ac_sync_key":"bm-1""#))
    XCTAssertTrue(bookmarks.contains("\"name\":\"Handy: \(oldScheme)downloads\""))

    let fm = FileManager.default
    XCTAssertTrue(fm.fileExists(atPath: newData.appendingPathComponent("Chromium/ArcadiaPictureInPicture.plist").path))
    XCTAssertTrue(fm.fileExists(atPath: newData.appendingPathComponent("Chromium/NativeMessagingHosts/.arcadia-managed.json").path))
    XCTAssertTrue(fm.fileExists(atPath: newData.appendingPathComponent("Chromium/Default/Arcadia Favicons/abc.png").path))
    XCTAssertEqual(try Data(contentsOf: newData.appendingPathComponent("Chromium/Default/Cookies")).count, 300_000)
    XCTAssertNil(try? fm.destinationOfSymbolicLink(atPath: newData.appendingPathComponent("Chromium/SingletonLock").path))
    XCTAssertFalse(fm.fileExists(atPath: newData.appendingPathComponent(LegacyMigrator.stagingName).path))

    XCTAssertEqual(newKeychain.items["Arcadia Safe Storage"], ["Arcadia": safeStorageKey])
    XCTAssertEqual(newKeychain.items["Arcadia Connected Accounts"], ["github": Data("gh-token".utf8), "google": Data("g-token".utf8)])
    XCTAssertEqual(newKeychain.items["Arcadia Sync Key"], ["device-1": Data(repeating: 1, count: 32)])
    XCTAssertNil(newKeychain.items["Chrome Safe Storage"])

    let prefs = PreferencesDomain(id: newPrefs.path).all()
    XCTAssertEqual(prefs["ACAppIcon"] as? String, "plum")
    XCTAssertNil(prefs[oldDefault("ACAppIcon")])
    XCTAssertEqual(prefs["NSWindow Frame ArcadiaSettings"] as? String, "10 10 800 600")
    XCTAssertEqual(prefs["NSUserKeyEquivalents"] as? [String: String], ["New Little Arcadia Window": "@~n", "Quit Arcadia": "@q"])
    XCTAssertEqual(prefs["SUAutomaticallyUpdate"] as? Bool, false)
    XCTAssertEqual(prefs["SULastCheckTime"] as? Date, Date(timeIntervalSince1970: 1_800_000_000))
  }

  // MARK: Tests

  func testMigratesEverythingAndLeavesTheOldInstallAlone() throws {
    let before = snapshot(oldData)
    XCTAssertEqual(run(), .proceed)
    try assertMigrated()
    XCTAssertEqual(snapshot(oldData), before)
    XCTAssertEqual(groups.moves.map(\.0), ["T.\(LegacyName.bundleId).webauthn"])
  }

  func testRunsOnce() throws {
    XCTAssertEqual(run(), .proceed)
    try write(#"{"version":2,"tabs":[]}"#, "session.json", in: newData)
    let reads = oldKeychain.reads
    XCTAssertEqual(run(), .proceed)
    XCTAssertEqual(try String(contentsOf: newData.appendingPathComponent("session.json")), #"{"version":2,"tabs":[]}"#)
    XCTAssertEqual(oldKeychain.reads, reads, "a finished migration reads no keychain item")
    XCTAssertTrue(LegacyMigrator.Context.isDone(newData))
  }

  func testEveryCrashPointResumesToTheSameResult() throws {
    for step in ["staged", "secrets", "journal", "published", "defaults"] {
      try FileManager.default.removeItem(at: root)
      oldKeychain = FakeKeychain()
      newKeychain = FakeKeychain()
      try seedOldInstall()
      XCTAssertEqual(run(crashAfter: step), .quit, step)
      XCTAssertFalse(LegacyMigrator.Context.isDone(newData), step)
      XCTAssertEqual(run(), .proceed, step)
      try assertMigrated()
    }
  }

  func testOldAppStillRunningWaitsOrQuits() throws {
    oldRunning = true
    answers = [1]
    XCTAssertEqual(run(), .quit)
    XCTAssertEqual(asked.count, 1)
    XCTAssertFalse(FileManager.default.fileExists(atPath: newData.appendingPathComponent("session.json").path))
    XCTAssertFalse(LegacyMigrator.Context.isDone(newData))
    // Nobody to ask (a hidden instance): quit.
    XCTAssertEqual(run(), .quit)
    oldRunning = false
    XCTAssertEqual(run(), .proceed)
    try assertMigrated()
  }

  func testDeniedSafeStorageRetriesOrQuitsWithoutMovingAnything() throws {
    oldKeychain.denials[Renamed.safeStorage.oldService] = 2
    answers = [0, 1]
    XCTAssertEqual(run(), .quit)
    XCTAssertEqual(asked.count, 2)
    XCTAssertFalse(FileManager.default.fileExists(atPath: newData.appendingPathComponent("session.json").path))
    XCTAssertFalse(FileManager.default.fileExists(atPath: newData.appendingPathComponent(LegacyMigrator.stagingName).path))
    XCTAssertNil(LegacyMigrator(context()).readJournal())
    // Allowed the next time.
    XCTAssertEqual(run(), .proceed)
    try assertMigrated()
  }

  func testWithoutTheKeyNothingComesAcrossEncrypted() throws {
    oldKeychain.denials[Renamed.safeStorage.oldService] = 1
    answers = [2]
    XCTAssertEqual(run(), .proceed)
    XCTAssertNil(newKeychain.items["Arcadia Safe Storage"])
    XCTAssertEqual(LegacyMigrator(context()).readJournal()?.outcome, "fresh")
    XCTAssertFalse(FileManager.default.fileExists(atPath: newData.appendingPathComponent("Chromium").path))
    XCTAssertTrue(LegacyMigrator.Context.isDone(newData))
  }

  func testAKeychainThatCantListAsksToo() throws {
    oldKeychain.listFails = true
    answers = [1]
    XCTAssertEqual(run(), .quit)
    XCTAssertFalse(FileManager.default.fileExists(atPath: newData.appendingPathComponent("session.json").path))
    oldKeychain.listFails = false
    XCTAssertEqual(run(), .proceed)
    try assertMigrated()
  }

  func testOldAppOpenedDuringTheCopyStartsOver() throws {
    // Not running, then running once the copy is made, then gone when asked.
    runningAnswers = [false, true, true, false, false]
    answers = [0]
    XCTAssertEqual(run(), .proceed)
    XCTAssertEqual(asked.count, 1)
    try assertMigrated()
  }

  func testFailedGroupMovesRetryThenStop() throws {
    final class Failing: AccessGroupMover {
      var tries = 0
      func entitled(to groups: [String]) -> Bool { true }
      func move(from old: String, to new: String) -> (moved: Int, failure: OSStatus?) {
        tries += 1
        return (0, errSecInteractionNotAllowed)
      }
    }
    let failing = Failing()
    var ctx = context()
    ctx.groupMover = failing
    XCTAssertEqual(LegacyMigrator(ctx).run(), .proceed)
    XCTAssertEqual(LegacyMigrator(ctx).readJournal()?.groups, "pending")
    for _ in 0..<6 { _ = LegacyMigrator(ctx).run() }
    XCTAssertEqual(LegacyMigrator(ctx).readJournal()?.groups, "failed")
    XCTAssertEqual(failing.tries, 5)
    XCTAssertTrue(LegacyMigrator.Context.isDone(newData))
  }

  func testLeavesAnExistingArcadiaInstallAlone() throws {
    try write(#"{"version":2,"tabs":[]}"#, "session.json", in: newData)
    XCTAssertEqual(run(), .proceed)
    XCTAssertEqual(LegacyMigrator(context()).readJournal()?.outcome, "existing")
    XCTAssertEqual(try String(contentsOf: newData.appendingPathComponent("session.json")), #"{"version":2,"tabs":[]}"#)
    XCTAssertTrue(newKeychain.items.isEmpty)
  }

  func testNothingToMigrate() throws {
    try FileManager.default.removeItem(at: oldData)
    XCTAssertEqual(run(), .proceed)
    XCTAssertEqual(LegacyMigrator(context()).readJournal()?.outcome, "nothing")
    XCTAssertEqual(oldKeychain.reads, 0)
  }

  func testWhatsInTheWayGoesAside() throws {
    try write("stray", "Chromium", in: newData)
    XCTAssertEqual(run(), .proceed)
    try assertMigrated()
    let aside = newData.appendingPathComponent("\(LegacyMigrator.asideName)/Chromium")
    XCTAssertEqual(try String(contentsOf: aside), "stray")
  }

  func testKeychainGroupsWaitForTheEntitlement() throws {
    groups.isEntitled = false
    XCTAssertEqual(run(), .proceed)
    XCTAssertEqual(LegacyMigrator(context()).readJournal()?.groups, "pending")
    XCTAssertFalse(LegacyMigrator.Context.isDone(newData))
    XCTAssertTrue(groups.moves.isEmpty)
    groups.isEntitled = true
    XCTAssertEqual(run(), .proceed)
    XCTAssertEqual(LegacyMigrator(context()).readJournal()?.groups, "moved 1")
    XCTAssertTrue(LegacyMigrator.Context.isDone(newData))
    try assertMigrated()
  }

  func testRewriterOnlyTouchesWhatsOurs() {
    let r = DocumentRewriter(oldData: "/old/dir", newData: "/new/dir")
    XCTAssertEqual(r.string(oldScheme.uppercased() + "Settings/sync"), "arcadia://Settings/sync")
    XCTAssertEqual(r.string("view-source:\(oldScheme)history"), "view-source:arcadia://history")
    XCTAssertEqual(r.string("\(oldGame)#top"), "arcadia://game#top")
    XCTAssertEqual(r.string("\(oldChromeGame)/"), "chrome://game/")
    XCTAssertEqual(r.string("chrome://settings"), "chrome://settings")
    XCTAssertEqual(r.string("/old/dir/Arcadia Sync"), "/new/dir/Arcadia Sync")
    XCTAssertEqual(r.string("/old/directory"), "/old/directory")
    XCTAssertEqual(r.string("see \(oldScheme)history"), "see \(oldScheme)history")
  }

  /// Sync's format is shared with Macs on 0.2.32 and earlier: vectors made by that release's SyncCrypto.swift.
  func testSyncFormatIsUnchanged() throws {
    let keys = SyncKeys(entropy: Data(repeating: 0, count: 32))
    XCTAssertEqual(keys.chainTag, "gbcx4r55mk3rlaegbggknyx4ta")
    XCTAssertEqual(keys.scopeTag("app"), "nr4ncp5iyqzqgjn6ol4zksqtne")
    let sealed = try XCTUnwrap(Data(base64Encoded: try String(contentsOf: URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent().appendingPathComponent("fixtures/sealed-0.2.32.b64"), encoding: .utf8)
      .trimmingCharacters(in: .whitespacesAndNewlines)))
    XCTAssertEqual(try keys.open(sealed, scopeTag: keys.scopeTag("app"), fileId: "f1"), Data("from 0.2.32".utf8))
  }
}
