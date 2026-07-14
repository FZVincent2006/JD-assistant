# Feishu UI Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two ambiguous manual document-check actions with a guided authorization → parse → automatic preflight plan → confirmed write workflow, while exposing a manual document link only after outcomes that require human inspection.

**Architecture:** Keep all OpenAPI inspection, planning, revision matching, write ordering, and read-back verification unchanged. Simplify only the React side-panel orchestration and copy, add one pure result predicate in `feishuUi.js`, and retain the background `FEISHU_INSPECT` interface for compatibility even though the normal UI no longer invokes it.

**Tech Stack:** React 19, Vite 7, Vitest 3, Chrome/Edge Manifest V3, Feishu OpenAPI, macOS native messaging helper.

## Global Constraints

- Do not modify `src/lib/jdParser.js` or `src/content/formFiller.js`; Boss/脉脉 behavior must remain byte-for-byte protected by `npm run verify:legacy`.
- Keep the production document fixed at `https://zhenfund.feishu.cn/wiki/RTWjwVZjri4uCUk0J8wcn2K3n6d`.
- Keep plan preview and the final browser confirmation separate; do not combine planning and writing into one click.
- Do not remove `FEISHU_INSPECT` background support or change Feishu write/verification behavior.
- Show a manual document link only for partial, unknown, or verification-failure write outcomes.
- Publish the simplified build through the pinned repository release channel so colleague installations receive the same interface.

---

### Task 1: Result-aware manual document link

**Files:**
- Modify: `tests/feishuUi.test.js`
- Modify: `src/sidepanel/feishuUi.js`

**Interfaces:**
- Consumes: the existing write result shape `{ status, failedStage, completedStages }`.
- Produces: `shouldOfferFeishuDocumentCheck(result): boolean`, consumed by the React preview.

- [ ] **Step 1: Write the failing predicate tests**

Add `shouldOfferFeishuDocumentCheck` to the test import and add:

```js
describe("manual Feishu document check", () => {
  it("offers the document only for partial, unknown, or verification failures", () => {
    expect(shouldOfferFeishuDocumentCheck({ status: "partial" })).toBe(true);
    expect(shouldOfferFeishuDocumentCheck({ status: "unknown" })).toBe(true);
    expect(shouldOfferFeishuDocumentCheck({ status: "failed", failedStage: "jd-verify" })).toBe(true);
    expect(shouldOfferFeishuDocumentCheck({ status: "failed", failedStage: "summary-verify" })).toBe(true);
    expect(shouldOfferFeishuDocumentCheck({ status: "success" })).toBe(false);
    expect(shouldOfferFeishuDocumentCheck({ status: "failed", failedStage: "preflight" })).toBe(false);
    expect(shouldOfferFeishuDocumentCheck(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run tests/feishuUi.test.js
```

Expected: FAIL because `shouldOfferFeishuDocumentCheck` is not exported.

- [ ] **Step 3: Add the minimal pure predicate**

Add to `src/sidepanel/feishuUi.js`:

```js
export function shouldOfferFeishuDocumentCheck(result) {
  return result?.status === "partial"
    || result?.status === "unknown"
    || result?.failedStage === "jd-verify"
    || result?.failedStage === "summary-verify";
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npx vitest run tests/feishuUi.test.js
```

Expected: all tests in `tests/feishuUi.test.js` PASS.

### Task 2: Simplify the React workflow

**Files:**
- Modify: `tests/feishuProductionCopy.test.js`
- Modify: `src/sidepanel/App.jsx`
- Modify: `src/sidepanel/styles.css`

**Interfaces:**
- Consumes: `shouldOfferFeishuDocumentCheck(result)` and `PRODUCTION_FEISHU_DOC_URL`.
- Produces: a side panel with one authorization action, one automatic-preflight plan action, and a conditional recovery link.

- [ ] **Step 1: Write failing source-contract tests**

Replace the production action assertions with:

