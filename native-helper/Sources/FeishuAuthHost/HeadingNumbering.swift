import AppKit
import ApplicationServices
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

package protocol HeadingNumberingEnvironment: Sendable {
    func hasPostEventAccess(prompt: Bool) -> Bool
    func frontmostBundleIdentifier() -> String?
    func focusTestCopyWebArea() throws
    func postCommandShiftSeven() throws
}

package struct MacHeadingNumberer: HeadingNumbering {
    private let environment: any HeadingNumberingEnvironment

    package init(environment: any HeadingNumberingEnvironment = MacHeadingEnvironment()) {
        self.environment = environment
    }

    package func apply() throws {
        guard environment.hasPostEventAccess(prompt: true) else {
            throw HeadingNumberingError.accessibilityNotGranted
        }
        guard ["com.google.Chrome", "com.microsoft.edgemac"]
            .contains(environment.frontmostBundleIdentifier()) else {
            throw HeadingNumberingError.unsupportedFrontApp
        }
        try environment.focusTestCopyWebArea()
        try environment.postCommandShiftSeven()
    }
}

package struct MacHeadingEnvironment: HeadingNumberingEnvironment {
    private static let webAreaRole = "AXWebArea"
    private static let allowedScheme = "https"
    private static let allowedHost = "zhenfund.feishu.cn"
    private static let allowedPath = "/wiki/LlhrwSLIvilANZk1opwcQGlUnNv"
    private static let maximumElements = 2_000

    package init() {}

    package func hasPostEventAccess(prompt: Bool) -> Bool {
        if CGPreflightPostEventAccess() { return true }
        return prompt ? CGRequestPostEventAccess() : false
    }

    package func frontmostBundleIdentifier() -> String? {
        NSWorkspace.shared.frontmostApplication?.bundleIdentifier
    }

    package func focusTestCopyWebArea() throws {
        guard let application = NSWorkspace.shared.frontmostApplication else {
            throw HeadingNumberingError.unsupportedFrontApp
        }
        let appElement = AXUIElementCreateApplication(application.processIdentifier)
        guard let window = copyElementAttribute(appElement, kAXFocusedWindowAttribute as CFString) else {
            throw HeadingNumberingError.webAreaMissing
        }
        let candidates = descendants(of: window, limit: Self.maximumElements).filter { element in
            role(of: element) == Self.webAreaRole
                && isTestCopyURL(url(of: element))
        }
        guard candidates.count == 1, let webArea = candidates.first else {
            throw HeadingNumberingError.webAreaMissing
        }

        _ = AXUIElementPerformAction(window, kAXRaiseAction as CFString)
        let directResult = AXUIElementSetAttributeValue(
            webArea,
            kAXFocusedAttribute as CFString,
            kCFBooleanTrue
        )
        let appResult = AXUIElementSetAttributeValue(
            appElement,
            kAXFocusedUIElementAttribute as CFString,
            webArea
        )
        guard directResult == .success || appResult == .success else {
            throw HeadingNumberingError.webAreaFocusFailed
        }
        guard let focused = copyElementAttribute(appElement, kAXFocusedUIElementAttribute as CFString),
              sameElement(focused, webArea) || contains(webArea, descendant: focused) else {
            throw HeadingNumberingError.webAreaFocusFailed
        }
        Thread.sleep(forTimeInterval: 0.08)
    }

    package func postCommandShiftSeven() throws {
        let source = CGEventSource(stateID: .hidSystemState)
        guard
            let keyDown = CGEvent(keyboardEventSource: source, virtualKey: 26, keyDown: true),
            let keyUp = CGEvent(keyboardEventSource: source, virtualKey: 26, keyDown: false)
        else {
            throw HeadingNumberingError.nativeEventFailed
        }
        let flags: CGEventFlags = [.maskCommand, .maskShift]
        keyDown.flags = flags
        keyUp.flags = flags
        keyDown.post(tap: .cghidEventTap)
        keyUp.post(tap: .cghidEventTap)
    }

    private func isTestCopyURL(_ value: URL?) -> Bool {
        value?.scheme?.lowercased() == Self.allowedScheme
            && value?.host?.lowercased() == Self.allowedHost
            && value?.path == Self.allowedPath
    }
}

private func copyAttribute(_ element: AXUIElement, _ attribute: CFString) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute, &value) == .success else {
        return nil
    }
    return value
}

private func copyElementAttribute(_ element: AXUIElement, _ attribute: CFString) -> AXUIElement? {
    guard let value = copyAttribute(element, attribute), CFGetTypeID(value) == AXUIElementGetTypeID() else {
        return nil
    }
    return unsafeDowncast(value, to: AXUIElement.self)
}

private func role(of element: AXUIElement) -> String? {
    copyAttribute(element, kAXRoleAttribute as CFString) as? String
}

private func url(of element: AXUIElement) -> URL? {
    guard let value = copyAttribute(element, kAXURLAttribute as CFString) else { return nil }
    if let url = value as? URL { return url }
    if let string = value as? String { return URL(string: string) }
    return nil
}

private func children(of element: AXUIElement) -> [AXUIElement] {
    guard let value = copyAttribute(element, kAXChildrenAttribute as CFString) else { return [] }
    return value as? [AXUIElement] ?? []
}

private func descendants(of root: AXUIElement, limit: Int) -> [AXUIElement] {
    var pending = children(of: root)
    var result: [AXUIElement] = []
    while !pending.isEmpty && result.count < limit {
        let element = pending.removeFirst()
        result.append(element)
        pending.append(contentsOf: children(of: element))
    }
    return result
}

private func sameElement(_ left: AXUIElement, _ right: AXUIElement) -> Bool {
    CFEqual(left, right)
}

private func contains(_ root: AXUIElement, descendant: AXUIElement) -> Bool {
    descendants(of: root, limit: 2_000).contains { sameElement($0, descendant) }
}
