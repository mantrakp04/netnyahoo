// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "NetnyahooSyncCore",
  platforms: [.macOS(.v14)],
  products: [.library(name: "NetnyahooSyncCore", targets: ["NetnyahooSyncCore"])],
  targets: [
    .target(name: "NetnyahooSyncCore", path: "ios/Core"),
    .testTarget(name: "NetnyahooSyncCoreTests", dependencies: ["NetnyahooSyncCore"], path: "tests"),
  ]
)
