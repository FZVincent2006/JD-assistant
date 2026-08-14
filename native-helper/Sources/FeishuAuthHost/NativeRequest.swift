import Foundation

package enum NativeHostRequest {
    case exchange(ExchangeCodeRequest)
    case tenantToken(TenantTokenRequest)
    case applyHeadingNumbering
    case readDownloadedFileChunk(DownloadedFileChunkRequest)
    case listRecentDownloadedFiles(DownloadedFileSearchRequest)
    case deleteDownloadedFile(DownloadedFileDeleteRequest)
}

package func decodeNativeHostRequest(_ data: Data) throws -> NativeHostRequest {
    let object: [String: Any]
    do {
        guard let decoded = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw TokenExchangeError(message: "Invalid native request")
        }
        object = decoded
    } catch let error as TokenExchangeError {
        throw error
    } catch {
        throw TokenExchangeError(message: "Invalid native request")
    }

    guard let type = object["type"] as? String else {
        throw TokenExchangeError(message: "Invalid native request")
    }
    switch type {
    case "EXCHANGE_CODE":
        let allowed = Set(["type", "appId", "code", "redirectUri", "codeVerifier"])
        guard Set(object.keys) == allowed else {
            throw TokenExchangeError(message: "Invalid native request")
        }
        return .exchange(try decodeExchangeRequest(data))
    case "GET_TENANT_TOKEN":
        let allowed = Set(["type", "appId"])
        guard Set(object.keys) == allowed,
              let appId = object["appId"] as? String else {
            throw TokenExchangeError(message: "Invalid native request")
        }
        return .tenantToken(TenantTokenRequest(type: type, appId: appId))
    case "APPLY_HEADING_NUMBERING":
        guard Set(object.keys) == Set(["type"]) else {
            throw TokenExchangeError(message: "Invalid native numbering request")
        }
        return .applyHeadingNumbering
    case "READ_DOWNLOADED_FILE_CHUNK":
        let allowed = Set(["type", "path", "offset", "length", "expectedName", "expectedSize"])
        guard Set(object.keys) == allowed else {
            throw TokenExchangeError(message: "Invalid downloaded file request")
        }
        return .readDownloadedFileChunk(try JSONDecoder().decode(
            DownloadedFileChunkRequest.self,
            from: data
        ))
    case "LIST_RECENT_DOWNLOADED_FILES":
        guard Set(object.keys) == Set(["type", "sinceMs", "untilMs"]) else {
            throw TokenExchangeError(message: "Invalid downloaded file search request")
        }
        return .listRecentDownloadedFiles(try JSONDecoder().decode(
            DownloadedFileSearchRequest.self,
            from: data
        ))
    case "DELETE_DOWNLOADED_FILE":
        guard Set(object.keys) == Set(["type", "path"]) else {
            throw TokenExchangeError(message: "Invalid downloaded file cleanup request")
        }
        return .deleteDownloadedFile(try JSONDecoder().decode(
            DownloadedFileDeleteRequest.self,
            from: data
        ))
    default:
        throw TokenExchangeError(message: "Unsupported native request type")
    }
}
