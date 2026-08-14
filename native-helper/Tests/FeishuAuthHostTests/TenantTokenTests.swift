import FeishuAuthHost
import Foundation

func runTenantTokenTests() async throws -> Int {
    let backend = MemoryKeychainBackend()
    let store = KeychainSecretStore(backend: backend)
    try store.set(appId: "cli_test1234", secret: "stored-secret")
    let http = RecordingTokenHTTPClient()
    http.responseData = Data(#"{"code":0,"tenant_access_token":"tenant-token","expire":7200}"#.utf8)
    let provider = TenantTokenProvider(
        secretStore: store,
        httpClient: http,
        allowedAppId: "cli_test1234"
    )

    let result = try await provider.token(TenantTokenRequest(
        type: "GET_TENANT_TOKEN",
        appId: "cli_test1234"
    ))
    let body = try JSONSerialization.jsonObject(with: http.capturedRequest!.httpBody!) as! [String: Any]
    try expect(body["app_secret"] as? String == "stored-secret", "tenant request adds Keychain secret")
    try expect(result.accessToken == "tenant-token" && result.expiresIn == 7_200, "decode tenant token")
    let encoded = String(decoding: try JSONEncoder().encode(result), as: UTF8.self)
    try expect(!encoded.contains("stored-secret"), "tenant result excludes App Secret")
    return 3
}