```js
it("shows a guided production workflow without standalone document checks", () => {
  const app = read("src/sidepanel/App.jsx");

  expect(app).toContain("检查并生成写入计划");
  expect(app).toContain("确认并写入正式招聘文档");
  expect(app).toContain("打开正式文档检查");
  expect(app).toContain("仅写入正式招聘文档");
  expect(app).not.toContain("打开文档检查");
  expect(app).not.toContain("sendFeishuInspectRequest");
  expect(app).not.toContain("onInspect");
  expect(app).not.toMatch(/<button[^>]*>\s*检查正式招聘文档\s*<\/button>/);
  expect(app).not.toContain("测试副本");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run tests/feishuProductionCopy.test.js
```

Expected: FAIL because the current component still imports and renders the standalone inspection action and old plan copy.

- [ ] **Step 3: Remove standalone inspection orchestration**

In `src/sidepanel/App.jsx`:

- Remove `sendFeishuInspectRequest` from the `fillPage.js` import.
- Remove `inspectFeishuDocument()`.
- Change authorization success copy to `飞书授权成功，请粘贴并解析公司与岗位语料。`.
- Change planning progress copy to `正在检查正式招聘文档并生成块级写入计划…`.
- Change invalid-write copy to `请先完成授权，并生成与当前文档版本一致的有效计划。`.
- Pass only `authStatus`, `writing`, and `onAuthorize` to `FeishuAccessPanel`.

- [ ] **Step 4: Render only the current authorization action**

Replace the access panel with the following behavior:

```jsx
function FeishuAccessPanel({ authStatus, writing, onAuthorize }) {
  const authorized = authStatus === "authorized";
  const checking = authStatus === "checking" || authStatus === "authorizing";
  return (
    <section className="panel feishuAccess">
      <div className="environmentBadge">固定目标：正式招聘文档</div>
      <div className={`authState ${authorized ? "authorized" : ""}`}>
        <KeyRound size={16} />
        <span>{authStatusLabel(authStatus)}</span>
        {authorized && (
          <button className="inlineAction" type="button" onClick={onAuthorize} disabled={checking || writing}>
            重新授权
          </button>
        )}
      </div>
      {!authorized && (
        <button className="secondary" type="button" onClick={onAuthorize} disabled={checking || writing}>
          {authStatus === "expired" ? "重新授权" : "授权飞书"}
        </button>
      )}
      <p className="helperText">生成写入计划时会自动检查正式文档、权限、模板和重复岗位。</p>
    </section>
  );
}
```

- [ ] **Step 5: Add the conditional recovery link and new plan copy**

Import `shouldOfferFeishuDocumentCheck`. After the existing `writeResult` status block, render:

```jsx
{shouldOfferFeishuDocumentCheck(writeResult) && (
  <a className="secondary manualDocumentCheck" href={PRODUCTION_FEISHU_DOC_URL} target="_blank" rel="noreferrer">
    <ExternalLink size={15} />
    打开正式文档检查
  </a>
)}
```

Change the plan action label to:

```jsx
检查并生成写入计划
```

