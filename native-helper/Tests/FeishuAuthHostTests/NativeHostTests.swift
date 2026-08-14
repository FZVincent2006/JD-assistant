import FeishuAuthHost
import Foundation

struct StubTokenExchanger: TokenExchanging {
    let result: TokenResult

    func exchange(_ request: ExchangeCodeRequest) async throws -> TokenResult {
        result
    }
}

struct StubTenantTokenProvider: TenantTokenProviding {
    let result: TokenResult

    func token(_ request: TenantTokenRequest) async throws -> TokenResult {
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

final class SpyDownloadedFileReader: DownloadedFileReading, @unchecked Sendable {
    var readCalls = 0
    var recentCalls = 0
    var deleteCalls = 0

    func read(_ request: DownloadedFileChunkRequest) throws -> DownloadedFileChunk {
        readCalls += 1
        return DownloadedFileChunk(base64: "JVBERi0=", fileSize: 5, eof: true)
    }

    func delete(_ request: DownloadedFileDeleteRequest) throws {
        deleteCalls += 1
    }

    func recent(_ request: DownloadedFileSearchRequest) throws -> [DownloadedFileInfo] {
        recentCalls += 1
        return [DownloadedFileInfo(
            path: "/Users/test/Downloads/Candidate.pdf",
            name: "Candidate.pdf",
            size: 505_856,
            modifiedAtMs: request.sinceMs + 1_000
        )]
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

    let tenantToken = await handleNativeRequest(
        Data(#"{"type":"GET_TENANT_TOKEN","appId":"cli_test1234"}"#.utf8),
        exchanger: StubTokenExchanger(result: TokenResult(accessToken: "unused", expiresIn: 1, scope: "")),
        tenantTokenProvider: StubTenantTokenProvider(result: TokenResult(
            accessToken: "tenant-token",
            expiresIn: 7_200,
            scope: ""
        ))
    )
    try expect(tenantToken.ok && tenantToken.accessToken == "tenant-token", "native host returns tenant token")

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

    let downloadedFileReader = SpyDownloadedFileReader()
    let fileChunk = await handleNativeRequest(
        Data(#"{"type":"READ_DOWNLOADED_FILE_CHUNK","path":"/Users/test/Downloads/Candidate.pdf","offset":0,"length":393216,"expectedName":"Candidate.pdf","expectedSize":505856}"#.utf8),
        exchanger: StubTokenExchanger(result: TokenResult(accessToken: "unused", expiresIn: 1, scope: "")),
        downloadedFileReader: downloadedFileReader
    )
    try expect(fileChunk.ok && fileChunk.fileChunkBase64 == "JVBERi0=", "native host returns a file chunk")
    try expect(downloadedFileReader.readCalls == 1, "native host routes the file chunk request")

    let recentFiles = await handleNativeRequest(
        Data(#"{"type":"LIST_RECENT_DOWNLOADED_FILES","sinceMs":1786592163246,"untilMs":1786593963246}"#.utf8),
        exchanger: StubTokenExchanger(result: TokenResult(accessToken: "unused", expiresIn: 1, scope: "")),
        downloadedFileReader: downloadedFileReader
    )
    try expect(
        recentFiles.ok && recentFiles.downloadedFiles?.first?.name == "Candidate.pdf",
        "native host returns recent validated downloads"
    )
    try expect(downloadedFileReader.recentCalls == 1, "native host routes recent download search")

    let cleanup = await handleNativeRequest(
        Data(#"{"type":"DELETE_DOWNLOADED_FILE","path":"/Users/test/Downloads/Candidate.pdf"}"#.utf8),
        exchanger: StubTokenExchanger(result: TokenResult(accessToken: "unused", expiresIn: 1, scope: "")),
        downloadedFileReader: downloadedFileReader
    )
    try expect(cleanup.ok && downloadedFileReader.deleteCalls == 1, "native host routes file cleanup")

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
    return 20
}
