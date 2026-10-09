// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "ArcadiaSyncCore",
  platforms: [.macOS(.v14)],
  products: [.library(name: "ArcadiaSyncCore", targets: ["ArcadiaSyncCore"])],
  targets: [
    .target(name: "ArcadiaSyncCore", path: "ios/Core"),
    .testTarget(name: "ArcadiaSyncCoreTests", dependencies: ["ArcadiaSyncCore"], path: "tests"),
  ]
)
