# Feishu Native Auth Helper Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a no-server macOS token-exchange helper for Chrome and Edge only when Feishu's real v2 endpoint rejects secretless PKCE, while keeping all document logic in the extension.

**Architecture:** A small Swift native-messaging executable reads length-prefixed JSON from stdin, retrieves the Feishu App Secret from the current user's Keychain, exchanges an OAuth authorization code, and returns only the short-lived token result. A user-level installer writes the Chrome and Edge native-host manifests; the browser starts the helper on demand and no port or daemon is created.

**Tech Stack:** Swift/Foundation/Security, macOS 13+, Chrome/Edge Native Messaging, JavaScript Manifest V3 adapter, Vitest, XCTest.

## Global Constraints

- Execute this plan only after the primary plan's real PKCE probe proves that Feishu requires `client_secret`.
- Do not move document reading, planning, rendering, writing, or verification into the helper.
- Store the App Secret only as a generic-password item in the current user's macOS Keychain.
- Never print Secret, authorization code, token, verifier, JD text, or API response body to stdout/stderr.
- Native stdout contains only valid length-prefixed Native Messaging JSON.
- Support both Apple Silicon and Intel macOS 13+ in one universal binary.
- Install at user level without a daemon, listening socket, or administrator privilege.
- Allow only the production extension origin(s) passed to the installer.

---

### Task 1: Implement and Test Native Message Framing

**Files:**
- Create: `native-helper/Package.swift`
- Create: `native-helper/Sources/FeishuAuthHost/NativeMessage.swift`
- Create: `native-helper/Tests/FeishuAuthHostTests/NativeMessageTests.swift`

**Interfaces:**
- `NativeMessage.read(from:) throws -> Data?`
- `NativeMessage.write(_:to:) throws`
- Maximum inbound/outbound JSON size: 1 MiB.

- [ ] **Step 1: Write failing XCTest framing cases**

```swift
func testReadsLittleEndianLengthPrefixedJSON() throws {
    let body = Data(#"{"type":"PING"}"#.utf8)
    var size = UInt32(body.count).littleEndian
    let framed = Data(bytes: &size, count: 4) + body
    XCTAssertEqual(try NativeMessage.read(from: InputStream(data: framed)), body)
}

func testRejectsMessagesOverOneMiB() {
    XCTAssertThrowsError(try NativeMessage.validateLength(1_048_577))
}
```

- [ ] **Step 2: Run and verify compilation failure**

Run: `cd native-helper && swift test`

Expected: FAIL because `NativeMessage` is missing.

- [ ] **Step 3: Implement exact framing**

Read exactly four bytes, decode `UInt32(littleEndian:)`, validate length, then read exactly that number of bytes. Writing performs the inverse and flushes the output stream. EOF before the first byte returns `nil`; truncated prefixes/bodies throw.

- [ ] **Step 4: Run tests and commit**

Run: `cd native-helper && swift test`

Expected: PASS for valid message, EOF, zero length, truncation, Unicode, and oversize.

```bash
git add native-helper
git commit -m "feat: add native messaging framing"
```

---

### Task 2: Add Keychain Configuration and Token Exchange

**Files:**
- Create: `native-helper/Sources/FeishuAuthHost/KeychainSecret.swift`
- Create: `native-helper/Sources/FeishuAuthHost/TokenExchange.swift`
- Create: `native-helper/Sources/FeishuAuthHost/main.swift`
- Create: `native-helper/Tests/FeishuAuthHostTests/KeychainSecretTests.swift`
- Create: `native-helper/Tests/FeishuAuthHostTests/TokenExchangeTests.swift`

**Interfaces:**
- Keychain service: `cn.zhenfund.jd-assistant.feishu`
- Keychain account: Feishu App ID.
- Native request: `{ "type":"EXCHANGE_CODE", "appId":string, "code":string, "redirectUri":string, "codeVerifier":string }`.
- Native response: `{ "ok":true, "accessToken":string, "expiresIn":number, "scope":string }` or a sanitized error.

- [ ] **Step 1: Write failing Keychain and exchange tests**

