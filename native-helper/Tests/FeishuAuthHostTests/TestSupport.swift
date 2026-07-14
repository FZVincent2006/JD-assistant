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

func expectThrowsEqual<T: Error & Equatable>(
    _ expected: T,
    _ body: () throws -> Void
) throws {
    do {
        try body()
    } catch let actual as T {
        try expect(actual == expected, "expected \(expected), got \(actual)")
        return
    } catch {
        throw TestFailure.expectation("expected \(expected), got \(error)")
    }
    throw TestFailure.expectation("expected \(expected) to be thrown")
}