Update `src/sidepanel/styles.css` so `.authState .inlineAction` is a borderless, right-aligned text button and `.manualDocumentCheck` is a centered flex link. Remove unused `.documentTarget`, `.actionGrid`, and `.inspectionSummary` rules.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run tests/feishuUi.test.js tests/feishuProductionCopy.test.js
```

Expected: both test files PASS.

### Task 3: Align operator documentation and extension version

**Files:**
- Modify: `README.md`
- Modify: `CODEX_INSTALL.md`
- Modify: `distribution/安装说明.md`
- Modify: `public/manifest.json`
- Modify: `tests/feishuProductionCopy.test.js`

**Interfaces:**
- Consumes: the simplified UI labels from Task 2.
- Produces: operator instructions for version `0.2.2` without standalone inspection steps.

- [ ] **Step 1: Add failing version and documentation assertions**

Extend `tests/feishuProductionCopy.test.js`:

```js
it("documents automatic planning checks in version 0.2.2", () => {
  const manifest = JSON.parse(read("public/manifest.json"));
  expect(manifest.version).toBe("0.2.2");

  for (const path of ["README.md", "CODEX_INSTALL.md", "distribution/安装说明.md"]) {
    const text = read(path);
    expect(text, path).toContain("检查并生成写入计划");
    expect(text, path).not.toContain("点击“检查正式招聘文档”");
  }
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run tests/feishuProductionCopy.test.js
```

Expected: FAIL because the manifest is `0.2.1` and operator docs still require the standalone inspection button.

- [ ] **Step 3: Update version and instructions**

- Set `public/manifest.json` version to `0.2.2` and change its description from “指定飞书招聘测试文档” to “正式飞书招聘文档”.
- In all three operator documents, describe the normal path as authorization → parse → `检查并生成写入计划` → confirm write.
- State that the manual document link appears only for partial, unknown, or verification-failure outcomes.
- Keep the requirement to perform a read-only plan check after first installation, but use `检查并生成写入计划` with a valid draft rather than the removed inspection button.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npx vitest run tests/feishuProductionCopy.test.js
```

Expected: PASS.

### Task 4: Full verification and distribution release

**Files:**
- Modify: `distribution/release-channel.json` after the release asset is uploaded.
- Generated and ignored: `dist/`, `release/`.

**Interfaces:**
- Consumes: tested source at version `0.2.2` and the fixed extension key.
- Produces: a verified `v0.2.2-codex.1` asset and a pinned release channel containing its exact SHA-256 and build commit.

- [ ] **Step 1: Run the complete local verification**

Run:

```bash
npm test
VITE_FEISHU_AUTH_MODE=native npm run build
bash scripts/build-feishu-auth-helper.sh
```

Expected: legacy integrity passes, all Vitest files pass, both Vite builds pass, build verifier passes, and the universal helper passes its assertions/signature/architecture checks.

- [ ] **Step 2: Commit the tested source**

```bash
git add src/sidepanel/App.jsx src/sidepanel/feishuUi.js src/sidepanel/styles.css tests/feishuUi.test.js tests/feishuProductionCopy.test.js README.md CODEX_INSTALL.md distribution/安装说明.md public/manifest.json docs/superpowers/plans/2026-07-14-feishu-ui-simplification.md
git commit -m "feat: simplify Feishu document workflow"
```

- [ ] **Step 3: Build and verify the colleague archive from the source commit**

Run:

```bash
BUILD_DATE=20260714 scripts/build-colleague-distribution.sh
shasum -a 256 release/JD-assistant-macOS-20260714.zip
```

Expected: package verification passes, the fixed extension ID is `mlhjjkclfiocgafhjdhoicghiabkeggg`, the packaged version is `0.2.2`, and one SHA-256 is printed.

- [ ] **Step 4: Publish the new prerelease and pin the channel**

Create tag `v0.2.2-codex.1` at the source commit, create a prerelease titled `招聘 JD 发布助手 v0.2.2 简化流程版`, and upload `release/JD-assistant-macOS-20260714.zip`. Update `distribution/release-channel.json` to the new tag, URL, SHA-256, version `0.2.2`, and source commit.

- [ ] **Step 5: Verify the public asset and installer contract**

Download the Release asset to a fresh temporary path, compare its SHA-256 with `distribution/release-channel.json`, run `scripts/verify-colleague-distribution.mjs` on the extracted directory, and run:

```bash
bash scripts/install-from-github.sh --dry-run --browser edge
```

Expected: all package hashes and metadata pass; the dry run reports version `0.2.2`, the fixed extension ID, the new tag, and the stable installation directory.

- [ ] **Step 6: Commit channel metadata and push for review**

```bash
git add distribution/release-channel.json
git commit -m "chore: publish simplified Feishu installer"
git push origin codex/feishu-openapi-impl
```

Expected: the branch contains only the reviewed UI/docs/version changes plus exact release-channel metadata, ready to merge into `main`.