```swift
func testExchangeAddsSecretButReturnsNoSecret() async throws {
    let result = try await exchange.exchange(request)
    XCTAssertEqual(capturedBody["client_secret"] as? String, "stored-secret")
    let encoded = try JSONEncoder().encode(result)
    XCTAssertFalse(String(decoding: encoded, as: UTF8.self).contains("stored-secret"))
}

func testRejectsUnexpectedMessageType() {
    XCTAssertThrowsError(try decodeRequest(Data(#"{"type":"WRITE_DOCUMENT"}"#.utf8)))
}
```

- [ ] **Step 2: Run and verify failures**

Run: `cd native-helper && swift test`

Expected: FAIL because Keychain and token exchange types are missing.

- [ ] **Step 3: Implement Keychain access**

Use `SecItemAdd`, `SecItemUpdate`, and `SecItemCopyMatching` with `kSecClassGenericPassword`, the fixed service, and App ID account. `--configure-secret --app-id <id>` reads the Secret from stdin without echo and stores it. `--delete-secret --app-id <id>` removes it. No command prints the value.

- [ ] **Step 4: Implement a restricted token exchange**

Accept only `EXCHANGE_CODE`. Require an `https://` redirect URI whose host ends in `.chromiumapp.org`, non-empty code/verifier, and the configured App ID. POST to `https://open.feishu.cn/open-apis/authen/v2/oauth/token` with `authorization_code`, App ID, Keychain Secret, code, verifier, and redirect URI. Map Feishu error code/status/log ID to a response without the response body.

- [ ] **Step 5: Implement the native host loop**

The default mode reads one message, writes one response, and exits. Catch all errors and write a sanitized `{ ok:false, errorCode, message }` response. Diagnostic text is disabled in production.

- [ ] **Step 6: Run tests and commit**

Run: `cd native-helper && swift test`

Expected: PASS for configure/read/delete, missing secret, valid exchange, bad redirect, bad type, HTTP errors, malformed JSON, and secret redaction.

```bash
git add native-helper
git commit -m "feat: exchange Feishu tokens through macOS Keychain"
```

---

### Task 3: Build a Universal Binary and Install Chrome/Edge Manifests

**Files:**
- Create: `scripts/build-feishu-auth-helper.sh`
- Create: `scripts/install-feishu-auth-helper.sh`
- Create: `tests/nativeHelperInstaller.test.js`

**Interfaces:**
- Host name: `cn.zhenfund.jd_assistant.feishu_auth`.
- Binary path: `~/Library/Application Support/ZhenFund JD Assistant/feishu-auth-host`.
- Manifest paths:
  - `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/cn.zhenfund.jd_assistant.feishu_auth.json`
  - `~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/cn.zhenfund.jd_assistant.feishu_auth.json`

- [ ] **Step 1: Write a failing installer-output test**

```js
it("renders Chrome and Edge manifests with only the requested origins", async () => {
  const result = await runInstallerDryRun(["chrome-extension://aaa/", "chrome-extension://bbb/"]);
  for (const manifest of result.manifests) {
    expect(manifest.name).toBe("cn.zhenfund.jd_assistant.feishu_auth");
    expect(manifest.allowed_origins).toEqual(["chrome-extension://aaa/", "chrome-extension://bbb/"]);
    expect(manifest.path.startsWith("/")).toBe(true);
  }
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run tests/nativeHelperInstaller.test.js`

Expected: FAIL because installer scripts are absent.

- [ ] **Step 3: Implement universal build**

Build arm64 and x86_64 release binaries with the macOS 13 SDK, combine them with `lipo -create`, and verify `lipo -info` reports both architectures. Fail if XCTest has not passed.

- [ ] **Step 4: Implement user-level installation**

Require one or more exact `chrome-extension://<id>/` arguments. Copy the executable with mode `0700`, write both valid JSON manifests with mode `0600`, run the helper's Keychain configuration command, and verify the installed binary path is absolute. Support `--dry-run` for tests and `--uninstall` to delete binary/manifests without deleting the Keychain item unless explicitly requested.

- [ ] **Step 5: Run tests/build and commit**

