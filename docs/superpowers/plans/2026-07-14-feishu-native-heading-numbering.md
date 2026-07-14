# Feishu Native Heading Numbering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 OpenAPI 创建或识别完整的新公司岗位 JD 后，由现有 Swift 本机助手通过 macOS 辅助功能向 Chrome/Edge 飞书页面发送一次真实的 `Command + Shift + 7`，并在 OpenAPI 确认自动编号后写入 Portfolio，同时支持安全恢复当前 JD-only 的 CoFANCY。

**Architecture:** 内容脚本只负责固定测试副本中的唯一 Heading 1 定位和 DOM 光标准备；Swift Native Messaging 助手只接受固定编号命令，切回唯一的 Chrome/Edge 飞书 `AXWebArea` 并投递固定 CoreGraphics 键盘事件；OpenAPI 编排器负责最终语义校验、恢复模式和 Portfolio 写入。现有 OAuth/Keychain、本机安装路径、Boss/脉脉功能保持兼容。

**Tech Stack:** JavaScript ES modules, React 19, Vitest/jsdom, Chrome/Edge Manifest V3, Swift 6, macOS ApplicationServices/CoreGraphics, Feishu Docx OpenAPI.

## Global Constraints

- 唯一可写文档为 `https://zhenfund.feishu.cn/wiki/LlhrwSLIvilANZk1opwcQGlUnNv`；正式文档保持只读。
- 支持 macOS 13 及以上、Google Chrome 和 Microsoft Edge、arm64 与 x86_64。
- 不使用 `debugger`、剪贴板、AppleScript、录屏、输入监控、完全磁盘访问或飞书未公开 API。
- 本机编号请求不得携带按键、坐标、网址、公司正文或脚本，只允许固定 `APPLY_HEADING_NUMBERING`。
- 一次写入最多投递一次真实快捷键；本机结果未知时先 OpenAPI 回读，绝不自动重发。
- Portfolio 仅在 JD 完整结构和 Heading 1 `sequence: "auto"` 都已确认后写入。
- `resume-new-company` 只在 JD 完整匹配且 Portfolio 缺失时成立，绝不再次创建 JD。
- 不修改 `src/lib/jdParser.js` 或 `src/content/formFiller.js`；`npm run verify:legacy` 必须持续通过。
- 所有真实写入和人工验收只使用测试副本。

## File Structure

- Create `native-helper/Sources/FeishuAuthHost/NativeRequest.swift`: 严格路由 `EXCHANGE_CODE` 与固定编号请求。
- Create `native-helper/Sources/FeishuAuthHost/HeadingNumbering.swift`: 可注入的编号协议、错误原因和 macOS AX/CoreGraphics 实现。
- Modify `native-helper/Sources/FeishuAuthHost/NativeHost.swift`: 根据请求类型调用 OAuth exchanger 或 heading numberer，并返回安全响应。
- Modify `native-helper/Sources/FeishuAuthHostCLI/FeishuAuthHostMain.swift`: 生产注入 macOS 编号器，并提供权限检查命令。
- Modify `native-helper/Tests/FeishuAuthHostTests/NativeHostTests.swift`: 请求路由和 OAuth 回归。
- Create `native-helper/Tests/FeishuAuthHostTests/HeadingNumberingTests.swift`: 权限、浏览器、网页焦点和单次按键测试。
- Modify `native-helper/Tests/FeishuAuthHostTests/TestMain.swift`: 注册新增 Swift 测试。
- Modify `src/content/feishuHeadingNumbering.js`: 从合成事件执行器改为只读页面准备器。
- Modify `src/content/feishuHeadingMessages.js`, `src/content/index.js`: 改用 `FEISHU_PREPARE_HEADING_NUMBERING`。
- Modify `src/background/feishuPageNumbering.js`: 只负责活动测试副本与页面准备消息。
- Create `src/background/feishuNativeNumbering.js`: 固定 Native Messaging 编号适配器。
- Modify `src/background/feishuMessages.js`: 组合页面准备器、本机编号器和 OpenAPI writer。
- Create `src/lib/feishuResumeMatcher.js`: 对现有 JD 与草稿做完整语义匹配。
- Modify `src/lib/feishuTemplateReader.js`: 回读公司介绍和岗位引用正文供恢复检查。
- Modify `src/lib/feishuOpenApiPlan.js`: 新增 `resume-new-company` 计划。
- Modify `src/lib/feishuBlockRenderer.js`, `src/lib/feishuWriteVerifier.js`: 让恢复模式只生成/校验 Portfolio。
- Modify `src/background/feishuOpenApiWriter.js`: 跳过恢复模式 JD 创建，处理本机结果未知和编号验证。
- Modify `src/sidepanel/feishuUi.js`, `src/sidepanel/App.jsx`: 显示恢复计划和权限诊断。
- Modify `scripts/install-feishu-auth-helper.sh`: 安装后检查/请求辅助功能权限。
- Modify `README.md`, `docs/testing/2026-07-13-feishu-openapi-acceptance.md`: 安装、恢复和验收说明。

---

### Task 1: Add a strict native request router without changing OAuth behavior

**Files:**
- Create: `native-helper/Sources/FeishuAuthHost/NativeRequest.swift`
- Create: `native-helper/Sources/FeishuAuthHost/HeadingNumbering.swift`
- Modify: `native-helper/Sources/FeishuAuthHost/NativeHost.swift`
- Modify: `native-helper/Tests/FeishuAuthHostTests/NativeHostTests.swift`

