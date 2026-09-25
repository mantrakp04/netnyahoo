// swift-tools-version:5.9
// Builds the pure-Swift import core (ios/Core) on its own so the parsers can be tested with
// `swift test` — no app, no CocoaPods, no Expo. The pod compiles the same files.
import PackageDescription

let package = Package(
  name: "NetnyahooImportCore",
  platforms: [.macOS(.v14)],
  products: [.library(name: "NetnyahooImportCore", targets: ["NetnyahooImportCore"])],
  targets: [
    .target(name: "NetnyahooImportCore", path: "ios/Core", linkerSettings: [.linkedLibrary("sqlite3")]),
    .testTarget(
      name: "NetnyahooImportCoreTests",
      dependencies: ["NetnyahooImportCore"],
      path: "tests"
    ),
  ]
)
