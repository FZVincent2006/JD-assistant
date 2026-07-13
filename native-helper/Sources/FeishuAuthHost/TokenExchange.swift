import Foundation

package let allowedFeishuAppId = "cli_aade4224b8789bef"

package struct ExchangeCodeRequest: Codable, Equatable {
    package let type: String
    package let appId: String
    package let code: String
    package let redirectUri: String
    package let codeVerifier: String

    package init(type: String, appId: String, code: String, redirectUri: String, codeVerifier: String) {
        self.type = type
        self.appId = appId
        self.code = code
        self.redirectUri = redirectUri
        self.codeVerifier = codeVerifier
    }
}

package struct TokenResult: Codable, Equatable {
    package let accessToken: String
    package let expiresIn: Int
    package let scope: String

    package init(accessToken: String, expiresIn: Int, scope: String) {
        self.accessToken = accessToken
        self.expiresIn = expiresIn
        self.scope = scope
    }
}

package struct TokenExchangeError: Error, Equatable, CustomStringConvertible {
    package let code: Int
    package let status: Int
    package let logId: String
    package let message: String

    package init(code: Int = 0, status: Int = 0, logId: String = "", message: String) {
        self.code = code
        self.status = status
        self.logId = logId
        self.message = message
    }

    package var description: String { message }
}

package protocol TokenHTTPClient: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

package protocol TokenExchanging {
    func exchange(_ request: ExchangeCodeRequest) async throws -> TokenResult
}

package struct URLSessionTokenHTTPClient: TokenHTTPClient {
    package init() {}

    package func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw TokenExchangeError(message: "Feishu token response was not HTTP")
        }
        return (data, http)
    }
}

package func decodeExchangeRequest(_ data: Data) throws -> ExchangeCodeRequest {
    let request: ExchangeCodeRequest
    do {
        request = try JSONDecoder().decode(ExchangeCodeRequest.self, from: data)
    } catch {
        throw TokenExchangeError(message: "Invalid native request")
    }
    guard request.type == "EXCHANGE_CODE" else {
        throw TokenExchangeError(message: "Unsupported native request type")
    }
    return request
}

package struct TokenExchange: TokenExchanging {
    private let secretStore: KeychainSecretStore
    private let httpClient: any TokenHTTPClient
    private let allowedAppId: String

    package init(
        secretStore: KeychainSecretStore = KeychainSecretStore(),
        httpClient: any TokenHTTPClient = URLSessionTokenHTTPClient(),
        allowedAppId: String = allowedFeishuAppId
    ) {
        self.secretStore = secretStore
        self.httpClient = httpClient
        self.allowedAppId = allowedAppId
    }

    package func exchange(_ request: ExchangeCodeRequest) async throws -> TokenResult {
        try validate(request)
        let appSecret: String
        do {
            appSecret = try secretStore.read(appId: request.appId)
        } catch {
            throw TokenExchangeError(message: "Feishu App Secret is not configured")
        }

        var urlRequest = URLRequest(url: URL(string: "https://open.feishu.cn/open-apis/authen/v2/oauth/token")!)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = try JSONEncoder().encode(TokenRequestBody(
            grantType: "authorization_code",
            clientId: request.appId,
            clientSecret: appSecret,
            code: request.code,
            codeVerifier: request.codeVerifier,
            redirectUri: request.redirectUri
        ))

        let data: Data
        let response: HTTPURLResponse
        do {
            (data, response) = try await httpClient.send(urlRequest)
        } catch let error as TokenExchangeError {
            throw error
        } catch {
            throw TokenExchangeError(message: "Feishu token request failed")
        }

        let payload = try? JSONDecoder().decode(TokenResponseBody.self, from: data)
        let logId = response.value(forHTTPHeaderField: "x-tt-logid") ?? ""
        guard (200..<300).contains(response.statusCode), payload?.code ?? 0 == 0 else {
            throw TokenExchangeError(
                code: payload?.code ?? response.statusCode,
                status: response.statusCode,
                logId: logId,
                message: "Feishu token exchange was rejected"
            )
        }
        guard
            let accessToken = payload?.accessToken,
            !accessToken.isEmpty,
            let expiresIn = payload?.expiresIn,
            expiresIn > 0
        else {
            throw TokenExchangeError(
                status: response.statusCode,
                logId: logId,
                message: "Feishu token response is incomplete"
            )
        }
        return TokenResult(accessToken: accessToken, expiresIn: expiresIn, scope: payload?.scope ?? "")
    }

    private func validate(_ request: ExchangeCodeRequest) throws {
        guard request.type == "EXCHANGE_CODE" else {
            throw TokenExchangeError(message: "Unsupported native request type")
        }
        guard request.appId == allowedAppId else {
            throw TokenExchangeError(message: "Unexpected Feishu App ID")
        }
        guard !request.code.isEmpty, request.code.utf8.count <= 4_096 else {
            throw TokenExchangeError(message: "Invalid authorization code")
        }
        guard
            (43...128).contains(request.codeVerifier.utf8.count),
            request.codeVerifier.range(of: #"^[A-Za-z0-9._~-]+$"#, options: .regularExpression) != nil
        else {
            throw TokenExchangeError(message: "Invalid PKCE verifier")
        }
        guard
            let redirect = URL(string: request.redirectUri),
            redirect.scheme?.lowercased() == "https",
            redirect.host?.lowercased().hasSuffix(".chromiumapp.org") == true,
            redirect.user == nil,
            redirect.password == nil,
            redirect.fragment == nil
        else {
            throw TokenExchangeError(message: "Invalid OAuth redirect URI")
        }
    }
}

private struct TokenRequestBody: Encodable {
    let grantType: String
    let clientId: String
    let clientSecret: String
    let code: String
    let codeVerifier: String
    let redirectUri: String

    enum CodingKeys: String, CodingKey {
        case grantType = "grant_type"
        case clientId = "client_id"
        case clientSecret = "client_secret"
        case code
        case codeVerifier = "code_verifier"
        case redirectUri = "redirect_uri"
    }
}

private struct TokenResponseBody: Decodable {
    let code: Int?
    let accessToken: String?
    let expiresIn: Int?
    let scope: String?

    enum CodingKeys: String, CodingKey {
        case code
        case accessToken = "access_token"
        case expiresIn = "expires_in"
        case scope
    }
}