**Interfaces:**
- Produces: `NativeHostRequest.exchange(ExchangeCodeRequest)` and `NativeHostRequest.applyHeadingNumbering`.
- Produces: `HeadingNumbering.apply() throws` and stable reasons `accessibility-not-granted`, `unsupported-front-app`, `web-area-missing`, `web-area-focus-failed`, `native-event-failed`.
- Preserves: `handleNativeRequest(_:exchanger:headingNumberer:) async -> NativeHostResponse` and all token response fields.

- [ ] **Step 1: Write failing request-routing tests**

Add a spy and assertions to `NativeHostTests.swift`:

```swift
final class SpyHeadingNumberer: HeadingNumbering, @unchecked Sendable {
    var calls = 0
    var error: HeadingNumberingError?
    func apply() throws {
        calls += 1
        if let error { throw error }
    }
}

let numberer = SpyHeadingNumberer()
let numbering = await handleNativeRequest(
    Data(#"{"type":"APPLY_HEADING_NUMBERING"}"#.utf8),
    exchanger: StubTokenExchanger(result: TokenResult(accessToken: "unused", expiresIn: 1, scope: "")),
    headingNumberer: numberer
)
try expect(numbering.ok && numberer.calls == 1, "routes fixed heading request once")

let injected = await handleNativeRequest(
    Data(#"{"type":"APPLY_HEADING_NUMBERING","key":"A"}"#.utf8),
    exchanger: StubTokenExchanger(result: TokenResult(accessToken: "unused", expiresIn: 1, scope: "")),
    headingNumberer: numberer
)
try expect(!injected.ok && numberer.calls == 1, "rejects executable numbering fields")
```

- [ ] **Step 2: Run the Swift tests and verify RED**

Run:

```bash
cd native-helper && swift run feishu-auth-host-tests
```

Expected: compilation fails because `HeadingNumbering`, `HeadingNumberingError`, and the new handler parameter do not exist.

- [ ] **Step 3: Implement strict request decoding and safe responses**

Create `NativeRequest.swift` with a `JSONSerialization` key whitelist:

```swift
package enum NativeHostRequest {
    case exchange(ExchangeCodeRequest)
    case applyHeadingNumbering
}

package func decodeNativeHostRequest(_ data: Data) throws -> NativeHostRequest {
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          let type = object["type"] as? String else {
        throw TokenExchangeError(message: "Invalid native request")
    }
    switch type {
    case "EXCHANGE_CODE":
        guard Set(object.keys) == ["type", "appId", "code", "redirectUri", "codeVerifier"] else {
            throw TokenExchangeError(message: "Invalid native request")
        }
        return .exchange(try decodeExchangeRequest(data))
    case "APPLY_HEADING_NUMBERING":
        guard Set(object.keys) == ["type"] else {
            throw TokenExchangeError(message: "Invalid native numbering request")
        }
        return .applyHeadingNumbering
    default:
        throw TokenExchangeError(message: "Unsupported native request type")
    }
}
```

Create the platform-independent portion of `HeadingNumbering.swift`:

```swift
package protocol HeadingNumbering: Sendable { func apply() throws }

package enum HeadingNumberingError: String, Error, Equatable {
    case accessibilityNotGranted = "accessibility-not-granted"
    case unsupportedFrontApp = "unsupported-front-app"
    case webAreaMissing = "web-area-missing"
    case webAreaFocusFailed = "web-area-focus-failed"
    case nativeEventFailed = "native-event-failed"
}

package struct UnavailableHeadingNumberer: HeadingNumbering {
    package init() {}
    package func apply() throws { throw HeadingNumberingError.nativeEventFailed }
}
```

Update `NativeHost.swift` so `.exchange` preserves `NativeHostResponse.success(_:)`, `.applyHeadingNumbering` calls the injected numberer once and returns `{ok:true}`, and `HeadingNumberingError` maps only its raw safe reason into `message`/`reason`. Add an optional `reason: String?` field to `NativeHostResponse`; do not echo request bodies.

- [ ] **Step 4: Run focused Swift tests and verify GREEN**

Run:

```bash
cd native-helper && swift run feishu-auth-host-tests
```

Expected: all existing OAuth/Keychain/native message tests plus the new route assertions pass.

- [ ] **Step 5: Commit the request router**

```bash
git add native-helper/Sources/FeishuAuthHost/NativeRequest.swift \
  native-helper/Sources/FeishuAuthHost/HeadingNumbering.swift \
  native-helper/Sources/FeishuAuthHost/NativeHost.swift \
  native-helper/Tests/FeishuAuthHostTests/NativeHostTests.swift
git commit -m "feat: route fixed native heading request"
```

---

### Task 2: Implement macOS Accessibility focus and one fixed keyboard event

**Files:**
- Modify: `native-helper/Sources/FeishuAuthHost/HeadingNumbering.swift`
- Modify: `native-helper/Sources/FeishuAuthHostCLI/FeishuAuthHostMain.swift`
- Create: `native-helper/Tests/FeishuAuthHostTests/HeadingNumberingTests.swift`
- Modify: `native-helper/Tests/FeishuAuthHostTests/TestMain.swift`
- Modify: `native-helper/Tests/FeishuAuthHostTests/TestSupport.swift`

