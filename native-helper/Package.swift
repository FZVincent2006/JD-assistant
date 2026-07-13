// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "FeishuAuthHost",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "feishu-auth-host", targets: ["FeishuAuthHostCLI"]),
        .executable(name: "feishu-auth-host-tests", targets: ["FeishuAuthHostTestsRunner"])
    ],
    targets: [
        .target(name: "FeishuAuthHost"),
        .executableTarget(
            name: "FeishuAuthHostCLI",
            dependencies: ["FeishuAuthHost"]
        ),
        .executableTarget(
            name: "FeishuAuthHostTestsRunner",
            dependencies: ["FeishuAuthHost"],
            path: "Tests/FeishuAuthHostTests"
        )
    ]
)
