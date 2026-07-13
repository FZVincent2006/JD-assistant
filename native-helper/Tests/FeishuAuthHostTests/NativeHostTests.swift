import FeishuAuthHost
import Foundation

struct StubTokenExchanger: TokenExchanging {
    let result: TokenResult

    func exchange(_ request: ExchangeCodeRequest) async throws -> TokenResult {
        result
    }
}

func runNativeHostTests() async throws -> Int {
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
    return 4
}