**Interfaces:**
- Produces: `MacHeadingNumberer(environment:)` conforming to `HeadingNumbering`.
- Produces injectable `HeadingNumberingEnvironment` methods `hasPostEventAccess(prompt:)`, `frontmostBundleIdentifier()`, `focusTestCopyWebArea()`, and `postCommandShiftSeven()`.
- CLI produces `--check-accessibility` and `--request-accessibility` exit-status commands.

- [ ] **Step 1: Write failing unit tests for permission, browser gates, focus, and one event**

Create `HeadingNumberingTests.swift` with a mutable spy environment:

```swift
final class SpyHeadingEnvironment: HeadingNumberingEnvironment, @unchecked Sendable {
    var trusted = true
    var bundleID: String? = "com.microsoft.edgemac"
    var focusError: HeadingNumberingError?
    var postCalls = 0
    func hasPostEventAccess(prompt: Bool) -> Bool { trusted }
    func frontmostBundleIdentifier() -> String? { bundleID }
    func focusTestCopyWebArea() throws { if let focusError { throw focusError } }
    func postCommandShiftSeven() throws { postCalls += 1 }
}

func runHeadingNumberingTests() throws -> Int {
    let denied = SpyHeadingEnvironment(); denied.trusted = false
    try expectThrowsEqual(HeadingNumberingError.accessibilityNotGranted) {
        try MacHeadingNumberer(environment: denied).apply()
    }
    try expect(denied.postCalls == 0, "denied permission sends no key")

    let wrongApp = SpyHeadingEnvironment(); wrongApp.bundleID = "com.apple.Terminal"
    try expectThrowsEqual(HeadingNumberingError.unsupportedFrontApp) {
        try MacHeadingNumberer(environment: wrongApp).apply()
    }

    let success = SpyHeadingEnvironment()
    try MacHeadingNumberer(environment: success).apply()
    try expect(success.postCalls == 1, "posts fixed shortcut once")
    return 3
}
```

Add this synchronous helper to `TestSupport.swift`, then register `runHeadingNumberingTests()` in `TestMain.swift`:

```swift
func expectThrowsEqual<T: Error & Equatable>(
    _ expected: T,
    _ operation: () throws -> Void
) throws {
    do {
        try operation()
        throw TestFailure.expectation("Expected \(expected) to be thrown")
    } catch let actual as T {
        try expect(actual == expected, "expected \(expected), got \(actual)")
    } catch {
        throw TestFailure.expectation("Expected \(expected), got \(error)")
    }
}
```

- [ ] **Step 2: Run the Swift tests and verify RED**

Run:

```bash
cd native-helper && swift run feishu-auth-host-tests
```

Expected: compilation fails because `HeadingNumberingEnvironment` and `MacHeadingNumberer` do not exist.

- [ ] **Step 3: Implement the injected macOS environment**

In `HeadingNumbering.swift`, import `AppKit` and `ApplicationServices` and implement:

```swift
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
```

`MacHeadingEnvironment.focusTestCopyWebArea()` must:

- obtain `NSWorkspace.shared.frontmostApplication` and its `AXUIElementCreateApplication(pid)`;
- get the focused window and traverse at most 2,000 descendants;
- collect `AXWebArea` elements whose `AXURL` host/path equals the fixed test-copy URL, ignoring query/fragment;
- require exactly one match;
- raise the focused browser window, set the selected web area focused, and verify the focused UI element is inside that web area;
- throw `webAreaMissing` or `webAreaFocusFailed` instead of falling back to coordinates.

`postCommandShiftSeven()` must construct only virtual key code `26`, apply `.maskCommand` and `.maskShift`, post one down and one up through `.cghidEventTap`, and throw `nativeEventFailed` if either event cannot be constructed.

- [ ] **Step 4: Wire production and permission-check CLI modes**

Update `FeishuAuthHostMain.swift`:

```swift
if arguments == ["--check-accessibility"] {
    exit(MacHeadingEnvironment().hasPostEventAccess(prompt: false) ? 0 : 1)
}
if arguments == ["--request-accessibility"] {
    exit(MacHeadingEnvironment().hasPostEventAccess(prompt: true) ? 0 : 1)
}
```

Pass `MacHeadingNumberer()` into `runNativeHost`; preserve `--configure-secret`, `--delete-secret`, and Chromium origin validation exactly.

- [ ] **Step 5: Run Swift tests and build both architectures**

Run:

```bash
cd native-helper && swift run feishu-auth-host-tests
swift build -c release --arch arm64 --product feishu-auth-host
swift build -c release --arch x86_64 --product feishu-auth-host
```

Expected: all tests pass and both release builds succeed without requesting Accessibility during tests.

- [ ] **Step 6: Commit the macOS numberer**

```bash
git add native-helper/Sources/FeishuAuthHost/HeadingNumbering.swift \
  native-helper/Sources/FeishuAuthHostCLI/FeishuAuthHostMain.swift \
  native-helper/Tests/FeishuAuthHostTests/HeadingNumberingTests.swift \
  native-helper/Tests/FeishuAuthHostTests/TestMain.swift \
  native-helper/Tests/FeishuAuthHostTests/TestSupport.swift
git commit -m "feat: post trusted Feishu heading shortcut"
```

---

### Task 3: Replace synthetic page events with preparation plus Native Messaging

