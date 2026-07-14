# Feishu Page-Assisted Heading Numbering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 OpenAPI 创建新公司岗位 JD 后，通过当前活动的飞书测试副本页面为公司 Heading 1 执行一次原生自动编号快捷键，并且只有 OpenAPI 回读确认编号成功后才写 Portfolio。

**Architecture:** 新增一个只负责虚拟滚动定位和快捷键触发的内容脚本模块，以及一个只负责活动标签页验证和消息发送的后台适配器。现有 OpenAPI 写入器通过依赖注入调用页面编号适配器，随后只读轮询文档结构；删除已经被真实飞书拒绝的 Heading 1 `update_text_style` PATCH。Boss/脉脉消息、解析和填表代码保持原行为。

**Tech Stack:** JavaScript ES modules, Vitest/jsdom, React 19, Vite 7, Chrome/Edge Manifest V3 APIs, Feishu Docx OpenAPI.

## Global Constraints

- Only `https://zhenfund.feishu.cn/wiki/LlhrwSLIvilANZk1opwcQGlUnNv` may be modified; the production document remains read-only.
- The test-copy tab must be the active tab in the current browser window during a new-company write.
- Do not request `debugger`, `clipboardRead`, or `clipboardWrite`.
- Do not call undocumented Feishu internal APIs or macOS Accessibility/AppleScript automation.
- Dispatch the page numbering shortcut at most once per write; verification may poll read-only but must never repeat the shortcut or a write.
- Stop before Portfolio on every page-numbering or numbering-verification failure.
- Do not modify `src/lib/jdParser.js` or `src/content/formFiller.js`; `npm run verify:legacy` must remain green.
- Keep all existing Boss/Maimai host matches, messages, UI behavior, and tests unchanged.
- Sync to `/Users/vincwnt/Documents/Auto ZhenFund/飞书OpenAPI测试扩展` only after tests, build, and legacy integrity checks pass.

## File Structure

- Create `src/content/feishuHeadingNumbering.js`: exact Heading 1 discovery across the virtualized editor, caret placement, one shortcut dispatch, and local `.heading-order` confirmation.
- Create `tests/feishuHeadingNumbering.test.js`: jsdom coverage for URL, editability, exact/duplicate/already-numbered targets, virtual scroll, and one shortcut.
- Create `src/content/feishuHeadingMessages.js`: fixed-test-copy message boundary for the page numberer.
- Create `tests/feishuHeadingMessages.test.js`: content-message routing and URL-gate coverage.
- Create `src/background/feishuPageNumbering.js`: active-tab gate, content-script message transport, and normalized page-numbering errors.
- Create `tests/feishuPageNumbering.test.js`: active test-copy routing and safe failure behavior.
- Modify `src/content/index.js`: register only the new Feishu numbering message alongside existing recruiting messages.
- Modify `public/manifest.json`: add the exact Feishu wiki host permission and a top-frame Feishu content-script entry without changing the Boss/Maimai entry.
- Modify `tests/manifest.test.js`: assert the new minimal page permission and unchanged legacy matches.
- Modify `src/background/feishuMessages.js`: construct the page-numbering adapter and inject it into the OpenAPI writer.
- Modify `src/background/feishuOpenApiWriter.js`: replace the rejected PATCH with one page action plus bounded read-only verification.
- Modify `tests/feishuOpenApiWriter.test.js`: prove ordering, no PATCH, page failure stop, bounded polling, and append-mode bypass.
- Modify `src/sidepanel/feishuUi.js`: include numbering stages and safe write diagnostics.
- Modify `tests/feishuUi.test.js`: prove diagnostic formatting.
- Modify `README.md` and `docs/testing/2026-07-13-feishu-openapi-acceptance.md`: document the active-tab requirement, minimal Feishu page permission, and manual acceptance gate.

---

### Task 1: Build the isolated Feishu page heading numberer

**Files:**
- Create: `src/content/feishuHeadingNumbering.js`
- Create: `tests/feishuHeadingNumbering.test.js`

**Interfaces:**
- Consumes: `isTestFeishuDocument(url: string): boolean` from `src/lib/feishuConfig.js`.
- Produces: `applyFeishuHeadingNumbering({ root, url, companyName, settle?, maxSteps? }): Promise<{ ok: true } | { ok: false, reason: string, error: string }>`.
- Produces reason codes: `wrong-document`, `not-editable`, `heading-missing`, `heading-duplicate`, `already-numbered`, `shortcut-rejected`.

- [ ] **Step 1: Write failing tests for the safe page contract**

Create `tests/feishuHeadingNumbering.test.js` with jsdom fixtures that model a root Heading 1 and virtual scroll container:

```js
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { applyFeishuHeadingNumbering } from "../src/content/feishuHeadingNumbering.js";
import { TEST_FEISHU_DOC_URL } from "../src/lib/feishuConfig.js";

function heading(name, id = "company", numbered = false) {
  return `<div class="block docx-heading1-block" data-block-id="${id}">
    <div class="heading-block"><div class="heading heading-h1">
      ${numbered ? '<button class="heading-order">1.</button>' : ""}
      <div class="heading-content"><div contenteditable="true">${name}</div></div>
    </div></div>
  </div>`;
}

function mount(html) {
  document.body.innerHTML = `<div class="bear-web-x-container">${html}</div>`;
  const scroll = document.querySelector(".bear-web-x-container");
  Object.defineProperties(scroll, {
    scrollHeight: { value: 1200 },
    clientHeight: { value: 500 }
  });
  return scroll;
}

describe("applyFeishuHeadingNumbering", () => {
  it("focuses the unique unnumbered root Heading 1 and dispatches Command+Shift+7 exactly once", async () => {
    mount(heading("CoFANCY 可糖"));
    const editor = document.querySelector('[contenteditable="true"]');
    const events = [];
    editor.addEventListener("keydown", (event) => {
      events.push([event.type, event.key, event.code, event.metaKey, event.shiftKey]);
      document.querySelector(".heading").insertAdjacentHTML("afterbegin", '<button class="heading-order">1.</button>');
    });
    editor.addEventListener("keyup", (event) => events.push([event.type, event.key, event.code, event.metaKey, event.shiftKey]));

    await expect(applyFeishuHeadingNumbering({
      root: document,
      url: TEST_FEISHU_DOC_URL,
      companyName: "CoFANCY 可糖",
      settle: vi.fn().mockResolvedValue(undefined)
    })).resolves.toEqual({ ok: true });

    expect(events).toEqual([
      ["keydown", "7", "Digit7", true, true],
      ["keyup", "7", "Digit7", true, true]
    ]);
    expect(document.activeElement).toBe(editor);
  });

  it.each([
    ["https://zhenfund.feishu.cn/wiki/production", heading("CoFANCY 可糖"), "wrong-document"],
    [TEST_FEISHU_DOC_URL, "", "heading-missing"],
    [TEST_FEISHU_DOC_URL, heading("CoFANCY 可糖", "a") + heading("CoFANCY 可糖", "b"), "heading-duplicate"],
    [TEST_FEISHU_DOC_URL, heading("CoFANCY 可糖", "a", true), "already-numbered"]
  ])("rejects unsafe page state %#", async (url, html, reason) => {
    mount(html);
    const result = await applyFeishuHeadingNumbering({
      root: document,
      url,
      companyName: "CoFANCY 可糖",
      settle: vi.fn().mockResolvedValue(undefined),
      maxSteps: 2
    });
    expect(result).toMatchObject({ ok: false, reason });
  });

  it("reports shortcut rejection without dispatching a second shortcut", async () => {
    mount(heading("CoFANCY 可糖"));
    const editor = document.querySelector('[contenteditable="true"]');
    const keydown = vi.fn();
    editor.addEventListener("keydown", keydown);
    const result = await applyFeishuHeadingNumbering({
      root: document,
      url: TEST_FEISHU_DOC_URL,
      companyName: "CoFANCY 可糖",
      settle: vi.fn().mockResolvedValue(undefined)
    });
    expect(result).toMatchObject({ ok: false, reason: "shortcut-rejected" });
    expect(keydown).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
npx vitest run tests/feishuHeadingNumbering.test.js
```

Expected: FAIL because `src/content/feishuHeadingNumbering.js` does not exist.

- [ ] **Step 3: Implement the minimum safe numberer**

Create `src/content/feishuHeadingNumbering.js` with this implementation:

