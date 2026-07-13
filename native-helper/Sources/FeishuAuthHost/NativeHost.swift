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

    fileprivate static func success(_ result: TokenResult) -> Self {
        Self(
            ok: true,
            accessToken: result.accessToken,
            expiresIn: result.expiresIn,
            scope: result.scope,
            errorCode: nil,
            message: nil,
            logId: nil
        )
    }

    private static func failure(errorCode: Int = 0, message: String, logId: String = "") -> Self {
        Self(
            ok: false,
            accessToken: nil,
            expiresIn: nil,
            scope: nil,
            errorCode: errorCode,
            message: message,
            logId: logId.isEmpty ? nil : logId
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
        return .failure(message: "Native authorization request failed")
    }
}

package func handleNativeRequest(
    _ data: Data,
    exchanger: any TokenExchanging
) async -> NativeHostResponse {
    do {
        let request = try decodeExchangeRequest(data)
        return .success(try await exchanger.exchange(request))
    } catch {
        return .from(error)
    }
}

package func runNativeHost(
    input: InputStream,
    output: OutputStream,
    exchanger: any TokenExchanging = TokenExchange()
) async throws {
    guard let requestData = try NativeMessage.read(from: input) else { return }
    let response = await handleNativeRequest(requestData, exchanger: exchanger)
    let responseData = try JSONEncoder().encode(response)
    try NativeMessage.write(responseData, to: output)
}
