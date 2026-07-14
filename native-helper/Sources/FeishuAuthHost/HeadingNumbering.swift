import Foundation

package protocol HeadingNumbering: Sendable {
    func apply() throws
}

package enum HeadingNumberingError: String, Error, Equatable {
    case accessibilityNotGranted = "accessibility-not-granted"
    case unsupportedFrontApp = "unsupported-front-app"
    case webAreaMissing = "web-area-missing"
    case webAreaFocusFailed = "web-area-focus-failed"
    case nativeEventFailed = "native-event-failed"
}

package struct UnavailableHeadingNumberer: HeadingNumbering {
    package init() {}

    package func apply() throws {
        throw HeadingNumberingError.nativeEventFailed
    }
}