```js
import { isTestFeishuDocument } from "../lib/feishuConfig.js";

const REASONS = {
  "wrong-document": "当前活动标签页不是指定飞书测试副本。",
  "not-editable": "飞书测试副本当前不可编辑。",
  "heading-missing": "未找到待编号的新公司 Heading 1。",
  "heading-duplicate": "找到多个同名 Heading 1，已停止编号。",
  "already-numbered": "目标公司 Heading 1 已经存在编号，未再次执行快捷键。",
  "shortcut-rejected": "飞书编辑器未接受自动编号快捷键。"
};

export async function applyFeishuHeadingNumbering({
  root = document,
  url = location.href,
  companyName,
  settle = defaultSettle,
  maxSteps = 160
}) {
  if (!isTestFeishuDocument(url)) return failure("wrong-document");
  if (!root.querySelector('[contenteditable="true"]')) return failure("not-editable");

  const candidates = await collectCandidates(root, companyName, settle, maxSteps);
  if (!candidates.length) return failure("heading-missing");
  if (candidates.length !== 1) return failure("heading-duplicate");

  const block = await revealCandidate(root, candidates[0], settle, maxSteps);
  const editor = block?.querySelector('[contenteditable="true"]');
  if (!block || !editor) return failure("heading-missing");
  if (block.querySelector(".heading-order")) return failure("already-numbered");

  placeCaret(editor, root);
  const KeyboardEventClass = root.defaultView?.KeyboardEvent ?? KeyboardEvent;
  const event = { key: "7", code: "Digit7", metaKey: true, shiftKey: true, bubbles: true, cancelable: true };
  editor.dispatchEvent(new KeyboardEventClass("keydown", event));
  editor.dispatchEvent(new KeyboardEventClass("keyup", event));
  await settle(300);
  return block.querySelector(".heading-order") ? { ok: true } : failure("shortcut-rejected");
}

function failure(reason) {
  return { ok: false, reason, error: REASONS[reason] };
}

async function collectCandidates(root, companyName, settle, maxSteps) {
  const scroll = findScrollContainer(root);
  const originalTop = scroll?.scrollTop ?? 0;
  const matches = new Set();
  for (const top of scrollPositions(scroll, maxSteps)) {
    await moveScroll(root, scroll, top, settle);
    for (const block of matchingBlocks(root, companyName)) {
      const id = block.getAttribute("data-block-id");
      if (id) matches.add(id);
    }
  }
  await moveScroll(root, scroll, originalTop, settle);
  return [...matches];
}

async function revealCandidate(root, blockId, settle, maxSteps) {
  const scroll = findScrollContainer(root);
  for (const top of scrollPositions(scroll, maxSteps)) {
    await moveScroll(root, scroll, top, settle);
    const block = Array.from(root.querySelectorAll(".block.docx-heading1-block[data-block-id]"))
      .find((candidate) => candidate.getAttribute("data-block-id") === blockId);
    if (block) {
      block.scrollIntoView?.({ block: "center" });
      return block;
    }
  }
  return null;
}

function matchingBlocks(root, companyName) {
  const expected = normalized(companyName);
  return Array.from(root.querySelectorAll(".block.docx-heading1-block[data-block-id]")).filter((block) => {
    if (block.closest(".docx-callout-block, .docx-quote_container-block, .docx-quote-block")) return false;
    const editor = block.querySelector('[contenteditable="true"]');
    return editor && normalized(editor.textContent) === expected;
  });
}

function findScrollContainer(root) {
  return Array.from(root.querySelectorAll("*"))
    .find((element) => String(element.className ?? "").includes("bear-web-x-container") && element.scrollHeight > element.clientHeight);
}

function scrollPositions(scroll, maxSteps) {
  if (!scroll) return [0];
  const maxTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
  const stepSize = Math.max(300, Math.floor(scroll.clientHeight * 0.72));
  const positions = [];
  for (let top = 0, steps = 0; steps < maxSteps; steps += 1) {
    positions.push(top);
    if (top >= maxTop) break;
    top = Math.min(maxTop, top + stepSize);
  }
  return positions;
}

async function moveScroll(root, scroll, top, settle) {
  if (!scroll) return;
  scroll.scrollTop = top;
  const EventClass = root.defaultView?.Event ?? Event;
  scroll.dispatchEvent(new EventClass("scroll", { bubbles: true }));
  await settle(120);
}

function placeCaret(editor, root) {
  editor.focus();
  const selection = root.defaultView?.getSelection?.();
  if (!selection) return;
  const range = root.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function normalized(value) {
  return String(value ?? "")
    .replace(/[\u200b\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function defaultSettle(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run tests/feishuHeadingNumbering.test.js tests/feishuDocument.test.js tests/feishuScanner.test.js
```

Expected: all tests PASS and no shortcut test records more than one `keydown`.

- [ ] **Step 5: Commit the isolated page numberer**

```bash
git add src/content/feishuHeadingNumbering.js tests/feishuHeadingNumbering.test.js
git commit -m "feat: add safe Feishu heading numberer"
```

---

### Task 2: Add the restricted page message and active-tab adapter

**Files:**
- Create: `src/background/feishuPageNumbering.js`
- Create: `tests/feishuPageNumbering.test.js`
- Create: `src/content/feishuHeadingMessages.js`
- Create: `tests/feishuHeadingMessages.test.js`
- Modify: `src/content/index.js:1-40`
- Modify: `public/manifest.json:6-41`
- Modify: `tests/manifest.test.js:5-28`
- Modify: `src/background/feishuMessages.js:1-39`
- Modify: `tests/feishuBackgroundMessages.test.js`

**Interfaces:**
- Consumes: `applyFeishuHeadingNumbering(...)` from Task 1.
- Produces: `createFeishuPageNumbering({ chromeApi }): { apply(companyName: string): Promise<{ ok: true }> }`.
- Produces: `FeishuPageNumberingError` with `stage = "jd-numbering-page"`, `reason`, `status = 0`, `code = 0`, and `logId = ""`.
- The writer dependency is `numberHeading(companyName: string): Promise<{ ok: true }>`.

- [ ] **Step 1: Write failing adapter, content-message, and manifest tests**

Create `tests/feishuPageNumbering.test.js`:

