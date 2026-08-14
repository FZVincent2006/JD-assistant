import Foundation

package struct TenantTokenRequest: Codable, Equatable {
    package let type: String
    package let appId: String

    package init(type: String, appId: String) {
        self.type = type
        self.appId = appId
    }
}

package protocol TenantTokenProviding {
    func token(_ request: TenantTokenRequest) async throws -> TokenResult
}

package struct TenantTokenProvider: TenantTokenProviding {
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

    package func token(_ request: TenantTokenRequest) async throws -> TokenResult {
        guard request.type == "GET_TENANT_TOKEN", request.appId == allowedAppId else {
            throw TokenExchangeError(message: "Unexpected Feishu App ID")
        }
        let appSecret: String
        do {
            appSecret = try secretStore.read(appId: request.appId)
        } catch {
            throw TokenExchangeError(message: "Feishu App Secret is not configured")
        }

        var urlRequest = URLRequest(
            url: URL(string: "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal")!
        )
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = try JSONEncoder().encode(TenantTokenRequestBody(
            appId: request.appId,
            appSecret: appSecret
        ))

        let data: Data
        let response: HTTPURLResponse
        do {
            (data, response) = try await httpClient.send(urlRequest)
        } catch let error as TokenExchangeError {
            throw error
        } catch {
            throw TokenExchangeError(message: "Feishu tenant token request failed")
        }

        let payload = try? JSONDecoder().decode(TenantTokenResponseBody.self, from: data)
        let logId = response.value(forHTTPHeaderField: "x-tt-logid") ?? ""
        guard (200..<300).contains(response.statusCode), payload?.code ?? 0 == 0 else {
            throw TokenExchangeError(
                code: payload?.code ?? response.statusCode,
                status: response.statusCode,
                logId: logId,
                message: "Feishu tenant token request was rejected"
            )
        }
        guard let token = payload?.tenantAccessToken, !token.isEmpty,
              let expiresIn = payload?.expire, expiresIn > 0 else {
            throw TokenExchangeError(
                status: response.statusCode,
                logId: logId,
                message: "Feishu tenant token response is incomplete"
            )
        }
        return TokenResult(accessToken: token, expiresIn: expiresIn, scope: "")
    }
}

private struct TenantTokenRequestBody: Encodable {
    let appId: String
    let appSecret: String

    enum CodingKeys: String, CodingKey {
        case appId = "app_id"
        case appSecret = "app_secret"
    }
}

private struct TenantTokenResponseBody: Decodable {
    let code: Int?
    let tenantAccessToken: String?
    let expire: Int?

    enum CodingKeys: String, CodingKey {
        case code
        case tenantAccessToken = "tenant_access_token"
        case expire
    }
}