**Files:**
- Modify: `src/content/feishuHeadingNumbering.js`
- Modify: `src/content/feishuHeadingMessages.js`
- Modify: `src/content/index.js`
- Modify: `src/background/feishuPageNumbering.js`
- Create: `src/background/feishuNativeNumbering.js`
- Modify: `src/background/feishuMessages.js`
- Modify: `tests/feishuHeadingNumbering.test.js`
- Modify: `tests/feishuHeadingMessages.test.js`
- Modify: `tests/feishuPageNumbering.test.js`
- Create: `tests/feishuNativeNumbering.test.js`
- Modify: `tests/feishuBackgroundMessages.test.js`

**Interfaces:**
- Produces: `prepareFeishuHeadingNumbering({root,url,companyName,settle,maxSteps}) -> {ok:true,state:"prepared"|"already-numbered"} | {ok:false,...}`.
- Produces: `createFeishuPageNumbering().prepare(companyName)`.
- Produces: `createFeishuNativeNumbering().apply() -> {ok:true}` or `FeishuNativeNumberingError` with `reason` and `ambiguous`.
- `numberHeading(companyName)` composes page preparation and the fixed native request.

- [ ] **Step 1: Rewrite tests to require zero synthetic keyboard events**

Replace the first content test with:

```js
it("focuses the unique heading without dispatching page keyboard events", async () => {
  mount(heading("CoFANCY 可糖"));
  const editor = document.querySelector('[contenteditable="true"]');
  const keydown = vi.fn();
  editor.addEventListener("keydown", keydown);
  await expect(prepareFeishuHeadingNumbering({
    root: document, url: TEST_FEISHU_DOC_URL, companyName: "CoFANCY 可糖",
    settle: vi.fn().mockResolvedValue(undefined)
  })).resolves.toEqual({ ok: true, state: "prepared" });
  expect(document.activeElement).toBe(editor);
  expect(keydown).not.toHaveBeenCalled();
});
```

Add native transport tests:

```js
it("sends one fixed native request with no executable payload", async () => {
  const chromeApi = makeNativeChrome({ ok: true });
  await expect(createFeishuNativeNumbering({ chromeApi }).apply()).resolves.toEqual({ ok: true });
  expect(chromeApi.runtime.sendNativeMessage).toHaveBeenCalledWith(
    FEISHU_NATIVE_HOST,
    { type: "APPLY_HEADING_NUMBERING" },
    expect.any(Function)
  );
});

it("marks a missing callback response as ambiguous", async () => {
  const service = createFeishuNativeNumbering({ chromeApi: makeNativeChrome(undefined, "host exited") });
  await expect(service.apply()).rejects.toMatchObject({
    reason: "native-result-unknown", ambiguous: true
  });
});
```

- [ ] **Step 2: Run focused JavaScript tests and verify RED**

Run:

```bash
npx vitest run tests/feishuHeadingNumbering.test.js tests/feishuHeadingMessages.test.js \
  tests/feishuPageNumbering.test.js tests/feishuNativeNumbering.test.js
```

Expected: failures because the preparation API and native adapter do not exist.

- [ ] **Step 3: Implement page preparation and message rename**

Rename the content operation and message to `FEISHU_PREPARE_HEADING_NUMBERING`. Keep fixed-URL, editability, virtual-scroll, exact unique root Heading 1 and caret logic. Remove all `KeyboardEvent` construction and the 300 ms `.heading-order` wait. Return `{ok:true,state:"already-numbered"}` for an already numbered heading, otherwise `{ok:true,state:"prepared"}`.

- [ ] **Step 4: Implement the fixed native adapter and composition**

Create `feishuNativeNumbering.js` with a callback-safe one-shot wrapper that sends exactly:

```js
{ type: "APPLY_HEADING_NUMBERING" }
```

The transport implementation must settle once and inspect `runtime.lastError` only inside the callback:

```js
function sendFixedNativeRequest(chromeApi) {
  return new Promise((resolve, reject) => {
    try {
      chromeApi.runtime.sendNativeMessage(
        FEISHU_NATIVE_HOST,
        { type: "APPLY_HEADING_NUMBERING" },
        (response) => {
          const lastError = chromeApi.runtime.lastError;
          if (lastError || !response) {
            reject(new FeishuNativeNumberingError(
              "本机编号助手结果未知。", "native-result-unknown", true
            ));
            return;
          }
          resolve(response);
        }
      );
    } catch {
      reject(new FeishuNativeNumberingError(
        "本机编号助手结果未知。", "native-result-unknown", true
      ));
    }
  });
}
```

Explicit helper failures preserve only known reasons from the Swift enum and are deterministic. `chrome.runtime.lastError`, missing response, or callback exceptions map to `{reason:"native-result-unknown", ambiguous:true}`.

Update background construction:

```js
const pageNumbering = createFeishuPageNumbering({ chromeApi });
const nativeNumbering = createFeishuNativeNumbering({ chromeApi });
const numberHeading = async (companyName) => {
  const prepared = await pageNumbering.prepare(companyName);
  if (prepared.state === "already-numbered") return prepared;
  await nativeNumbering.apply();
  return { ok: true, state: "event-sent" };
};
```

Inject `numberHeading` into `createFeishuOpenApiWriter` and expose the two adapters only for tests/diagnostics.

- [ ] **Step 5: Run focused tests and build the classic content script**

Run:

