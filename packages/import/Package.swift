// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "ArcadiaImportCore",
  platforms: [.macOS(.v14)],
  products: [.library(name: "ArcadiaImportCore", targets: ["ArcadiaImportCore"])],
  targets: [
    .target(name: "ArcadiaImportCore", path: "ios/Core", linkerSettings: [.linkedLibrary("sqlite3")]),
    .testTarget(
      name: "ArcadiaImportCoreTests",
      dependencies: ["ArcadiaImportCore"],
      path: "tests"
    ),
  ]
)
