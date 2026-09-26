// swift-tools-version:5.9
// Builds the sync core (ios/Core: phrase, keys, sealed files, the folder) on its own so it
// can be tested with `swift test`: no app, no CocoaPods, no Expo. The pod compiles the same files.
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
