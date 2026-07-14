import Darwin
import Foundation

@main
struct TestMain {
    static func main() async {
        do {
            var count = try runNativeMessageTests()
            count += try runKeychainSecretTests()
            count += try await runTokenExchangeTests()
            count += try await runNativeHostTests()
            count += try runHeadingNumberingTests()
            print("Native helper tests passed: \(count)")
        } catch {
            FileHandle.standardError.write(Data("Native helper tests failed: \(error)\n".utf8))
            exit(1)
        }
    }
}