```js
import { describe, expect, it, vi } from "vitest";
import { createFeishuPageNumbering } from "../src/background/feishuPageNumbering.js";
import { TEST_FEISHU_DOC_URL } from "../src/lib/feishuConfig.js";

describe("Feishu page numbering transport", () => {
  it("sends one numbering message only to the active test-copy tab", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    const chromeApi = { tabs: {
      query: vi.fn().mockResolvedValue([{ id: 42, url: `${TEST_FEISHU_DOC_URL}?fromScene=spaceOverview` }]),
      sendMessage
    }};
    const service = createFeishuPageNumbering({ chromeApi });
    await expect(service.apply("CoFANCY 可糖")).resolves.toEqual({ ok: true });
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith(42, {
      type: "FEISHU_APPLY_HEADING_NUMBERING",
      companyName: "CoFANCY 可糖"
    });
  });

  it("rejects a non-test active tab before sending a message", async () => {
    const sendMessage = vi.fn();
    const service = createFeishuPageNumbering({ chromeApi: { tabs: {
      query: vi.fn().mockResolvedValue([{ id: 7, url: "https://example.com" }]),
      sendMessage
    }}});
    await expect(service.apply("CoFANCY 可糖")).rejects.toMatchObject({
      stage: "jd-numbering-page",
      reason: "wrong-document"
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("normalizes page failures without leaking DOM details", async () => {
    const service = createFeishuPageNumbering({ chromeApi: { tabs: {
      query: vi.fn().mockResolvedValue([{ id: 42, url: TEST_FEISHU_DOC_URL }]),
      sendMessage: vi.fn().mockResolvedValue({ ok: false, reason: "heading-duplicate", error: "safe" })
    }}});
    await expect(service.apply("CoFANCY 可糖")).rejects.toMatchObject({
      stage: "jd-numbering-page",
      reason: "heading-duplicate",
      message: "safe"
    });
  });
});
```

Create `tests/feishuHeadingMessages.test.js`:

```js
import { describe, expect, it, vi } from "vitest";
import { handleFeishuHeadingNumberingMessage } from "../src/content/feishuHeadingMessages.js";
import { TEST_FEISHU_DOC_URL } from "../src/lib/feishuConfig.js";

describe("Feishu heading numbering content messages", () => {
  it("passes only the fixed message payload to the page numberer", async () => {
    const apply = vi.fn().mockResolvedValue({ ok: true });
    await expect(handleFeishuHeadingNumberingMessage(
      { type: "FEISHU_APPLY_HEADING_NUMBERING", companyName: "CoFANCY 可糖", ignored: "secret" },
      { root: {}, url: TEST_FEISHU_DOC_URL, apply }
    )).resolves.toEqual({ ok: true });
    expect(apply).toHaveBeenCalledWith({ root: {}, url: TEST_FEISHU_DOC_URL, companyName: "CoFANCY 可糖" });
  });

  it("ignores unrelated messages", async () => {
    const apply = vi.fn();
    await expect(handleFeishuHeadingNumberingMessage({ type: "FEISHU_WRITE" }, { apply }))
      .resolves.toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });
});
```

Replace the first manifest test with exact expectations:

```js
it("adds only the test-copy page permission without clipboard or debugger", () => {
  expect(manifest.permissions).toEqual(expect.arrayContaining(["identity", "storage"]));
  expect(manifest.permissions).not.toEqual(expect.arrayContaining(["clipboardRead", "clipboardWrite", "debugger"]));
  expect(manifest.host_permissions).toEqual(expect.arrayContaining([
    "https://accounts.feishu.cn/*",
    "https://open.feishu.cn/*",
    "https://zhenfund.feishu.cn/wiki/*"
  ]));
  const feishuEntry = manifest.content_scripts.find((entry) =>
    entry.matches.includes("https://zhenfund.feishu.cn/wiki/*"));
  expect(feishuEntry).toEqual({
    matches: ["https://zhenfund.feishu.cn/wiki/*"],
    js: ["content.js"],
    run_at: "document_idle",
    all_frames: false
  });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npx vitest run tests/feishuPageNumbering.test.js tests/manifest.test.js tests/feishuBackgroundMessages.test.js
```

Expected: FAIL because the adapter, message route, and Feishu content-script manifest entry do not exist.

- [ ] **Step 3: Implement the active-tab adapter and content route**

Create `src/background/feishuPageNumbering.js`:

```js
import { isTestFeishuDocument } from "../lib/feishuConfig.js";

export class FeishuPageNumberingError extends Error {
  constructor(message, reason = "page-unavailable") {
    super(message);
    this.name = "FeishuPageNumberingError";
    Object.assign(this, { stage: "jd-numbering-page", reason, status: 0, code: 0, logId: "" });
  }
}

export function createFeishuPageNumbering({ chromeApi = chrome } = {}) {
  return {
    async apply(companyName) {
      const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !isTestFeishuDocument(tab.url)) {
        throw new FeishuPageNumberingError("当前活动标签页不是指定飞书测试副本。", "wrong-document");
      }
      let response;
      try {
        response = await chromeApi.tabs.sendMessage(tab.id, {
          type: "FEISHU_APPLY_HEADING_NUMBERING",
          companyName
        });
      } catch {
        throw new FeishuPageNumberingError("无法连接飞书测试副本页面，请刷新页面后重试。", "page-unavailable");
      }
      if (!response?.ok) {
        throw new FeishuPageNumberingError(response?.error || "飞书页面自动编号失败。", response?.reason);
      }
      return { ok: true };
    }
  };
}
```

