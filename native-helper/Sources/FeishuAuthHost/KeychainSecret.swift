import Foundation
import Security

package enum KeychainSecretError: Error, Equatable, CustomStringConvertible {
    case invalidAppId
    case invalidSecret
    case notFound
    case invalidData
    case keychain(OSStatus)

    package var description: String {
        switch self {
        case .invalidAppId: return "Invalid App ID"
        case .invalidSecret: return "Invalid App Secret"
        case .notFound: return "App Secret is not configured"
        case .invalidData: return "Stored App Secret is invalid"
        case .keychain(let status): return "Keychain operation failed (\(status))"
        }
    }
}

package protocol KeychainBackend {
    func add(service: String, account: String, data: Data) -> OSStatus
    func update(service: String, account: String, data: Data) -> OSStatus
    func read(service: String, account: String) throws -> Data
    func delete(service: String, account: String) -> OSStatus
}

package struct SecurityKeychainBackend: KeychainBackend {
    package init() {}

    package func add(service: String, account: String, data: Data) -> OSStatus {
        SecItemAdd([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: data
        ] as CFDictionary, nil)
    }

    package func update(service: String, account: String, data: Data) -> OSStatus {
        SecItemUpdate([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ] as CFDictionary, [
            kSecValueData as String: data
        ] as CFDictionary)
    }

    package func read(service: String, account: String) throws -> Data {
        var result: CFTypeRef?
        let status = SecItemCopyMatching([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ] as CFDictionary, &result)
        if status == errSecItemNotFound { throw KeychainSecretError.notFound }
        guard status == errSecSuccess else { throw KeychainSecretError.keychain(status) }
        guard let data = result as? Data else { throw KeychainSecretError.invalidData }
        return data
    }

    package func delete(service: String, account: String) -> OSStatus {
        SecItemDelete([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ] as CFDictionary)
    }
}

package final class KeychainSecretStore {
    package static let service = "cn.zhenfund.jd-assistant.feishu"
    private let backend: any KeychainBackend

    package init(backend: any KeychainBackend = SecurityKeychainBackend()) {
        self.backend = backend
    }

    package func set(appId: String, secret: String) throws {
        let account = try validatedAppId(appId)
        guard !secret.isEmpty, secret.utf8.count <= 4_096 else {
            throw KeychainSecretError.invalidSecret
        }
        let data = Data(secret.utf8)
        let status = backend.add(service: Self.service, account: account, data: data)
        if status == errSecDuplicateItem {
            let updateStatus = backend.update(service: Self.service, account: account, data: data)
            guard updateStatus == errSecSuccess else { throw KeychainSecretError.keychain(updateStatus) }
            return
        }
        guard status == errSecSuccess else { throw KeychainSecretError.keychain(status) }
    }

    package func read(appId: String) throws -> String {
        let account = try validatedAppId(appId)
        let data = try backend.read(service: Self.service, account: account)
        guard let value = String(data: data, encoding: .utf8), !value.isEmpty else {
            throw KeychainSecretError.invalidData
        }
        return value
    }

    package func delete(appId: String) throws {
        let account = try validatedAppId(appId)
        let status = backend.delete(service: Self.service, account: account)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainSecretError.keychain(status)
        }
    }

    private func validatedAppId(_ value: String) throws -> String {
        guard value.range(of: #"^cli_[A-Za-z0-9]{8,64}$"#, options: .regularExpression) != nil else {
            throw KeychainSecretError.invalidAppId
        }
        return value
    }
}