```bash
npx vitest run tests/feishuHeadingNumbering.test.js tests/feishuHeadingMessages.test.js \
  tests/feishuPageNumbering.test.js tests/feishuNativeNumbering.test.js \
  tests/feishuBackgroundMessages.test.js
VITE_FEISHU_AUTH_MODE=native npm run build
```

Expected: all focused tests pass; `dist/content.js` contains no top-level `import`/`export`; native build manifest contains `nativeMessaging` and no forbidden permissions.

- [ ] **Step 6: Commit the extension-to-native numbering path**

```bash
git add src/content/feishuHeadingNumbering.js src/content/feishuHeadingMessages.js src/content/index.js \
  src/background/feishuPageNumbering.js src/background/feishuNativeNumbering.js src/background/feishuMessages.js \
  tests/feishuHeadingNumbering.test.js tests/feishuHeadingMessages.test.js \
  tests/feishuPageNumbering.test.js tests/feishuNativeNumbering.test.js tests/feishuBackgroundMessages.test.js
git commit -m "feat: route Feishu numbering through native host"
```

---

### Task 4: Read full JD semantics and build an exact resume plan

**Files:**
- Modify: `src/lib/feishuTemplateReader.js`
- Create: `src/lib/feishuResumeMatcher.js`
- Modify: `src/lib/feishuOpenApiPlan.js`
- Modify: `tests/feishuTemplateReader.test.js`
- Create: `tests/feishuResumeMatcher.test.js`
- Modify: `tests/feishuOpenApiPlan.test.js`
- Modify: `tests/helpers/feishuWriteScenario.js`

**Interfaces:**
- `inspectRecruitingDocument` adds `company.introTexts` and job fields `location`, `employment`, `responsibilities`, `requirements`, `bonuses`.
- Produces: `matchResumeCompany(company,draft) -> {ok:boolean,errors:string[]}`.
- `buildFeishuOpenApiPlan` produces mode `resume-new-company` only for exact JD-only state.

- [ ] **Step 1: Add failing semantic-read and resume tests**

Add fixture assertions:

```js
expect(snapshot.jd.companies[0]).toMatchObject({
  introTexts: expect.any(Array),
  jobs: [expect.objectContaining({
    location: expect.any(String),
    employment: expect.any(String),
    responsibilities: expect.any(Array),
    requirements: expect.any(Array),
    bonuses: expect.any(Array)
  })]
});
```

Add a resume plan test based on `successfulSnapshots().unnumberedJd` with its Portfolio company absent:

```js
const current = successfulSnapshots().unnumberedJd;
const plan = buildFeishuOpenApiPlan(current, draft);
expect(plan).toMatchObject({
  ok: true,
  mode: "resume-new-company",
  jobs: [{ ordinal: 1 }, { ordinal: 2 }],
  expected: { totalJdJobs: 2, totalSummaryJobs: 2 }
});
```

Add table-driven failures for changed intro text, changed responsibility, missing job, extra job, duplicate JD company, and Portfolio-only company; every case must contain `现有岗位 JD 与本次草稿不完全一致` or the existing unique-company error.

- [ ] **Step 2: Run plan/reader tests and verify RED**

Run:

```bash
npx vitest run tests/feishuTemplateReader.test.js tests/feishuResumeMatcher.test.js \
  tests/feishuOpenApiPlan.test.js
```

Expected: failures because semantic fields and resume mode are absent.

- [ ] **Step 3: Extend semantic document inspection**

In `feishuTemplateReader.js`:

- collect Callout descendant Bullet texts in document order as `introTexts`;
- parse job heading with `/^[（(](\d+)[）)]\s*([^｜|]+)[｜|]([^｜|]+)[｜|](.+)$/`;
- parse QuoteContainer children by exact normalized labels `工作内容`, `职位要求`, `加分项`, and compatibility label `你可获得`;
- assign following Bullet blocks to the active label until the next Text label;
- keep `validQuote` and template extraction behavior unchanged.

- [ ] **Step 4: Implement exact resume matching**

Create `feishuResumeMatcher.js` with separate normalization for prose:

```js
const normalizeText = (value) => String(value ?? "")
  .normalize("NFKC").replace(/\s+/g, " ").trim();

export function matchResumeCompany(company, draft) {
  const errors = [];
  compareArray(company.introTexts, draft.companyIntro?.length ? draft.companyIntro : ["待补充"], "公司介绍", errors);
  if ((company.jobs ?? []).length !== (draft.jobs ?? []).length) errors.push("岗位数量不一致");
  for (const [index, expected] of (draft.jobs ?? []).entries()) {
    const actual = company.jobs?.[index];
    if (!actual) continue;
    compareScalar(actual.title, expected.title, `岗位 ${index + 1} 名称`, errors);
    compareScalar(actual.location, expected.location, `岗位 ${index + 1} 地点`, errors);
    compareScalar(actual.employment, expected.employment, `岗位 ${index + 1} 类型`, errors);
    compareArray(actual.responsibilities, expected.responsibilities, `岗位 ${index + 1} 工作内容`, errors);
    compareArray(actual.requirements, expected.requirements, `岗位 ${index + 1} 职位要求`, errors);
    compareArray(actual.bonuses, expected.bonuses ?? [], `岗位 ${index + 1} 加分项`, errors);
  }
  return { ok: errors.length === 0, errors };
}
```

Array comparison must preserve item order and count; normalization may ignore Unicode width and whitespace only, not wording or missing items.

- [ ] **Step 5: Add `resume-new-company` to the plan builder**