Create `src/content/feishuHeadingMessages.js`:

```js
import { applyFeishuHeadingNumbering } from "./feishuHeadingNumbering.js";

export async function handleFeishuHeadingNumberingMessage(message, options = {}) {
  if (message?.type !== "FEISHU_APPLY_HEADING_NUMBERING") return null;
  const apply = options.apply ?? applyFeishuHeadingNumbering;
  return apply({
    root: options.root ?? document,
    url: options.url ?? location.href,
    companyName: String(message.companyName ?? "").trim()
  });
}
```

Modify `src/content/index.js` before the Boss/Maimai branches:

```js
if (message?.type === "FEISHU_APPLY_HEADING_NUMBERING") {
  handleFeishuHeadingNumberingMessage(message, { root: document, url: location.href })
    .then(sendResponse)
    .catch(() => sendResponse({ ok: false, reason: "page-unavailable", error: "飞书页面自动编号失败。" }));
  return true;
}
```

Add this exact host permission to `public/manifest.json`:

```json
"https://zhenfund.feishu.cn/wiki/*"
```

Append this separate content-script entry after the unchanged Boss/Maimai entry:

```json
{
  "matches": ["https://zhenfund.feishu.cn/wiki/*"],
  "js": ["content.js"],
  "run_at": "document_idle",
  "all_frames": false
}
```

Modify `createFeishuBackgroundServices` using these exact additions:

```js
const pageNumbering = createFeishuPageNumbering({ chromeApi });
const writer = createFeishuOpenApiWriter({
  client,
  inspect,
  numberHeading: pageNumbering.apply
});
return { auth, client, inspect, writer, pageNumbering };
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run tests/feishuPageNumbering.test.js tests/manifest.test.js tests/feishuBackgroundMessages.test.js tests/feishuMessages.test.js
```

Expected: all tests PASS; legacy host lists are unchanged; Feishu top-frame routing is the only new page injection.

- [ ] **Step 5: Commit the restricted transport**

```bash
git add src/background/feishuPageNumbering.js src/content/feishuHeadingMessages.js src/content/index.js public/manifest.json tests/feishuPageNumbering.test.js tests/feishuHeadingMessages.test.js tests/manifest.test.js src/background/feishuMessages.js tests/feishuBackgroundMessages.test.js
git commit -m "feat: route Feishu heading numbering to active copy"
```

---

### Task 3: Replace the rejected API PATCH with page numbering and read-only polling

**Files:**
- Modify: `src/background/feishuOpenApiWriter.js:5-390`
- Modify: `tests/feishuOpenApiWriter.test.js:7-227`
- Modify: `tests/helpers/feishuWriteScenario.js`

**Interfaces:**
- Consumes: `numberHeading(companyName)` from Task 2.
- Keeps: `verifyJdWrite(snapshot, plan, { requireNumbering: false })` for post-create content verification.
- Produces failure stages `jd-numbering-page` and `jd-numbering-verify`.
- Bounded verification: at most five OpenAPI inspections after one page shortcut, with `wait(400)` before each additional read after the first.

- [ ] **Step 1: Rewrite writer tests first**

Update `writerSetup` to accept `numberHeading = vi.fn().mockResolvedValue({ ok: true })` and inject it into `createFeishuOpenApiWriter`.

Change the success test to assert this sequence:

```js
expect(client.request).toHaveBeenCalledTimes(2);
expect(client.request.mock.calls[0][1].stage).toBe("jd-write");
expect(numberHeading).toHaveBeenCalledOnce();
expect(numberHeading).toHaveBeenCalledWith(draft.companyName);
expect(client.request.mock.calls[1][1]).toMatchObject({
  query: { document_revision_id: values.jd.revisionId },
  stage: "summary-write"
});
expect(client.request.mock.calls.flat().join(" ")).not.toContain("update_text_style");
```

Replace the rejected-PATCH test with a page failure test:

```js
const pageError = Object.assign(new Error("当前活动标签页不是指定飞书测试副本。"), {
  stage: "jd-numbering-page",
  reason: "wrong-document",
  status: 0,
  code: 0,
  logId: ""
});
const { writer, client } = writerSetup({
  numberHeading: vi.fn().mockRejectedValue(pageError)
});
const result = await writer.write(draft);
expect(result).toMatchObject({
  ok: false,
  status: "partial",
  completedStages: [],
  failedStage: "jd-numbering-page"
});
expect(client.request).toHaveBeenCalledTimes(1);
```

Add this bounded polling test:

