# 飞书正式招聘文档切换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将招聘 JD 发布助手从测试副本完全切换到唯一正式招聘文档，并发布同事可通过 Codex 安装的新版本。

**Architecture:** 用单一正式文档配置作为 OpenAPI、页面辅助模块和侧边栏的共同信任边界；不增加环境开关。保留已验收的检查、计划、分阶段写入和回读校验，只更新目标、生产确认文案、构建验证与发布渠道。

**Tech Stack:** React/Vite Chrome MV3 扩展、JavaScript ESM、Vitest、飞书 OpenAPI、Bash 3.2、Swift universal native helper、GitHub Releases。

## Global Constraints

- 唯一允许的文档是 `https://zhenfund.feishu.cn/wiki/RTWjwVZjri4uCUk0J8wcn2K3n6d`。
- 不保留测试副本入口、目标切换开关或正式文档之外的写入路径。
- Boss/脉脉受保护文件和现有行为必须保持不变。
- 写入顺序仍为 JD 写入与回读校验成功后才写 Portfolio；未知结果不重试。
- App Secret 不进入仓库、聊天、参数、日志或安装回执。
- 扩展版本为 `0.2.1`，新标签为 `v0.2.1-codex.1`。
- 已发布的 `v0.2.0-codex.1` 只标记为废弃测试版，不覆盖其资产。

---

### Task 1: 正式文档单一信任边界

**Files:**
- Modify: `src/lib/feishuConfig.js`
- Modify: `src/content/feishuDocument.js`
- Modify: `src/content/feishuMessages.js`
- Modify: `src/content/feishuWriter.js`
- Modify: `src/content/feishuHeadingNumbering.js`
- Modify: `src/background/feishuOpenApiWriter.js`
- Modify: `src/background/feishuHeadingNumbering.js`
- Modify: `src/background/feishuPageNumbering.js`
- Modify: tests importing the former test-document constants
- Create: `tests/feishuProductionTarget.test.js`

**Interfaces:**
- Produces: `PRODUCTION_FEISHU_DOC_URL`, `PRODUCTION_FEISHU_WIKI_TOKEN`, and `isProductionFeishuDocument(url)` from `src/lib/feishuConfig.js`.
- Consumes: all Feishu read/write entry points use the same production URL and predicate.

- [ ] **Step 1: Write the failing production-target test**

```js
import { describe, expect, it } from "vitest";
import {
  PRODUCTION_FEISHU_DOC_URL,
  PRODUCTION_FEISHU_WIKI_TOKEN,
  isProductionFeishuDocument
} from "../src/lib/feishuConfig.js";

describe("production Feishu document target", () => {
  it("allows only the fixed production wiki document", () => {
    expect(PRODUCTION_FEISHU_DOC_URL).toBe(
      "https://zhenfund.feishu.cn/wiki/RTWjwVZjri4uCUk0J8wcn2K3n6d"
    );
    expect(PRODUCTION_FEISHU_WIKI_TOKEN).toBe("RTWjwVZjri4uCUk0J8wcn2K3n6d");
    expect(isProductionFeishuDocument(`${PRODUCTION_FEISHU_DOC_URL}?fromScene=spaceOverview#block`))
      .toBe(true);
    expect(isProductionFeishuDocument(
      "https://zhenfund.feishu.cn/wiki/LlhrwSLIvilANZk1opwcQGlUnNv"
    )).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx vitest run tests/feishuProductionTarget.test.js`

Expected: FAIL because the production exports do not exist.

- [ ] **Step 3: Replace the configuration and all consumers**

Use this exact configuration API:

```js
export const PRODUCTION_FEISHU_DOC_URL =
  "https://zhenfund.feishu.cn/wiki/RTWjwVZjri4uCUk0J8wcn2K3n6d";
export const PRODUCTION_FEISHU_WIKI_TOKEN = "RTWjwVZjri4uCUk0J8wcn2K3n6d";

export function isProductionFeishuDocument(url = "") {
  try {
    const candidate = new URL(url);
    const allowed = new URL(PRODUCTION_FEISHU_DOC_URL);
    return candidate.origin === allowed.origin && candidate.pathname === allowed.pathname;
  } catch {
    return false;
  }
}
```

Rename every source and test import of `TEST_FEISHU_DOC_URL`, `TEST_FEISHU_WIKI_TOKEN`, and `isTestFeishuDocument`. Change guard errors to “仅允许操作/写入指定正式招聘文档”，without weakening the guard.

- [ ] **Step 4: Run focused and Feishu regression tests**

Run:

```bash
npx vitest run \
  tests/feishuProductionTarget.test.js \
  tests/feishuDocument.test.js \
  tests/feishuMessages.test.js \
  tests/feishuWriter.test.js \
  tests/feishuOpenApiWriter.test.js \
  tests/feishuHeadingNumbering.test.js \
  tests/feishuPageNumbering.test.js