Branch before the existing asymmetric-section error:

```js
const canAttemptResume = portfolioMatches.length === 0 && jdMatches.length === 1;
const resume = canAttemptResume ? matchResumeCompany(jdMatches[0], draft) : null;
const mode = canAttemptResume && resume.ok
  ? "resume-new-company"
  : portfolioMatches.length === 1 && jdMatches.length === 1
    ? "append-jobs"
    : "new-company";
```

For resume, use persisted job ordinals, require the existing company to be the first JD company, set `jdTarget` to its current root index, set `summaryTarget` to Portfolio `firstCompanyIndex`, and do not classify the input jobs as duplicates of themselves. If resume matching fails, add one public error `现有岗位 JD 与本次草稿不完全一致：<安全字段名>` and keep `ok:false`.

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
npx vitest run tests/feishuTemplateReader.test.js tests/feishuResumeMatcher.test.js \
  tests/feishuOpenApiPlan.test.js tests/feishuWriteVerifier.test.js
```

Expected: all pass.

```bash
git add src/lib/feishuTemplateReader.js src/lib/feishuResumeMatcher.js src/lib/feishuOpenApiPlan.js \
  tests/feishuTemplateReader.test.js tests/feishuResumeMatcher.test.js \
  tests/feishuOpenApiPlan.test.js tests/helpers/feishuWriteScenario.js
git commit -m "feat: plan exact Feishu JD recovery"
```

---

### Task 5: Resume safely and verify native numbering before Portfolio

**Files:**
- Modify: `src/lib/feishuBlockRenderer.js`
- Modify: `src/lib/feishuWriteVerifier.js`
- Modify: `src/background/feishuOpenApiWriter.js`
- Modify: `tests/feishuBlockRenderer.test.js`
- Modify: `tests/feishuWriteVerifier.test.js`
- Modify: `tests/feishuOpenApiWriter.test.js`

**Interfaces:**
- `renderSummaryDescendants` treats `resume-new-company` like a new company and includes the Portfolio Heading 3.
- Writer skips JD creation for resume, but performs the same numbering and verification gates.
- Ambiguous native failure is resolved by one bounded read-only verification sequence before returning unknown.

- [ ] **Step 1: Add failing renderer/verifier/writer tests**

Add assertions that a resume summary contains company plus jobs, while JD creation is not called:

```js
expect(renderSummaryDescendants(draft, resumePlan, templates).children_id)
  .toEqual(["summary-company", "summary-job-1", "summary-job-2"]);
```

Writer test:

```js
it("resumes an exact JD-only company without creating JD again", async () => {
  const { unnumberedJd, jd, complete } = successfulSnapshots();
  const inspect = vi.fn()
    .mockResolvedValueOnce(unnumberedJd)
    .mockResolvedValueOnce(jd)
    .mockResolvedValueOnce(complete);
  const request = vi.fn().mockResolvedValue({});
  const numberHeading = vi.fn().mockResolvedValue({ ok: true, state: "event-sent" });
  const writer = createFeishuOpenApiWriter({ client:{request}, inspect, numberHeading, wait: immediate });
  await expect(writer.write(draft)).resolves.toMatchObject({
    ok: true, mode: "resume-new-company", completedStages:["jd","summary"]
  });
  expect(numberHeading).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][1].stage).toBe("summary-write");
});
```

Add an ambiguous native error test where the first OpenAPI poll already shows `sequence:auto`; expect success and exactly one native call. Add the same error with five unnumbered snapshots; expect `status:"unknown"`, no Portfolio request, and no second native call.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npx vitest run tests/feishuBlockRenderer.test.js tests/feishuWriteVerifier.test.js \
  tests/feishuOpenApiWriter.test.js
```

Expected: resume mode is rejected or attempts a duplicate JD write.

- [ ] **Step 3: Make renderers and verifiers mode-aware**

Use helpers instead of repeated string checks:

```js
const isNewCompanyMode = (mode) => mode === "new-company" || mode === "resume-new-company";
```

- `renderJdDescendants` remains valid only for `new-company` and `append-jobs`; writer never calls it for resume.
- `renderSummaryDescendants` accepts all three modes and includes company Heading 3 for both new-company modes.
- `verifyJdWrite` requires numbering and first-position formulas for both new-company modes.
- `verifySummaryWrite` uses company-plus-jobs index formulas for both new-company modes.

- [ ] **Step 4: Restructure writer execution without changing append behavior**

After plan construction:

```js
const resuming = plan.mode === "resume-new-company";
const jdRequest = resuming ? null : renderJdDescendants(draft, plan, initial.templates.jd);
const summaryRequest = renderSummaryDescendants(draft, plan, initial.templates.portfolio);
let afterJd = initial;
if (!resuming) {
  jdRequest = renderJdDescendants(draft, plan, initial.templates.jd);
  await createDescendants(
    client,
    initial.documentId,
    plan.jdTarget,
    plan.baseRevisionId,
    jdRequest,
    "jd-write"
  );
  await wait(400);
  afterJd = await inspect();
}
```

Preserve the existing ambiguity branch around this exact create/read-back sequence: a rejected non-network response returns `jd-write`; an ambiguous network response performs one read-back and accepts it only when `verifyJdWrite(afterJd, plan, {requireNumbering:false})` succeeds; a successful create followed by unreadable read-back remains `unknown` and never creates JD again.

