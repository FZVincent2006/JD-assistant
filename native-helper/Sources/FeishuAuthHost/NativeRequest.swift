import Foundation

package enum NativeHostRequest {
    case exchange(ExchangeCodeRequest)
    case applyHeadingNumbering
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
    case "APPLY_HEADING_NUMBERING":
        guard Set(object.keys) == Set(["type"]) else {
            throw TokenExchangeError(message: "Invalid native numbering request")
        }
        return .applyHeadingNumbering
    default:
        throw TokenExchangeError(message: "Unsupported native request type")
    }
}
