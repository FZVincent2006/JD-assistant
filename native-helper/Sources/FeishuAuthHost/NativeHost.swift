import Foundation

package func acceptsNativeHostLaunchArguments(_ arguments: [String]) -> Bool {
    if arguments.isEmpty { return true }
    guard arguments.count == 1 else { return false }
    return arguments[0].range(
        of: #"^chrome-extension://[a-p]{32}/$"#,
        options: .regularExpression
    ) != nil
}

package struct NativeHostResponse: Codable, Equatable {
    package let ok: Bool
    package let accessToken: String?
    package let expiresIn: Int?
    package let scope: String?
    package let errorCode: Int?
    package let message: String?
    package let logId: String?
    package let reason: String?
    package let fileChunkBase64: String?
    package let fileSize: Int?
    package let eof: Bool?
    package let downloadedFiles: [DownloadedFileInfo]?

    fileprivate static func success(_ result: TokenResult) -> Self {
        Self(
            ok: true,
            accessToken: result.accessToken,
            expiresIn: result.expiresIn,
            scope: result.scope,
            errorCode: nil,
            message: nil,
            logId: nil,
            reason: nil,
            fileChunkBase64: nil,
            fileSize: nil,
            eof: nil,
            downloadedFiles: nil
        )
    }

    fileprivate static func numberingSuccess() -> Self {
        Self(
            ok: true,
            accessToken: nil,
            expiresIn: nil,
            scope: nil,
            errorCode: nil,
            message: nil,
            logId: nil,
            reason: nil,
            fileChunkBase64: nil,
            fileSize: nil,
            eof: nil,
            downloadedFiles: nil
        )
    }

    fileprivate static func fileChunk(_ chunk: DownloadedFileChunk) -> Self {
        Self(
            ok: true, accessToken: nil, expiresIn: nil, scope: nil,
            errorCode: nil, message: nil, logId: nil, reason: nil,
            fileChunkBase64: chunk.base64, fileSize: chunk.fileSize, eof: chunk.eof,
            downloadedFiles: nil
        )
    }

    fileprivate static func downloadedFiles(_ files: [DownloadedFileInfo]) -> Self {
        Self(
            ok: true, accessToken: nil, expiresIn: nil, scope: nil,
            errorCode: nil, message: nil, logId: nil, reason: nil,
            fileChunkBase64: nil, fileSize: nil, eof: nil,
            downloadedFiles: files
        )
    }

    private static func failure(
        errorCode: Int = 0,
        message: String,
        logId: String = "",
        reason: String? = nil
    ) -> Self {
        Self(
            ok: false,
            accessToken: nil,
            expiresIn: nil,
            scope: nil,
            errorCode: errorCode,
            message: message,
            logId: logId.isEmpty ? nil : logId,
            reason: reason,
            fileChunkBase64: nil,
            fileSize: nil,
            eof: nil,
            downloadedFiles: nil
        )
    }

    fileprivate static func from(_ error: Error) -> Self {
        if let exchangeError = error as? TokenExchangeError {
            return .failure(
                errorCode: exchangeError.code,
                message: exchangeError.message,
                logId: exchangeError.logId
            )
        }
        if error is KeychainSecretError {
            return .failure(message: "Feishu App Secret is not configured")
        }
        if let numberingError = error as? HeadingNumberingError {
            return .failure(
                message: numberingError.rawValue,
                reason: numberingError.rawValue
            )
        }
        return .failure(message: "Native authorization request failed")
    }
}

package func handleNativeRequest(
    _ data: Data,
    exchanger: any TokenExchanging,
    tenantTokenProvider: any TenantTokenProviding = TenantTokenProvider(),
    headingNumberer: any HeadingNumbering = UnavailableHeadingNumberer(),
    downloadedFileReader: any DownloadedFileReading = DownloadedFileReader()
) async -> NativeHostResponse {
    do {
        switch try decodeNativeHostRequest(data) {
        case .exchange(let request):
            return .success(try await exchanger.exchange(request))
        case .tenantToken(let request):
            return .success(try await tenantTokenProvider.token(request))
        case .applyHeadingNumbering:
            try headingNumberer.apply()
            return .numberingSuccess()
        case .readDownloadedFileChunk(let request):
            return .fileChunk(try downloadedFileReader.read(request))
        case .listRecentDownloadedFiles(let request):
            return .downloadedFiles(try downloadedFileReader.recent(request))
        case .deleteDownloadedFile(let request):
            try downloadedFileReader.delete(request)
            return .numberingSuccess()
        }
    } catch {
        return .from(error)
    }
}

package func runNativeHost(
    input: InputStream,
    output: OutputStream,
    exchanger: any TokenExchanging = TokenExchange(),
    tenantTokenProvider: any TenantTokenProviding = TenantTokenProvider(),
    headingNumberer: any HeadingNumbering = UnavailableHeadingNumberer(),
    downloadedFileReader: any DownloadedFileReading = DownloadedFileReader()
) async throws {
    guard let requestData = try NativeMessage.read(from: input) else { return }
    let response = await handleNativeRequest(
        requestData,
        exchanger: exchanger,
        tenantTokenProvider: tenantTokenProvider,
        headingNumberer: headingNumberer,
        downloadedFileReader: downloadedFileReader
    )
    let responseData = try JSONEncoder().encode(response)
    try NativeMessage.write(responseData, to: output)
}

package func runNativeHost(
    input: FileHandle,
    output: FileHandle,
    exchanger: any TokenExchanging = TokenExchange(),
    tenantTokenProvider: any TenantTokenProviding = TenantTokenProvider(),
    headingNumberer: any HeadingNumbering = UnavailableHeadingNumberer(),
    downloadedFileReader: any DownloadedFileReading = DownloadedFileReader()
) async throws {
    guard let requestData = try NativeMessage.read(from: input) else { return }
    let response = await handleNativeRequest(
        requestData,
        exchanger: exchanger,
        tenantTokenProvider: tenantTokenProvider,
        headingNumberer: headingNumberer,
        downloadedFileReader: downloadedFileReader
    )
    let responseData = try JSONEncoder().encode(response)
    try NativeMessage.write(responseData, to: output)
}
