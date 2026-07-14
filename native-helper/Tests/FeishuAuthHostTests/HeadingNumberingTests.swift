import FeishuAuthHost

final class SpyHeadingEnvironment: HeadingNumberingEnvironment, @unchecked Sendable {
    var trusted = true
    var bundleID: String? = "com.microsoft.edgemac"
    var focusError: HeadingNumberingError?
    var focusCalls = 0
    var postCalls = 0

    func hasPostEventAccess(prompt: Bool) -> Bool {
        trusted
    }

    func frontmostBundleIdentifier() -> String? {
        bundleID
    }

    func focusTestCopyWebArea() throws {
        focusCalls += 1
        if let focusError { throw focusError }
    }

    func postCommandShiftSeven() throws {
        postCalls += 1
    }
}

func runHeadingNumberingTests() throws -> Int {
    let denied = SpyHeadingEnvironment()
    denied.trusted = false
    try expectThrowsEqual(HeadingNumberingError.accessibilityNotGranted) {
        try MacHeadingNumberer(environment: denied).apply()
    }
    try expect(denied.focusCalls == 0, "denied permission never focuses a browser")
    try expect(denied.postCalls == 0, "denied permission sends no key")

    let wrongApp = SpyHeadingEnvironment()
    wrongApp.bundleID = "com.apple.Terminal"
    try expectThrowsEqual(HeadingNumberingError.unsupportedFrontApp) {
        try MacHeadingNumberer(environment: wrongApp).apply()
    }
    try expect(wrongApp.focusCalls == 0, "unsupported app is rejected before focus")
    try expect(wrongApp.postCalls == 0, "unsupported app receives no key")

    let focusFailure = SpyHeadingEnvironment()
    focusFailure.focusError = .webAreaMissing
    try expectThrowsEqual(HeadingNumberingError.webAreaMissing) {
        try MacHeadingNumberer(environment: focusFailure).apply()
    }
    try expect(focusFailure.focusCalls == 1, "web area focus is attempted once")
    try expect(focusFailure.postCalls == 0, "focus failure sends no key")

    let edge = SpyHeadingEnvironment()
    try MacHeadingNumberer(environment: edge).apply()
    try expect(edge.focusCalls == 1, "Edge web area is focused once")
    try expect(edge.postCalls == 1, "Edge receives one fixed shortcut")

    let chrome = SpyHeadingEnvironment()
    chrome.bundleID = "com.google.Chrome"
    try MacHeadingNumberer(environment: chrome).apply()
    try expect(chrome.focusCalls == 1, "Chrome web area is focused once")
    try expect(chrome.postCalls == 1, "Chrome receives one fixed shortcut")
    return 14
}
