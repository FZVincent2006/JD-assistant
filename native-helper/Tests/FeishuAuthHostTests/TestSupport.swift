import Foundation

enum TestFailure: Error, CustomStringConvertible {
    case expectation(String)

    var description: String {
        switch self {
        case .expectation(let name): return "Expectation failed: \(name)"
        }
    }
}

func expect(_ condition: @autoclosure () throws -> Bool, _ name: String) throws {
    guard try condition() else { throw TestFailure.expectation(name) }
}

func expectThrows(_ name: String, _ body: () throws -> Void) throws {
    do {
        try body()
    } catch {
        return
    }
    throw TestFailure.expectation(name)
}
