import FeishuAuthHost
import Foundation
import Security

final class MemoryKeychainBackend: KeychainBackend {
    var values: [String: Data] = [:]
    var lastService = ""
    var lastAccount = ""

    func add(service: String, account: String, data: Data) -> OSStatus {
        record(service, account)
        guard values[account] == nil else { return errSecDuplicateItem }
        values[account] = data
        return errSecSuccess
    }

    func update(service: String, account: String, data: Data) -> OSStatus {
        record(service, account)
        guard values[account] != nil else { return errSecItemNotFound }
        values[account] = data
        return errSecSuccess
    }

    func read(service: String, account: String) throws -> Data {
        record(service, account)
        guard let value = values[account] else { throw KeychainSecretError.notFound }
        return value
    }

    func delete(service: String, account: String) -> OSStatus {
        record(service, account)
        guard values.removeValue(forKey: account) != nil else { return errSecItemNotFound }
        return errSecSuccess
    }

    private func record(_ service: String, _ account: String) {
        lastService = service
        lastAccount = account
    }
}

func runKeychainSecretTests() throws -> Int {
    let backend = MemoryKeychainBackend()
    let store = KeychainSecretStore(backend: backend)

    try store.set(appId: "cli_test1234", secret: "first-secret")
    try expect(try store.read(appId: "cli_test1234") == "first-secret", "read configured Keychain secret")
    try store.set(appId: "cli_test1234", secret: "updated-secret")
    try expect(try store.read(appId: "cli_test1234") == "updated-secret", "update duplicate Keychain secret")
    try expect(backend.lastService == "cn.zhenfund.jd-assistant.feishu", "fixed Keychain service")
    try expect(backend.lastAccount == "cli_test1234", "App ID is Keychain account")

    try store.delete(appId: "cli_test1234")
    try expectThrows("missing Keychain secret") {
        _ = try store.read(appId: "cli_test1234")
    }
    return 5
}
