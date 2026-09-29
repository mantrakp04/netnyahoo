// swift-tools-version:5.9
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