Run numbering when `plan.mode !== "append-jobs"` and OpenAPI has not already confirmed auto numbering. On `error.ambiguous === true`, call the existing bounded `waitForNumberedJd` before deciding; if it succeeds continue, otherwise return unknown with `failedStage:"jd-numbering-page"`. Deterministic permission/focus failures return partial with a specific repair hint. Never call `numberHeading` twice.

- [ ] **Step 5: Run focused writer tests and commit**

Run:

```bash
npx vitest run tests/feishuBlockRenderer.test.js tests/feishuWriteVerifier.test.js \
  tests/feishuOpenApiWriter.test.js tests/feishuBackgroundMessages.test.js
```

Expected: new, append, resume, deterministic failure, ambiguous recovery, bounded timeout, and no-retry tests all pass.

```bash
git add src/lib/feishuBlockRenderer.js src/lib/feishuWriteVerifier.js \
  src/background/feishuOpenApiWriter.js tests/feishuBlockRenderer.test.js \
  tests/feishuWriteVerifier.test.js tests/feishuOpenApiWriter.test.js
git commit -m "feat: safely resume Feishu JD-only writes"
```

---

### Task 6: Expose recovery and Accessibility diagnostics in the JD assistant

**Files:**
- Modify: `src/sidepanel/feishuUi.js`
- Modify: `src/sidepanel/App.jsx`
- Modify: `src/background/feishuMessages.js`
- Modify: `tests/feishuUi.test.js`
- Modify: `tests/feishuBackgroundMessages.test.js`

**Interfaces:**
- `describeFeishuPlan` returns a dedicated resume title and description.
- Write button label is derived from plan mode.
- Native reasons produce safe Chinese guidance without tokens, DOM, or helper stack traces.

- [ ] **Step 1: Add failing UI copy tests**

```js
expect(describeFeishuPlan({
  ok:true, mode:"resume-new-company", baseRevisionId:12, jobs:[]
})).toMatchObject({
  title:"恢复未完成的新公司",
  position:expect.stringContaining("不会重复创建岗位 JD")
});

expect(formatFeishuWriteStatus({
  ok:false, status:"partial", failedStage:"jd-numbering-page",
  reason:"accessibility-not-granted", repairHint:"请在系统设置中启用 feishu-auth-host。",
  completedStages:[]
})).toContain("辅助功能");
```

- [ ] **Step 2: Run UI tests and verify RED**

Run:

```bash
npx vitest run tests/feishuUi.test.js tests/feishuBackgroundMessages.test.js
```

Expected: resume title and Accessibility guidance are absent.

- [ ] **Step 3: Implement mode-specific copy and safe reasons**

Update `describeFeishuPlan` with three explicit branches. In `App.jsx`, derive the write button label:

```jsx
const writeLabel = writePlan?.mode === "resume-new-company"
  ? "继续编号并写入 Portfolio"
  : "确认并写入测试副本";
```

Keep the confirmation dialog and stale-revision gate. After a partial result, the user must regenerate a plan against the latest revision; the next valid plan becomes resume mode.

Map native reasons to these repair hints:

- `accessibility-not-granted`: 打开“系统设置 → 隐私与安全性 → 辅助功能”，启用 `feishu-auth-host`，然后重新生成计划。
- `unsupported-front-app`: 保持 Chrome/Edge 和测试副本为前台后重试。
- `web-area-missing` / `web-area-focus-failed`: 关闭额外飞书测试副本标签，只保留一个活动副本并重试。
- `native-event-failed`: 重新安装最终版本机助手；不要重复提交当前草稿，先重新检查副本。

- [ ] **Step 4: Run UI/background tests and commit**

Run:

```bash
npx vitest run tests/feishuUi.test.js tests/feishuBackgroundMessages.test.js
```

Expected: all pass and public errors contain no request body, App Secret, token, DOM selector, or stack.

```bash
git add src/sidepanel/feishuUi.js src/sidepanel/App.jsx src/background/feishuMessages.js \
  tests/feishuUi.test.js tests/feishuBackgroundMessages.test.js
git commit -m "feat: show Feishu recovery and permission guidance"
```

---

### Task 7: Update installation, documentation, and automated gates

**Files:**
- Modify: `scripts/install-feishu-auth-helper.sh`
- Modify: `tests/nativeHelperInstaller.test.js`
- Modify: `scripts/verify-extension-build.mjs`
- Modify: `README.md`
- Modify: `docs/testing/2026-07-13-feishu-openapi-acceptance.md`

**Interfaces:**
- Installer preserves Chrome/Edge manifests and existing Keychain behavior, then requests only Accessibility permission.
- Build verifier requires fixed native numbering message and continues forbidding clipboard/debugger.

- [ ] **Step 1: Add failing installer/build documentation tests**

Extend `nativeHelperInstaller.test.js` to assert dry-run manifests remain unchanged and add a static script assertion:

```js
const script = await readFile(installer, "utf8");
expect(script).toContain("--check-accessibility");
expect(script).toContain("--request-accessibility");
expect(script).not.toMatch(/tccutil|ScreenCapture|Input Monitoring/i);
```

Extend `verify-extension-build.mjs` to require `APPLY_HEADING_NUMBERING` and reject the removed `shortcut-rejected` DOM-event path in the built background/content bundles.

- [ ] **Step 2: Run installer/manifest tests and verify RED**

Run:

```bash
npx vitest run tests/nativeHelperInstaller.test.js tests/manifest.test.js tests/feishuDocumentation.test.js
```