```js
it("polls read-only at most five times after one shortcut and stops before Portfolio", async () => {
  const values = successfulSnapshots();
  values.initial.documentId = "doc-test";
  values.unnumberedJd.documentId = "doc-test";
  const stale = Array.from({ length: 5 }, (_, index) => ({
    ...structuredClone(values.unnumberedJd),
    revisionId: values.unnumberedJd.revisionId + index
  }));
  const inspect = vi.fn()
    .mockResolvedValueOnce(values.initial)
    .mockResolvedValueOnce(values.unnumberedJd);
  for (const snapshot of stale) inspect.mockResolvedValueOnce(snapshot);
  const request = vi.fn().mockResolvedValue({});
  const numberHeading = vi.fn().mockResolvedValue({ ok: true });
  const wait = vi.fn().mockResolvedValue(undefined);
  const writer = createFeishuOpenApiWriter({ client: { request }, inspect, numberHeading, wait });

  const result = await writer.write(draft);

  expect(result).toMatchObject({ ok: false, status: "partial", failedStage: "jd-numbering-verify" });
  expect(numberHeading).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledTimes(1);
  expect(inspect).toHaveBeenCalledTimes(7);
});
```

Add this append-mode bypass test, using the existing fixture's first company as both the Portfolio and JD match and adding one new job to the post-write snapshots:

```js
it("never invokes page numbering when appending jobs", async () => {
  const current = initialSnapshot();
  current.documentId = "doc-test";
  const companyName = current.jd.companies[0].name;
  current.portfolio.companies[0].name = companyName;
  const appendDraft = { ...draft, companyName, jobs: [{ ...draft.jobs[0], title: "新增岗位" }] };
  const plan = buildFeishuOpenApiPlan(current, appendDraft);
  const afterJd = structuredClone(current);
  afterJd.revisionId += 1;
  afterJd.jd.companies[0].jobs.push({
    title: "新增岗位", ordinal: plan.jobs[0].ordinal,
    text: `（${plan.jobs[0].ordinal}）新增岗位｜上海｜社招`,
    blockId: "append-job", blockType: 5, quoteBlockId: "append-quote", index: plan.jdTarget.index
  });
  const complete = structuredClone(afterJd);
  complete.revisionId += 1;
  complete.portfolio.companies[0].jobs.push({
    title: "新增岗位", text: "新增岗位｜上海｜社招",
    blockId: "append-summary", blockType: 12, index: plan.summaryTarget.index
  });
  const inspect = vi.fn()
    .mockResolvedValueOnce(current)
    .mockResolvedValueOnce(afterJd)
    .mockResolvedValueOnce(complete);
  const numberHeading = vi.fn();
  const writer = createFeishuOpenApiWriter({
    client: { request: vi.fn().mockResolvedValue({}) },
    inspect,
    numberHeading,
    wait: vi.fn().mockResolvedValue(undefined)
  });
  await expect(writer.write(appendDraft)).resolves.toMatchObject({ ok: true, mode: "append-jobs" });
  expect(numberHeading).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run writer tests and verify RED**

Run:

```bash
npx vitest run tests/feishuOpenApiWriter.test.js
```

Expected: FAIL because the writer still issues the PATCH and has no `numberHeading` dependency or bounded read-only polling.

- [ ] **Step 3: Implement the page-assisted orchestration**

Change the writer factory signature and validation:

```js
export function createFeishuOpenApiWriter({ client, inspect, numberHeading, wait = defaultWait }) {
  if (typeof numberHeading !== "function") throw new TypeError("A Feishu page numberer is required");
  // existing guards
}
```

After `jdContentVerification` passes for a new company whose `headingSequence` is not `auto`:

```js
try {
  await numberHeading(plan.companyName);
} catch (error) {
  return failedForError({
    draft,
    plan,
    completedStages,
    stage: "jd-numbering-page",
    error,
    status: "partial",
    repairHint: error?.message || "岗位 JD 内容已写入，但飞书页面自动编号失败；已停止 Portfolio 写入。"
  });
}

