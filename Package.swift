// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "CodexAppleWatch",
    platforms: [
        .macOS(.v14),
        .watchOS(.v10)
    ],
    products: [
        .executable(name: "CodexWatchApp", targets: ["CodexWatchApp"])
    ],
    targets: [
        .executableTarget(
            name: "CodexWatchApp",
            path: "WatchApp",
            exclude: ["Info.plist", "Config.xcconfig", "Config.example.xcconfig"]
        )
    ]
)
