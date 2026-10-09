// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "ArcadiaSyncCore",
  platforms: [.macOS(.v14)],
  products: [
    .library(name: "ArcadiaSyncCore", targets: ["ArcadiaSyncCore"]),
    // The launch migration from the app's former name, run on its own (scripts/legacy-migration-e2e.mjs).
    .executable(name: "legacy-migration", targets: ["LegacyMigrationTool"]),
  ],
  targets: [
    .target(name: "ArcadiaSyncCore", path: "ios/Core"),
    .executableTarget(name: "LegacyMigrationTool", dependencies: ["ArcadiaSyncCore"], path: "tools/legacy-migration"),
    .testTarget(name: "ArcadiaSyncCoreTests", dependencies: ["ArcadiaSyncCore"], path: "tests", exclude: ["fixtures"]),
  ]
)