```

Expected: PASS; the old test URL is rejected.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat: lock Feishu writes to production document"
```

---

### Task 2: 正式环境按钮、提示与文档

**Files:**
- Modify: `src/sidepanel/App.jsx`
- Modify: `src/sidepanel/feishuUi.js`
- Modify: `src/background/feishuMessages.js`
- Modify: `src/background/feishuOpenApiWriter.js`
- Modify: `src/background/feishuPageNumbering.js`
- Modify: `src/content/feishuHeadingNumbering.js`
- Modify: `README.md`
- Modify: `CODEX_INSTALL.md`
- Modify: `distribution/安装说明.md`
- Modify: `scripts/verify-colleague-distribution.mjs`
- Modify: `tests/feishuUi.test.js`
- Modify: `tests/distribution.test.js`
- Modify: `tests/feishuDocumentation.test.js`
- Modify: `tests/manifest.test.js`
- Create: `tests/feishuProductionCopy.test.js`

**Interfaces:**
- Consumes: `PRODUCTION_FEISHU_DOC_URL` from Task 1.
- Produces: production-only buttons, confirmation copy, recovery messages, docs, and build-token verification.

- [ ] **Step 1: Write failing production-copy tests**

```js
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("production Feishu operator copy", () => {
  it("shows only the production document actions", () => {
    const app = read("src/sidepanel/App.jsx");
    expect(app).toContain("检查正式招聘文档");
    expect(app).toContain("确认并写入正式招聘文档");
    expect(app).toContain("仅写入正式招聘文档");
    expect(app).not.toContain("测试副本");
  });

  it("removes the test token from runtime source and operator docs", () => {
    const paths = [
      "src/lib/feishuConfig.js",
      "src/sidepanel/App.jsx",
      "src/background/feishuOpenApiWriter.js",
      "README.md",
      "CODEX_INSTALL.md",
      "distribution/安装说明.md"
    ];
    for (const path of paths) {
      expect(read(path), path).not.toContain("LlhrwSLIvilANZk1opwcQGlUnNv");
    }
  });
});
```

Extend `tests/feishuUi.test.js` so the fallback is `请检查正式招聘文档。`. Extend distribution tests so the verifier requires production token and rejects the old token.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npx vitest run tests/feishuProductionCopy.test.js tests/feishuUi.test.js tests/distribution.test.js
```

Expected: FAIL on old button text, old URL, and old fallback.

- [ ] **Step 3: Implement production copy and documentation**

Use these exact primary labels:

```text
固定目标：正式招聘文档
正式招聘文档
检查正式招聘文档
确认并恢复正式招聘文档
确认并写入正式招聘文档
仅写入正式招聘文档。确认继续？
```

Replace all operational “测试副本” references with “正式招聘文档” or “正式文档” as grammatically appropriate. Update the build verifier to require `RTWjwVZjri4uCUk0J8wcn2K3n6d` and fail if `LlhrwSLIvilANZk1opwcQGlUnNv` is present in extension JavaScript.

- [ ] **Step 4: Run focused documentation/UI tests**

Run:

```bash
npx vitest run \
  tests/feishuProductionCopy.test.js \
  tests/feishuUi.test.js \
  tests/distribution.test.js \
  tests/feishuDocumentation.test.js \
  tests/manifest.test.js
