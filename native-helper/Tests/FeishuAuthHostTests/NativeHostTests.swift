import FeishuAuthHost
import Foundation

struct StubTokenExchanger: TokenExchanging {
    let result: TokenResult

    func exchange(_ request: ExchangeCodeRequest) async throws -> TokenResult {
        result
    }
}

final class SpyHeadingNumberer: HeadingNumbering, @unchecked Sendable {
    var calls = 0
    var error: HeadingNumberingError?

    func apply() throws {
        calls += 1
        if let error { throw error }
    }
}

func runNativeHostTests() async throws -> Int {
    try expect(
        acceptsNativeHostLaunchArguments([]),
        "native host allows direct stdio launch"
    )
    try expect(
        acceptsNativeHostLaunchArguments([
            "chrome-extension://nnfieabngjmimnogokgbccekfpdifgdb/"
        ]),
        "native host accepts Chromium extension origin argument"
    )
    try expect(
        !acceptsNativeHostLaunchArguments(["https://example.com/"]),
        "native host rejects non-extension origins"
    )
    try expect(
        !acceptsNativeHostLaunchArguments([
            "chrome-extension://nnfieabngjmimnogokgbccekfpdifgdb/",
            "unexpected-extra-argument"
        ]),
        "native host rejects extra launch arguments"
    )

    let request = ExchangeCodeRequest(
        type: "EXCHANGE_CODE",
        appId: "cli_test1234",
        code: "one-time-code",
        redirectUri: "https://extension-id.chromiumapp.org/feishu",
        codeVerifier: String(repeating: "v", count: 64)
    )
    let input = try JSONEncoder().encode(request)
    let response = await handleNativeRequest(
        input,
        exchanger: StubTokenExchanger(result: TokenResult(
            accessToken: "short-lived-token",
            expiresIn: 3_600,
            scope: "wiki:wiki:readonly"
        ))
    )
    try expect(response.ok, "native host success response")
    try expect(response.accessToken == "short-lived-token", "native host returns short-lived token")

    let unsupported = Data(#"{"type":"WRITE_DOCUMENT"}"#.utf8)
    let rejected = await handleNativeRequest(
        unsupported,
        exchanger: StubTokenExchanger(result: TokenResult(accessToken: "unused", expiresIn: 1, scope: ""))
    )
    try expect(!rejected.ok, "native host rejects non-exchange request")
    let rejectedJSON = String(decoding: try JSONEncoder().encode(rejected), as: UTF8.self)
    try expect(!rejectedJSON.contains("WRITE_DOCUMENT"), "native error does not echo request body")

    let numberer = SpyHeadingNumberer()
    let numbering = await handleNativeRequest(
        Data(#"{"type":"APPLY_HEADING_NUMBERING"}"#.utf8),
        exchanger: StubTokenExchanger(result: TokenResult(accessToken: "unused", expiresIn: 1, scope: "")),
        headingNumberer: numberer
    )
    try expect(numbering.ok, "native host accepts the fixed heading request")
    try expect(numberer.calls == 1, "native host routes the fixed heading request once")

    let injected = await handleNativeRequest(
        Data(#"{"type":"APPLY_HEADING_NUMBERING","key":"A"}"#.utf8),
        exchanger: StubTokenExchanger(result: TokenResult(accessToken: "unused", expiresIn: 1, scope: "")),
        headingNumberer: numberer
    )
    try expect(!injected.ok, "native host rejects executable numbering fields")
    try expect(numberer.calls == 1, "rejected numbering fields never reach the numberer")

    let exchangeWithExtraField = try JSONSerialization.data(withJSONObject: [
        "type": "EXCHANGE_CODE",
        "appId": "cli_test1234",
        "code": "one-time-code",
        "redirectUri": "https://extension-id.chromiumapp.org/feishu",
        "codeVerifier": String(repeating: "v", count: 64),
        "key": "A"
    ])
    let rejectedExchange = await handleNativeRequest(
        exchangeWithExtraField,
        exchanger: StubTokenExchanger(result: TokenResult(accessToken: "unused", expiresIn: 1, scope: "")),
        headingNumberer: numberer
    )
    try expect(!rejectedExchange.ok, "native host rejects extra exchange fields")
    return 13
}
