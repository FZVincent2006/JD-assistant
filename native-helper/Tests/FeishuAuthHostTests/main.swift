import Darwin
import Foundation

do {
    let count = try runNativeMessageTests()
    print("Native helper tests passed: \(count)")
} catch {
    FileHandle.standardError.write(Data("Native helper tests failed: \(error)\n".utf8))
    exit(1)
}