afterJd = await waitForNumberedJd({ inspect, wait, plan, attempts: 5 });
if (!afterJd) {
  return makeResult({
    draft,
    plan,
    completedStages,
    status: "partial",
    failedStage: "jd-numbering-verify",
    repairHint: "飞书页面已执行编号操作，但 OpenAPI 未在限定时间内确认自动编号；已停止 Portfolio 写入。"
  });
}
```

`waitForNumberedJd` must inspect immediately once, then wait 400 ms before each remaining inspection, return the first snapshot for which `verifyJdWrite(snapshot, plan).ok` is true, and never call `numberHeading` or any write API. Remove `enableAutomaticHeadingNumbering` entirely.

Implement it exactly as:

```js
async function waitForNumberedJd({ inspect, wait, plan, attempts }) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await wait(400);
    let snapshot;
    try {
      snapshot = await inspect();
    } catch {
      return null;
    }
    if (verifyJdWrite(snapshot, plan).ok) return snapshot;
  }
  return null;
}
```

Update every direct writer construction in `tests/feishuOpenApiWriter.test.js` to pass `numberHeading: vi.fn().mockResolvedValue({ ok: true })`; Task 2 already updates the production construction.

- [ ] **Step 4: Run writer and service tests and verify GREEN**

Run:

```bash
npx vitest run tests/feishuOpenApiWriter.test.js tests/feishuBackgroundMessages.test.js tests/feishuWriteVerifier.test.js
```

Expected: all tests PASS; no writer test observes a PATCH; page numbering is called exactly once for new companies and zero times for append mode.

- [ ] **Step 5: Commit the orchestration replacement**

```bash
git add src/background/feishuOpenApiWriter.js tests/feishuOpenApiWriter.test.js tests/helpers/feishuWriteScenario.js
git commit -m "fix: verify page-assisted Feishu heading numbering"
```

---

### Task 4: Surface safe diagnostics and update user documentation

**Files:**
- Modify: `src/background/feishuOpenApiWriter.js:330-380`
- Modify: `src/sidepanel/feishuUi.js:7-60`
- Modify: `tests/feishuUi.test.js:20-66`
- Modify: `README.md:1-190`
- Modify: `docs/testing/2026-07-13-feishu-openapi-acceptance.md`

**Interfaces:**
- Writer result adds `httpStatus: number` without changing semantic `status: "success" | "failed" | "partial" | "unknown"`.
- `formatFeishuWriteStatus(result)` appends `\n诊断：...` only when at least one safe diagnostic is non-empty.

- [ ] **Step 1: Write failing diagnostic-format tests**

Extend `tests/feishuUi.test.js`:

```js
it("shows page-numbering stage and safe write diagnostics", () => {
  expect(formatFeishuWriteStatus({
    ok: false,
    status: "partial",
    failedStage: "jd-numbering-page",
    repairHint: "当前活动标签页不是指定飞书测试副本。",
    errorCode: 1770001,
    httpStatus: 400,
    logId: "safe-log"
  })).toBe(
    "部分完成：岗位 JD 内容已写入但尚未确认完成；Portfolio 区未写入。当前活动标签页不是指定飞书测试副本。\n" +
    "诊断：页面自动编号｜错误码 1770001｜HTTP 400｜Log ID safe-log"
  );
});
```

Add these two assertions:

```js
expect(formatFeishuWriteStatus({
  status: "partial",
  failedStage: "jd-numbering-verify",
  repairHint: "未确认编号",
  errorCode: 0,
  httpStatus: 0,
  logId: ""
})).toContain("诊断：自动编号校验");
expect(formatFeishuWriteStatus({
  status: "partial",
  failedStage: null,
  repairHint: "检查文档",
  errorCode: 0,
  httpStatus: 0,
  logId: ""
})).not.toContain("诊断：");
```

- [ ] **Step 2: Run UI tests and verify RED**

Run:

```bash
npx vitest run tests/feishuUi.test.js tests/feishuOpenApiWriter.test.js
```

Expected: FAIL because write results do not expose `httpStatus`, numbering phases are unlabeled, and write status omits diagnostics.

- [ ] **Step 3: Implement diagnostics without overclaiming partial JD completion**

In `makeResult`, add:

```js
httpStatus: Number.isFinite(error?.status) ? error.status : 0,
```

In `formatFeishuWriteStatus`, distinguish `completedStages.includes("jd")` from a partial result whose JD content exists but numbering failed. Use:

```js
const jdConfirmed = (result?.completedStages ?? []).includes("jd");
const prefix = jdConfirmed
  ? "部分完成：岗位 JD 区已确认写入；Portfolio 区未完成。"
  : "部分完成：岗位 JD 内容已写入但尚未确认完成；Portfolio 区未写入。";