Run: `cd native-helper && swift test && cd .. && npx vitest run tests/nativeHelperInstaller.test.js && scripts/build-feishu-auth-helper.sh`

Expected: all tests pass and a two-architecture executable is produced.

```bash
git add scripts/build-feishu-auth-helper.sh scripts/install-feishu-auth-helper.sh tests/nativeHelperInstaller.test.js
git commit -m "build: package Feishu auth helper for Chrome and Edge"
```

---

### Task 4: Add the Extension Native Auth Adapter

**Files:**
- Create: `src/background/feishuNativeAuth.js`
- Create: `tests/feishuNativeAuth.test.js`
- Modify: `src/background/feishuAuth.js`
- Modify: `public/manifest.json`
- Modify: `tests/manifest.test.js`

**Interfaces:**
- `createFeishuNativeAuth({ chromeApi, appId })` implements the same `status()`, `authorize()`, `getAccessToken()`, and `clear()` interface as PKCE auth.
- Native host: `cn.zhenfund.jd_assistant.feishu_auth`.

- [ ] **Step 1: Write failing adapter tests**

```js
it("sends only the OAuth exchange fields to the native host", async () => {
  await auth.authorize();
  expect(chrome.runtime.sendNativeMessage).toHaveBeenCalledWith(
    "cn.zhenfund.jd_assistant.feishu_auth",
    expect.objectContaining({ type: "EXCHANGE_CODE", code: expect.any(String), redirectUri: expect.any(String) })
  );
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run tests/feishuNativeAuth.test.js tests/manifest.test.js`

Expected: FAIL because adapter/permission are missing.

- [ ] **Step 3: Implement the adapter**

The extension still generates PKCE state/verifier and launches the same OAuth page. It sends the returned code to the native host, validates the native response, stores only the short-lived session token, and maps missing-host errors to an installation instruction. It never sends JD/document data to the host.

- [ ] **Step 4: Enable Native Messaging only in the fallback build**

Add `nativeMessaging` to the fallback production manifest and extend manifest tests to require it only when `VITE_FEISHU_AUTH_MODE=native`. The standard secretless build continues to exclude it.

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run tests/feishuNativeAuth.test.js tests/feishuAuth.test.js tests/manifest.test.js && npm run build`

Expected: PASS and fallback build contains `nativeMessaging`.

```bash
git add src/background/feishuNativeAuth.js src/background/feishuAuth.js public/manifest.json tests/feishuNativeAuth.test.js tests/manifest.test.js
git commit -m "feat: use the macOS Feishu auth helper"
```

---

### Task 5: Validate Installation on Chrome and Edge

**Files:**
- Create: `docs/testing/2026-07-13-feishu-native-helper-acceptance.md`

- [ ] **Step 1: Run all automated gates**

Run: `npm test && npm run build && cd native-helper && swift test && cd .. && scripts/build-feishu-auth-helper.sh`

Expected: exit 0; legacy hashes unchanged; universal helper produced.

- [ ] **Step 2: Install for the actual Chrome and Edge extension IDs**

Run the installer with both exact origins, configure the Secret into Keychain, and inspect both native-host manifests. Confirm file permissions and absolute path.

- [ ] **Step 3: Authorize in Chrome**

Click authorize, approve Feishu, confirm the extension reports an expiry, and run a read-only inspection of the fixed test copy. Confirm no helper process remains after the request.

- [ ] **Step 4: Authorize in Edge**

Repeat with Edge and its allowlisted origin. Confirm the same read-only inspection succeeds.

- [ ] **Step 5: Confirm redaction and uninstall recovery**

Search extension logs and helper stderr for the known test Secret/code/token prefixes; no match is allowed. Uninstall the helper, verify the extension reports a clear installation error, then reinstall and authorize again.

- [ ] **Step 6: Record evidence and commit**

```bash
git add docs/testing/2026-07-13-feishu-native-helper-acceptance.md
git commit -m "test: validate Feishu native auth on Chrome and Edge"
```

After this plan passes, resume Task 3 of the primary OpenAPI extension plan.
