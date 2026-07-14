import Foundation

package enum CompanionAction: String, Codable, Equatable {
    case applyHeadingNumbering = "apply-heading-numbering"
    case checkAccessibility = "check-accessibility"
    case requestAccessibility = "request-accessibility"
}

package struct CompanionResponse: Codable, Equatable {
    package let ok: Bool
    package let reason: String?

    package init(ok: Bool, reason: String?) {
        self.ok = ok
        self.reason = reason
    }
}

package enum CompanionBridgeError: Error, Equatable {
    case bundleMissing
    case launchFailed
    case timedOut
    case invalidResponse
}

package protocol CompanionRunning: Sendable {
    func run(_ action: CompanionAction) throws -> CompanionResponse
}

package struct CompanionHeadingNumberer: HeadingNumbering {
    private let runner: any CompanionRunning

    package init(runner: any CompanionRunning = LaunchServicesCompanionRunner()) {
        self.runner = runner
    }

    package func apply() throws {
        let response = try runner.run(.applyHeadingNumbering)
        guard response.ok else {
            if let reason = response.reason,
               let error = HeadingNumberingError(rawValue: reason) {
                throw error
            }
            throw CompanionBridgeError.invalidResponse
        }
    }
}

package struct CompanionAccessibility {
    private let runner: any CompanionRunning

    package init(runner: any CompanionRunning = LaunchServicesCompanionRunner()) {
        self.runner = runner
    }

    package func check(prompt: Bool) -> Bool {
        let action: CompanionAction = prompt ? .requestAccessibility : .checkAccessibility
        return (try? runner.run(action).ok) == true
    }
}

package struct LaunchServicesCompanionRunner: CompanionRunning {
    private let executableURL: URL
    private let timeout: TimeInterval

    package init(
        executableURL: URL = URL(fileURLWithPath: CommandLine.arguments[0]),
        timeout: TimeInterval = 8
    ) {
        self.executableURL = executableURL.standardizedFileURL
        self.timeout = timeout
    }

    package func run(_ action: CompanionAction) throws -> CompanionResponse {
        guard let bundleURL = companionBundleURL(for: executableURL) else {
            throw CompanionBridgeError.bundleMissing
        }
        let resultURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("zhenfund-feishu-companion-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: resultURL) }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        process.arguments = [
            "-g", "-W", "-n", bundleURL.path,
            "--args", "--companion-action", action.rawValue,
            "--result-file", resultURL.path
        ]
        do {
            try process.run()
        } catch {
            throw CompanionBridgeError.launchFailed
        }

        let deadline = Date().addingTimeInterval(timeout)
        while process.isRunning && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.05)
        }
        if process.isRunning {
            process.terminate()
            throw CompanionBridgeError.timedOut
        }
        guard process.terminationStatus == 0,
              let data = try? Data(contentsOf: resultURL),
              let response = try? JSONDecoder().decode(CompanionResponse.self, from: data) else {
            throw CompanionBridgeError.invalidResponse
        }
        return response
    }
}

package func companionBundleURL(for executableURL: URL) -> URL? {
    let macOS = executableURL.standardizedFileURL.deletingLastPathComponent()
    let contents = macOS.deletingLastPathComponent()
    let bundle = contents.deletingLastPathComponent()
    guard macOS.lastPathComponent == "MacOS",
          contents.lastPathComponent == "Contents",
          bundle.pathExtension == "app" else {
        return nil
    }
    return bundle
}

package func runCompanionCommand(
    arguments: [String],
    environment: any HeadingNumberingEnvironment = MacHeadingEnvironment()
) -> Bool {
    guard arguments.count == 4,
          arguments[0] == "--companion-action",
          let action = CompanionAction(rawValue: arguments[1]),
          arguments[2] == "--result-file" else {
        return false
    }
    let resultURL = URL(fileURLWithPath: arguments[3]).standardizedFileURL
    guard validCompanionResultURL(resultURL) else { return false }

    let response: CompanionResponse
    switch action {
    case .applyHeadingNumbering:
        do {
            try MacHeadingNumberer(environment: environment).apply()
            response = CompanionResponse(ok: true, reason: nil)
        } catch let error as HeadingNumberingError {
            response = CompanionResponse(ok: false, reason: error.rawValue)
        } catch {
            response = CompanionResponse(ok: false, reason: nil)
        }
    case .checkAccessibility:
        let allowed = environment.hasPostEventAccess(prompt: false)
        response = CompanionResponse(
            ok: allowed,
            reason: allowed ? nil : HeadingNumberingError.accessibilityNotGranted.rawValue
        )
    case .requestAccessibility:
        let allowed = environment.hasPostEventAccess(prompt: true)
        response = CompanionResponse(
            ok: allowed,
            reason: allowed ? nil : HeadingNumberingError.accessibilityNotGranted.rawValue
        )
    }

    do {
        try JSONEncoder().encode(response).write(to: resultURL, options: .atomic)
        return true
    } catch {
        return false
    }
}

private func validCompanionResultURL(_ url: URL) -> Bool {
    let temporary = FileManager.default.temporaryDirectory.standardizedFileURL
    return url.deletingLastPathComponent() == temporary
        && url.lastPathComponent.hasPrefix("zhenfund-feishu-companion-")
        && url.pathExtension == "json"
}