```

Add `jd-numbering-page: "页面自动编号"` and `jd-numbering-verify: "自动编号校验"` to `phaseLabel`. Append safe diagnostics using `failedStage`, non-zero `errorCode`, non-zero `httpStatus`, and non-empty `logId`.

Use this helper and append its return value to the base status string:

```js
function formatWriteDiagnostics(result = {}) {
  const diagnostics = [];
  const stage = phaseLabel(result.failedStage);
  if (result.failedStage && stage !== "飞书操作") diagnostics.push(stage);
  if (Number.isFinite(result.errorCode) && result.errorCode !== 0) {
    diagnostics.push(`错误码 ${result.errorCode}`);
  }
  if (Number.isFinite(result.httpStatus) && result.httpStatus !== 0) {
    diagnostics.push(`HTTP ${result.httpStatus}`);
  }
  if (typeof result.logId === "string" && result.logId) {
    diagnostics.push(`Log ID ${result.logId}`);
  }
  return diagnostics.length ? `\n诊断：${diagnostics.join("｜")}` : "";
}
```

In `README.md`, replace the sentence “正式招聘文档没有写入入口，扩展也不申请飞书文档页面权限。” with:

```md
正式招聘文档没有写入入口。扩展只申请 `https://zhenfund.feishu.cn/wiki/*` 页面权限，用于在固定测试副本中为新公司的一级标题执行一次自动编号快捷键；运行时仍会校验完整测试副本 URL。
```

Replace usage step 1 “当前标签页不必停留在飞书” with these steps:

```md
1. 打开固定飞书测试副本并保持它为当前活动标签页，再打开扩展侧栏选择“飞书文档”。
2. 点击“授权飞书”或“重新授权”。
3. 点击“检查测试副本”，确认能读取文档版本和两区公司数量。
4. 粘贴并解析公司与岗位语料，检查可编辑预览字段。
5. 生成计划并确认新公司或追加岗位的位置。
6. 新公司写入时不要切换标签页：扩展先通过 OpenAPI 创建 JD，再在当前测试副本页面执行一次 `Command + Shift + 7`，最后通过 OpenAPI 确认编号后写入 Portfolio。
7. 点击“确认并写入测试副本”，在系统确认框中再次确认。
```

Replace the stale verification bullet “manifest 不含剪贴板、debugger 或飞书页面注入权限。” with:

```md
- manifest 不含剪贴板或 `debugger` 权限；飞书页面注入仅匹配 `https://zhenfund.feishu.cn/wiki/*`，运行时只接受固定测试副本。
```

Append this failure note after the existing partial/unknown notes:

```md
- “页面自动编号”失败表示 JD 内容已经创建但尚未通过完整 JD 校验，Portfolio 不会写入。不要重复提交；先删除本次不完整公司块或按提示人工修复，再重新检查文档版本。
```

In `docs/testing/2026-07-13-feishu-openapi-acceptance.md`, replace the old no-page-permission checklist item with:

```md
- [x] 生产 manifest 无剪贴板和 debugger 权限；飞书页面权限仅为 `https://zhenfund.feishu.cn/wiki/*`，且 content script 只注入顶层页面。
- [ ] 在真实测试副本中确认扩展生成的 `Command + Shift + 7` 能让新公司 Heading 1 出现自动编号。
- [ ] OpenAPI 回读确认 `sequence: "auto"` 后才写入 Portfolio。
```

- [ ] **Step 4: Run UI, manifest, and documentation consistency checks**

Run:

```bash
npx vitest run tests/feishuUi.test.js tests/manifest.test.js tests/feishuOpenApiWriter.test.js
npm run verify:legacy
rg -n "当前标签页不必停留在飞书|不申请飞书文档页面权限|无飞书页面 host|无.*飞书.*content-script" README.md docs/testing/2026-07-13-feishu-openapi-acceptance.md
```

Expected: tests and legacy check PASS; final `rg` returns no stale claims.

- [ ] **Step 5: Commit diagnostics and documentation**

```bash
git add src/background/feishuOpenApiWriter.js src/sidepanel/feishuUi.js tests/feishuUi.test.js README.md docs/testing/2026-07-13-feishu-openapi-acceptance.md
git commit -m "docs: explain page-assisted Feishu numbering"
```

---

### Task 5: Full verification, build sync, and real test-copy gate

**Files:**
- Generated build: `dist/`
- Replace generated build contents in: `/Users/vincwnt/Documents/Auto ZhenFund/飞书OpenAPI测试扩展`
- No source changes unless a failing automated check identifies a defect covered by this plan.

**Interfaces:**
- Consumes all prior tasks.
- Produces a reloadable unpacked extension and an explicit real-page feasibility result.

- [ ] **Step 1: Run the complete automated suite**

Run:

```bash
npm test
```

Expected: all test files and all tests PASS, including `verify:legacy` before Vitest.

- [ ] **Step 2: Build and verify the extension**

Run:

```bash
npm run build
```

Expected: Vite build succeeds and `scripts/verify-extension-build.mjs` exits zero. Confirm `dist/manifest.json` contains the exact Feishu wiki match and contains none of `debugger`, `clipboardRead`, or `clipboardWrite`.

- [ ] **Step 3: Sync the verified build to the user's stable unpacked-extension path**

Run:

```bash
rsync -a --delete dist/ "/Users/vincwnt/Documents/Auto ZhenFund/飞书OpenAPI测试扩展/"
diff -qr dist "/Users/vincwnt/Documents/Auto ZhenFund/飞书OpenAPI测试扩展"
```

Expected: `diff` prints nothing.

- [ ] **Step 4: Execute the real page-shortcut feasibility gate**

Before testing, have the user reload extension ID `nnfieabngjmimnogokgbccekfpdifgdb`, refresh the test-copy tab, and delete the previous incomplete CoFANCY JD block so CoFANCY is absent from both target regions.

With the test copy active, submit the two-job CoFANCY draft once. Expected observable sequence:

1. JD company block appears at the top of the JD section.
2. The company Heading 1 gains the visible `1.` numbering control without user keyboard input.
3. Existing company numbers shift automatically.
4. Portfolio receives CoFANCY only after OpenAPI confirms the numbered Heading 1.
5. The side panel reports success with `completedStages: ["jd", "summary"]` semantics.

If the page returns `shortcut-rejected` or OpenAPI never observes `sequence: "auto"`, stop. Do not add `execCommand`, toolbar-click, repeated keyboard events, clipboard, internal API calls, or `debugger`; report that the approved page-script approach is infeasible and propose the separate macOS Accessibility design.

- [ ] **Step 5: Verify append mode after new-company success**

Submit one new, non-duplicate CoFANCY job. Expected: the job appends in both regions, no second company heading is created, and no page numbering action is requested.

- [ ] **Step 6: Record final repository state**

Run:

```bash
git status --short
git log -8 --oneline
```

Expected: worktree clean; each task has its own commit; the stable extension directory exactly matches `dist`.
