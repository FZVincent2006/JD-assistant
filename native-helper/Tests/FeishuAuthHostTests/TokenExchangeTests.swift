import FeishuAuthHost
import Foundation

final class RecordingTokenHTTPClient: TokenHTTPClient, @unchecked Sendable {
    var responseStatus = 200
    var responseHeaders: [String: String] = [:]
    var responseData = Data(#"{"access_token":"short-lived-token","expires_in":7200,"scope":"wiki:wiki:readonly"}"#.utf8)
    var capturedRequest: URLRequest?
    var callCount = 0

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        callCount += 1
        capturedRequest = request
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: responseStatus,
            httpVersion: "HTTP/1.1",
            headerFields: responseHeaders
        )!
        return (responseData, response)
    }
}

func runTokenExchangeTests() async throws -> Int {
    let backend = MemoryKeychainBackend()
    let store = KeychainSecretStore(backend: backend)
    try store.set(appId: "cli_test1234", secret: "stored-secret")
    let http = RecordingTokenHTTPClient()
    let exchange = TokenExchange(secretStore: store, httpClient: http, allowedAppId: "cli_test1234")
    let request = ExchangeCodeRequest(
        type: "EXCHANGE_CODE",
        appId: "cli_test1234",
        code: "one-time-code",
        redirectUri: "https://extension-id.chromiumapp.org/feishu",
        codeVerifier: String(repeating: "v", count: 64)
    )

    let result = try await exchange.exchange(request)
    let capturedBody = try JSONSerialization.jsonObject(with: http.capturedRequest!.httpBody!) as! [String: Any]
    try expect(capturedBody["client_secret"] as? String == "stored-secret", "exchange adds Keychain secret")
    try expect(capturedBody["code_verifier"] as? String == request.codeVerifier, "exchange keeps PKCE verifier")
    let encodedResult = String(decoding: try JSONEncoder().encode(result), as: UTF8.self)
    try expect(!encodedResult.contains("stored-secret"), "exchange result excludes App Secret")
    try expect(result.accessToken == "short-lived-token" && result.expiresIn == 7_200, "decode short-lived token")

    let badType = Data(#"{"type":"WRITE_DOCUMENT","appId":"cli_test1234","code":"x","redirectUri":"https://id.chromiumapp.org/feishu","codeVerifier":"yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"}"#.utf8)
    try expectThrows("reject unexpected native message type") {
        _ = try decodeExchangeRequest(badType)
    }

    let badRedirect = ExchangeCodeRequest(
        type: "EXCHANGE_CODE",
        appId: "cli_test1234",
        code: "code",
        redirectUri: "https://example.com/callback",
        codeVerifier: String(repeating: "z", count: 64)
    )
    try await expectAsyncThrows("reject non-extension redirect") {
        _ = try await exchange.exchange(badRedirect)
    }
    try expect(http.callCount == 1, "invalid redirect does not call Feishu")

    http.responseStatus = 400
    http.responseHeaders = ["x-tt-logid": "log-safe"]
    http.responseData = Data(#"{"code":20140,"error":"invalid_client","error_description":"secret-body-sentinel"}"#.utf8)
    do {
        _ = try await exchange.exchange(request)
        throw TestFailure.expectation("HTTP error must fail")
    } catch let error as TokenExchangeError {
        try expect(error.code == 20_140, "preserve Feishu error code")
        try expect(error.logId == "log-safe", "preserve Feishu log ID")
        try expect(!error.description.contains("secret-body-sentinel"), "redact response body")
    }
    return 10
}

private func expectAsyncThrows(
    _ name: String,
    _ body: () async throws -> Void
) async throws {
    do {
        try await body()
    } catch {
        return
    }
    throw TestFailure.expectation(name)
}