Expected: installer permission commands and updated documentation are missing.

- [ ] **Step 3: Update installer and docs**

After configuring the Keychain secret, add:

```bash
if ! "$INSTALL_BINARY" --check-accessibility; then
  "$INSTALL_BINARY" --request-accessibility || true
  printf '%s\n' "Enable feishu-auth-host in System Settings > Privacy & Security > Accessibility, then retry." >&2
fi
```

Document:

- four-Mac initial install steps and Chrome/Edge extension IDs;
- the single Accessibility permission and explicitly unneeded permissions;
- binary replacement may require one re-enable;
- exact `resume-new-company` recovery workflow;
- active test-copy and single-tab requirement;
- no production write, no duplicate retry, and manual inspection on unknown state.

- [ ] **Step 4: Run all automated verification**

Run:

```bash
npm test
VITE_FEISHU_AUTH_MODE=native npm run build
./scripts/build-feishu-auth-helper.sh
```

Expected:

- all JavaScript tests pass;
- `npm run verify:legacy` passes;
- production extension build succeeds with nativeMessaging and no forbidden permissions;
- Swift tests pass;
- universal helper reports both arm64 and x86_64 architectures.

- [ ] **Step 5: Commit installer and documentation**

```bash
git add scripts/install-feishu-auth-helper.sh scripts/verify-extension-build.mjs \
  tests/nativeHelperInstaller.test.js README.md \
  docs/testing/2026-07-13-feishu-openapi-acceptance.md
git commit -m "docs: ship native Feishu numbering setup"
```

---

### Task 8: Install the verified build and complete test-copy acceptance

**Files:**
- Generated: `native-helper/.build/universal/Feishu JD Assistant Helper.app`
- Generated: `dist/`
- Sync target: `/Users/vincwnt/Documents/Auto ZhenFund/飞书OpenAPI测试扩展`
- Update: `docs/testing/2026-07-13-feishu-openapi-acceptance.md`

**Interfaces:**
- Uses extension ID `nnfieabngjmimnogokgbccekfpdifgdb` for the current Edge installation.
- Uses only the fixed test-copy URL.

- [ ] **Step 1: Confirm the branch and legacy rollback point**

Run:

```bash
git status --short
git log --oneline --decorate -12
npm run verify:legacy
```

Expected: clean worktree, all task commits visible, legacy integrity passes.

- [ ] **Step 2: Sync the extension build without touching user source files**

Run:

```bash
rsync -a --delete dist/ '/Users/vincwnt/Documents/Auto ZhenFund/飞书OpenAPI测试扩展/'
diff -qr dist '/Users/vincwnt/Documents/Auto ZhenFund/飞书OpenAPI测试扩展'
```

Expected: `diff -qr` prints nothing. Do not sync from an unverified directory.

- [ ] **Step 3: Install the universal native helper for the current Edge ID**

Run:

```bash
./scripts/install-feishu-auth-helper.sh \
  chrome-extension://nnfieabngjmimnogokgbccekfpdifgdb/
```

Expected: the helper is copied to the stable Application Support path, both Chrome and Edge manifests point to it, Keychain configuration succeeds, and macOS prompts for Accessibility if needed. This step requires the user to enable the visible system permission; do not bypass the prompt.

- [ ] **Step 4: Reload Edge and generate a CoFANCY recovery plan**

With the fixed test copy as the single active Feishu copy tab, paste the same CoFANCY draft and generate a plan. Expected plan: `resume-new-company`, with no JD create request.

- [ ] **Step 5: Execute recovery and verify authoritative document state**

After user confirmation, execute once. Verify through OpenAPI and visible page:

- exactly one CoFANCY Heading 1 exists;
- it is displayed as `1. CoFANCY 可糖` and reads `sequence:auto`;
- `闪念贝壳` automatically becomes `2.`;
- CoFANCY Portfolio Heading 3 and its two bullets are first in the callout;
- no duplicated JD or Portfolio blocks exist.

- [ ] **Step 6: Append one controlled job and verify numbering is not invoked**

Generate an `append-jobs` plan for CoFANCY using exactly this additional job:

```text
（3）自动化验收追加岗位｜上海｜社招
工作内容：
- 验证老公司岗位追加流程。
职位要求：
- 仅用于飞书测试副本验收。
```

Verify it appends to both existing company groups, does not create a second company heading, and does not send `APPLY_HEADING_NUMBERING`.

- [ ] **Step 7: Verify a fresh company and Chrome compatibility**

After the CoFANCY recovery is stable, use this exact draft in the same copy to exercise the full `new-company` path once:

```text
自动化验收公司 20260714
公司介绍
本公司块仅用于飞书测试副本自动编号验收。
开放岗位
（1）自动化验收工程师｜北京｜社招
工作内容：
- 验证新公司完整写入流程。
职位要求：
- 仅用于飞书测试副本验收。
```

Repeat the heading-numbering path in Chrome with the corresponding installed extension origin. Never use the production document.

- [ ] **Step 8: Record evidence and commit acceptance notes**

Record date, browser versions, helper architecture, observed plan modes, document revision IDs, and pass/fail for each acceptance item. Do not record tokens, App Secret, OAuth codes, or document正文.

```bash
git add docs/testing/2026-07-13-feishu-openapi-acceptance.md
git commit -m "test: verify native Feishu numbering in copy"
```
