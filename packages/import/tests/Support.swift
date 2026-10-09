import Foundation
import XCTest
@testable import ArcadiaImportCore

enum Fixtures {
  static let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("fixtures", isDirectory: true)
  static let home = root.appendingPathComponent("home", isDirectory: true)
  static let support = root.appendingPathComponent("home/Library/Application Support", isDirectory: true)

  static func url(_ path: String) -> URL { root.appendingPathComponent(path) }
  static func support(_ path: String) -> URL { support.appendingPathComponent(path) }

  static var secrets: [String: String] {
    let data = try! Data(contentsOf: url("secrets.json"))
    return try! JSONSerialization.jsonObject(with: data) as! [String: String]
  }

  static var chromiumSecret: Data { Data(secrets["chromiumSafeStorageSecret"]!.utf8) }
  static var chromiumKey: Data { ChromiumCrypto.deriveKey(secret: chromiumSecret) }

  static func discovery() -> BrowserDiscovery {
    BrowserDiscovery(
      applicationSupport: support,
      locateApp: { ids in
        let installed = ["com.google.Chrome", "company.thebrowser.Browser", "company.thebrowser.dia",
                         "org.mozilla.firefox", "com.apple.Safari", "com.brave.Browser",
                         "com.operasoftware.Opera", "net.imput.helium"]
        return ids.first(where: installed.contains).map { URL(fileURLWithPath: "/Applications/\($0).app") }
      },
      iconFor: { _, id in "/tmp/icons/\(id).png" }
    )
  }
}
