import Darwin
import FeishuAuthHost
import Foundation

@main
struct FeishuAuthHostMain {
    static func main() async {
        let arguments = Array(CommandLine.arguments.dropFirst())
        if arguments.first == "--configure-secret" {
            guard
                arguments.count == 3,
                arguments[1] == "--app-id",
                arguments[2] == allowedFeishuAppId
            else {
                exit(2)
            }
            do {
                let secret = try readSecretWithoutEcho()
                try KeychainSecretStore().set(appId: arguments[2], secret: secret)
            } catch {
                exit(1)
            }
            return
        }

        if arguments.first == "--delete-secret" {
            guard
                arguments.count == 3,
                arguments[1] == "--app-id",
                arguments[2] == allowedFeishuAppId
            else {
                exit(2)
            }
            do {
                try KeychainSecretStore().delete(appId: arguments[2])
            } catch {
                exit(1)
            }
            return
        }

        guard arguments.isEmpty else { exit(2) }
        guard
            let input = InputStream(fileAtPath: "/dev/stdin"),
            let output = OutputStream(toFileAtPath: "/dev/stdout", append: false)
        else {
            exit(1)
        }
        do {
            try await runNativeHost(input: input, output: output)
        } catch {
            exit(1)
        }
    }

    private static func readSecretWithoutEcho() throws -> String {
        let interactive = isatty(STDIN_FILENO) == 1
        var original = termios()
        if interactive {
            guard tcgetattr(STDIN_FILENO, &original) == 0 else {
                throw KeychainSecretError.invalidSecret
            }
            var hidden = original
            hidden.c_lflag &= ~tcflag_t(ECHO)
            guard tcsetattr(STDIN_FILENO, TCSAFLUSH, &hidden) == 0 else {
                throw KeychainSecretError.invalidSecret
            }
        }
        defer {
            if interactive {
                var restored = original
                _ = tcsetattr(STDIN_FILENO, TCSAFLUSH, &restored)
            }
        }
        guard let value = readLine(strippingNewline: true), !value.isEmpty else {
            throw KeychainSecretError.invalidSecret
        }
        return value
    }
}
