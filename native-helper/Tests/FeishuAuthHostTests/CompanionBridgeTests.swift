import FeishuAuthHost
import Foundation

final class SpyCompanionRunner: CompanionRunning, @unchecked Sendable {
    var actions: [CompanionAction] = []
    var response = CompanionResponse(ok: true, reason: nil)
    var error: CompanionBridgeError?

    func run(_ action: CompanionAction) throws -> CompanionResponse {
        actions.append(action)
        if let error { throw error }
        return response
    }
}

func runCompanionBridgeTests() throws -> Int {
    let runner = SpyCompanionRunner()
    try CompanionHeadingNumberer(runner: runner).apply()
    try expect(runner.actions == [.applyHeadingNumbering], "numbering launches one fixed companion action")

    runner.response = CompanionResponse(ok: false, reason: "accessibility-not-granted")
    try expectThrowsEqual(HeadingNumberingError.accessibilityNotGranted) {
        try CompanionHeadingNumberer(runner: runner).apply()
    }

    runner.response = CompanionResponse(ok: true, reason: nil)
    try expect(
        CompanionAccessibility(runner: runner).check(prompt: false),
        "companion accessibility check returns true"
    )
    try expect(runner.actions.last == .checkAccessibility, "non-prompting check uses fixed action")

    runner.response = CompanionResponse(ok: false, reason: "accessibility-not-granted")
    try expect(
        !CompanionAccessibility(runner: runner).check(prompt: true),
        "companion accessibility request can remain pending"
    )
    try expect(runner.actions.last == .requestAccessibility, "prompting check uses fixed action")

    let executable = URL(fileURLWithPath:
        "/Users/test/Library/Application Support/ZhenFund JD Assistant/Feishu JD Assistant Helper.app/Contents/MacOS/feishu-auth-host"
    )
    try expect(
        companionBundleURL(for: executable)?.lastPathComponent == "Feishu JD Assistant Helper.app",
        "native executable resolves its containing app bundle"
    )
    try expect(
        companionBundleURL(for: URL(fileURLWithPath: "/tmp/feishu-auth-host")) == nil,
        "unbundled native executable is rejected"
    )

    let resultURL = FileManager.default.temporaryDirectory
        .appendingPathComponent("zhenfund-feishu-companion-\(UUID().uuidString).json")
    defer { try? FileManager.default.removeItem(at: resultURL) }
    let environment = SpyHeadingEnvironment()
    try expect(runCompanionCommand(arguments: [
        "--companion-action", "apply-heading-numbering",
        "--result-file", resultURL.path
    ], environment: environment), "companion accepts only its fixed argument shape")
    let result = try JSONDecoder().decode(
        CompanionResponse.self,
        from: Data(contentsOf: resultURL)
    )
    try expect(result == CompanionResponse(ok: true, reason: nil), "companion writes a safe success result")
    try expect(environment.focusCalls == 1, "companion focuses the test copy once")
    try expect(environment.postCalls == 1, "companion posts the fixed shortcut once")
    try expect(!runCompanionCommand(arguments: [
        "--companion-action", "apply-heading-numbering",
        "--result-file", resultURL.path,
        "--key", "A"
    ], environment: environment), "companion rejects injected arguments")
    try expect(environment.postCalls == 1, "rejected companion arguments send no extra key")
    return 15
}