```

Expected: PASS and no operator-facing test URL remains.

- [ ] **Step 5: Commit**

```bash
git add src README.md CODEX_INSTALL.md distribution scripts tests
git commit -m "feat: present production Feishu workflow"
```

---

### Task 3: Version 0.2.1 and release contract tests

**Files:**
- Modify: `public/manifest.json`
- Modify: `tests/manifest.test.js`
- Modify: `tests/releaseChannel.test.js`
- Modify after publishing: `distribution/release-channel.json`

**Interfaces:**
- Produces: extension version `0.2.1`; final channel tag `v0.2.1-codex.1` and an authoritative asset digest.

- [ ] **Step 1: Add a failing manifest-version assertion**

```js
expect(manifest.version).toBe("0.2.1");
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx vitest run tests/manifest.test.js`

Expected: FAIL because the manifest is still `0.2.0`.

- [ ] **Step 3: Bump only the extension version**

Change `public/manifest.json` from `0.2.0` to `0.2.1`. Do not change package manager versions or the manifest key that produces the fixed extension ID.

- [ ] **Step 4: Run version and extension-ID tests**

Run: `npx vitest run tests/manifest.test.js tests/extensionId.test.js`

Expected: PASS with version `0.2.1` and ID `mlhjjkclfiocgafhjdhoicghiabkeggg`.

- [ ] **Step 5: Commit**

```bash
git add public/manifest.json tests/manifest.test.js
git commit -m "chore: bump production extension to 0.2.1"
```

---

### Task 4: Complete verification and immutable production Release

**Files:**
- Generated: `release/JD-assistant-macOS-20260714.zip`
- Modify: GitHub Release notes for `v0.2.0-codex.1`
- Create externally: tag and prerelease `v0.2.1-codex.1`
- Modify: `distribution/release-channel.json`

**Interfaces:**
- Consumes: verified extension commit and build script.
- Produces: immutable production asset, GitHub digest, and active release channel.

- [ ] **Step 1: Run all local verification and build the asset**

Run:

```bash
npm test
npm run build
BUILD_DATE=20260714 scripts/build-colleague-distribution.sh
```

Expected: all Vitest tests and Boss/脉脉 hashes pass; production build passes; native helper reports 64 tests; `lipo` verifies arm64/x86_64; codesign verification passes; the ASCII ZIP exists.

- [ ] **Step 2: Inspect the package before publication**

Run:

```bash
/usr/bin/shasum -a 256 release/JD-assistant-macOS-20260714.zip
unzip -p release/JD-assistant-macOS-20260714.zip '*/VERSION.txt'
```

Expected: VERSION shows `EXTENSION_VERSION=0.2.1`, fixed ID, fixed redirect URL, and the current 40-character commit.

- [ ] **Step 3: Mark the old prerelease as a superseded test build**

Use `gh release edit v0.2.0-codex.1` so its title begins with `[已废弃测试版]` and its notes say it targets the former test copy and must not be installed by colleagues. Do not delete or replace its asset.

- [ ] **Step 4: Tag and publish the production asset**

```bash
git tag -a v0.2.1-codex.1 -m "Production Feishu document installer v0.2.1"
git push origin v0.2.1-codex.1
gh release create v0.2.1-codex.1 release/JD-assistant-macOS-20260714.zip \
  --repo FZVincent2006/JD-assistant --verify-tag --prerelease \
  --title "招聘 JD 发布助手 v0.2.1 正式文档版"
```

Expected: a new Release URL; no existing tag or asset is overwritten.

- [ ] **Step 5: Read the authoritative digest and activate the channel**

Run:

```bash
gh release view v0.2.1-codex.1 --repo FZVincent2006/JD-assistant \
  --json assets,targetCommitish,url
```

Update `distribution/release-channel.json` to:

- `tag`: `v0.2.1-codex.1`
- `assetName`: `JD-assistant-macOS-20260714.zip`
- matching GitHub asset URL
- `sha256`: GitHub digest without the `sha256:` prefix
- `extensionVersion`: `0.2.1`
- `buildCommit`: the tagged commit from VERSION.txt

- [ ] **Step 6: Test and commit channel activation**

Run:

```bash
npx vitest run tests/releaseChannel.test.js tests/codexInstaller.test.js
git add distribution/release-channel.json tests/releaseChannel.test.js
git commit -m "chore: activate production installer release"
```

Expected: tests pass and the channel downloads exactly the published production asset.

---

### Task 5: Formal-document read-only acceptance and GitHub handoff

**Files:**
- Modify only if acceptance exposes a defect: the smallest source file and a failing regression test.

**Interfaces:**
- Consumes: production build, formal document, fixed-ID extension, and public Release.
- Produces: evidence for formal target recognition without a test write, plus a repository branch/PR ready for installation.

- [ ] **Step 1: Perform a read-only formal document inspection**

Open `https://zhenfund.feishu.cn/wiki/RTWjwVZjri4uCUk0J8wcn2K3n6d`, authorize the built extension if needed, and click “检查正式招聘文档”.

Expected: it reports a revision ID, Portfolio company count, and JD company count; it does not create, update, or delete blocks.

- [ ] **Step 2: Verify public asset bytes**

Download the Release asset to a temporary directory, compare local SHA-256 to `distribution/release-channel.json`, extract it, and run `scripts/verify-colleague-distribution.mjs` against the extracted package.

Expected: outer hash, inner hashes, production token, fixed extension ID, version, redirect URL, universal helper, and signature all pass.

- [ ] **Step 3: Run final regression from a clean status**

```bash
git diff --check
npm test
npm run build
git status --short
```

Expected: 100% tests pass, Boss/脉脉 protected hashes pass, build passes, and only expected generated ignored files exist.

- [ ] **Step 4: Push and update the existing pull request**

```bash
git push origin codex/feishu-openapi-impl
gh pr view 1 --repo FZVincent2006/JD-assistant
```

Update PR #1 summary with the formal-document target, fixed ID, Release URL, test counts, and read-only acceptance result. Keep the branch mergeable and do not tell colleagues to use the main-branch repository prompt until the installer files are on `main`.

- [ ] **Step 5: Finish the development branch**

Invoke `superpowers:verification-before-completion`, then `superpowers:finishing-a-development-branch`. Use their final verification and integration workflow before claiming the repository link is ready for colleagues.
