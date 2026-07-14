# 招聘 JD 发布助手同事分发 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生成一个四位同事可在 macOS Chrome/Edge 上安装的固定扩展 ID 分发包，并把现有飞书自建应用安全配置到该固定回调和四人最小可用范围。

**Architecture:** manifest 内嵌固定 RSA 公钥以稳定 Chromium 扩展 ID；生产 `dist` 与 Universal Swift 授权助手被复制到一个可双击安装的中文分发包中。飞书 OpenAPI/OAuth 行为不变，页面自动编号保持停用；飞书后台只新增固定回调、指定四人可用范围和测试副本编辑权限。

**Tech Stack:** Chrome Manifest V3、Node.js 20+、Bash、OpenSSL、Vite、Vitest、Swift Package Manager、macOS `ditto`/`codesign`/`xcrun lipo`、飞书开放平台。

## Global Constraints

- 只写入固定测试副本 `https://zhenfund.feishu.cn/wiki/LlhrwSLIvilANZk1opwcQGlUnNv`；正式文档保持无写入入口。
- 同事姓名只用于飞书后台搜索，不进入 Git、代码、构建产物、压缩包、日志或安装脚本。
- App Secret 只由管理员在每台 Mac 本地隐藏输入并保存到当前用户 Keychain，不进入压缩包或 shell 历史。
- 固定公钥进入 manifest；生成该公钥的私钥不提交、不分发、不保留在 release 目录。
- 分发包同时支持 `arm64` 与 `x86_64`，Chrome 与 Edge 使用同一个固定扩展 ID。
- 不申请辅助功能、屏幕录制、输入监控、完全磁盘访问、剪贴板或 `debugger` 权限。
- 不修改 `src/lib/jdParser.js`、`src/content/formFiller.js` 或 Boss/脉脉现有行为。
- 新固定 ID 验收前保留旧扩展目录、Native Messaging origin 和飞书 OAuth 回调。

---

### Task 1: 固定 Chromium 扩展 ID

**Files:**
- Create: `scripts/extension-id.mjs`
- Modify: `public/manifest.json`
- Create: `tests/extensionId.test.js`

**Interfaces:**
- Produces: `extensionIdFromManifestKey(key: string): string`，把 manifest 的 DER 公钥 Base64 转成 32 位 `[a-p]` Chromium ID。
- Produces: `node scripts/extension-id.mjs public/manifest.json`，标准输出仅打印固定扩展 ID。

- [ ] **Step 1: 写扩展 ID 算法失败测试**

```js
import { describe, expect, it } from "vitest";
import manifest from "../public/manifest.json";
import { extensionIdFromManifestKey } from "../scripts/extension-id.mjs";

describe("fixed Chromium extension identity", () => {
  it("derives one stable 32-letter id from the manifest public key", () => {
    expect(typeof manifest.key).toBe("string");
    expect(manifest.key.length).toBeGreaterThan(100);
    const first = extensionIdFromManifestKey(manifest.key);
    expect(first).toMatch(/^[a-p]{32}$/);
    expect(extensionIdFromManifestKey(manifest.key)).toBe(first);
  });
});
```

- [ ] **Step 2: 运行测试并确认因缺少模块或 manifest key 失败**

Run: `npx vitest run tests/extensionId.test.js`

Expected: FAIL because `scripts/extension-id.mjs` or `manifest.key` does not exist.

- [ ] **Step 3: 实现扩展 ID 算法**

```js
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function extensionIdFromManifestKey(key) {
  const publicKey = Buffer.from(String(key ?? ""), "base64");
  if (publicKey.length < 64) throw new Error("Manifest public key is missing or invalid");
  const hex = createHash("sha256").update(publicKey).digest("hex").slice(0, 32);
  return [...hex].map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16))).join("");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = JSON.parse(await readFile(process.argv[2], "utf8"));
  process.stdout.write(`${extensionIdFromManifestKey(manifest.key)}\n`);
}
```

- [ ] **Step 4: 生成一次性 RSA 私钥并只把 DER 公钥 Base64 写入 manifest**

Run from an interactive shell without printing the private key:

```bash
key_dir="$(mktemp -d)"
openssl genrsa -out "$key_dir/private.pem" 2048
openssl rsa -in "$key_dir/private.pem" -pubout -outform DER -out "$key_dir/public.der"
base64 < "$key_dir/public.der" | tr -d '\n'
rm -rf "$key_dir"
```

Use `apply_patch` to add the printed public value as top-level `public/manifest.json.key`. Confirm no `.pem`, `.der`, or private-key file exists below the repository root.

- [ ] **Step 5: 运行固定 ID 与 manifest 测试**

Run: `npx vitest run tests/extensionId.test.js tests/manifest.test.js`

Expected: both test files PASS; `node scripts/extension-id.mjs public/manifest.json` prints one 32-letter ID.

- [ ] **Step 6: 提交固定身份**

```bash
git add public/manifest.json scripts/extension-id.mjs tests/extensionId.test.js
git commit -m "feat: assign stable extension identity"
```

### Task 2: 分发包安装入口

**Files:**
- Modify: `scripts/install-feishu-auth-helper.sh`
- Create: `distribution/安装飞书授权助手.command`
- Create: `distribution/安装说明.md`
- Create: `tests/distribution.test.js`

**Interfaces:**
- Consumes: Task 1 生成并写入 `VERSION.txt` 的 `EXTENSION_ID` 行。
- Produces: `FEISHU_HELPER_APP_PATH` 环境变量，使现有安装器既支持仓库构建目录，也支持分发包的 `原生助手/`。
- Produces: 双击 `.command`，读取 `VERSION.txt` 后使用 `chrome-extension://$EXTENSION_ID/` 并调用原安装器。

- [ ] **Step 1: 写分发入口失败测试**

```js
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const installer = readFileSync(new URL("../scripts/install-feishu-auth-helper.sh", import.meta.url), "utf8");
const command = readFileSync(new URL("../distribution/安装飞书授权助手.command", import.meta.url), "utf8");
const guide = readFileSync(new URL("../distribution/安装说明.md", import.meta.url), "utf8");

describe("colleague distribution entry", () => {
  it("uses the bundled helper and fixed extension id without accessibility setup", () => {
    expect(installer).toContain("FEISHU_HELPER_APP_PATH");
    expect(command).toContain("VERSION.txt");
    expect(command).toContain("chrome-extension://");
    expect(command).toContain("FEISHU_HELPER_APP_PATH");
    expect(`${installer}\n${command}`).not.toContain("--request-accessibility");
  });

  it("documents local secret entry, both browsers, manual numbering, and rollback", () => {
    expect(guide).toContain("App Secret");
    expect(guide).toContain("Chrome");
    expect(guide).toContain("Edge");
    expect(guide).toContain("手动");
    expect(guide).toContain("旧版本");
  });
});
```

- [ ] **Step 2: 运行测试并确认缺少分发文件**

Run: `npx vitest run tests/distribution.test.js tests/nativeHelperInstaller.test.js`

Expected: FAIL because `distribution/` files and helper override do not exist.

- [ ] **Step 3: 为安装器增加包内助手路径覆盖**

Change the existing assignment to:

```bash
SOURCE_APP="${FEISHU_HELPER_APP_PATH:-$ROOT_DIR/native-helper/.build/universal/Feishu JD Assistant Helper.app}"
```

Do not change Keychain service, app ID, allowed-origin validation, uninstall behavior, or hidden secret input.

- [ ] **Step 4: 创建双击安装入口**

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_ID="$(awk -F= '$1 == "EXTENSION_ID" { print $2 }' "$ROOT_DIR/VERSION.txt")"
[[ "$EXTENSION_ID" =~ ^[a-p]{32}$ ]] || {
  printf '%s\n' "安装包中的扩展 ID 无效，请停止安装。" >&2
  read -r -p "按回车关闭窗口。" _
  exit 1
}

FEISHU_HELPER_APP_PATH="$ROOT_DIR/原生助手/Feishu JD Assistant Helper.app" \
  "$ROOT_DIR/scripts/install-feishu-auth-helper.sh" \
  "chrome-extension://$EXTENSION_ID/"

printf '%s\n' "授权助手安装完成。请完全退出并重新打开 Chrome 或 Edge。"
read -r -p "按回车关闭窗口。" _
```

- [ ] **Step 5: 创建中文安装说明**

说明必须包含：加载 `扩展/`、核对 `VERSION.txt` 固定 ID、双击安装、管理员本地输入 Secret、重启浏览器、个人飞书授权、测试副本只读检查、公司编号手动设置、Gatekeeper 官方“仍要打开”路径、旧版本回退方式。

- [ ] **Step 6: 运行 shell 与分发入口测试**

Run:

```bash
bash -n scripts/install-feishu-auth-helper.sh
bash -n distribution/安装飞书授权助手.command
npx vitest run tests/distribution.test.js tests/nativeHelperInstaller.test.js
```

Expected: all commands exit 0 and both test files PASS.

- [ ] **Step 7: 提交安装入口**

```bash
git add scripts/install-feishu-auth-helper.sh distribution tests/distribution.test.js
git commit -m "feat: add colleague installation entry"
```

### Task 3: 可复现分发包与校验文件

**Files:**
- Modify: `.gitignore`
- Create: `scripts/create-distribution-metadata.mjs`
- Create: `scripts/verify-colleague-distribution.mjs`
- Create: `scripts/build-colleague-distribution.sh`
- Modify: `tests/distribution.test.js`

**Interfaces:**
- Consumes: `extensionIdFromManifestKey()`、生产 `dist/`、Universal app bundle 和 `distribution/` 模板。
- Produces: `release/招聘JD发布助手-macOS-20260714/`、同名 `.zip`、`VERSION.txt` 和 `SHA256SUMS.txt`。
- Produces: `node scripts/verify-colleague-distribution.mjs release/招聘JD发布助手-macOS-20260714`，任何结构、ID、hash 或敏感材料异常时非零退出。

- [ ] **Step 1: 扩展失败测试覆盖打包脚本和验证器**

Append these assertions to `tests/distribution.test.js`:

```js
const gitignore = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
const buildScript = readFileSync(new URL("../scripts/build-colleague-distribution.sh", import.meta.url), "utf8");
const verifier = readFileSync(new URL("../scripts/verify-colleague-distribution.mjs", import.meta.url), "utf8");

it("builds and verifies a release without private-key material", () => {
  expect(gitignore).toContain("release/");
  expect(buildScript).toContain("npm test");
  expect(buildScript).toContain("npm run build");
  expect(buildScript).toContain("build-feishu-auth-helper.sh");
  expect(buildScript).toContain("/usr/bin/ditto");
  expect(buildScript).toContain("verify-colleague-distribution.mjs");
  expect(verifier).toMatch(/\\.(pem|p12|key)/);
  expect(verifier).toContain("BEGIN PRIVATE KEY");
});
```

- [ ] **Step 2: 运行测试并确认缺少打包工具**

Run: `npx vitest run tests/distribution.test.js`

Expected: FAIL because the metadata, verification, and build scripts do not exist.

- [ ] **Step 3: 实现元数据与 SHA-256 生成器**

`create-distribution-metadata.mjs` accepts package directory, extension ID, extension version, Git commit, and build date; it writes UTF-8 `VERSION.txt`, recursively hashes every regular file except `SHA256SUMS.txt`, sorts relative POSIX paths, and writes each line as a 64-character lowercase SHA-256 value, two spaces, then the relative POSIX path.

- [ ] **Step 4: 实现包验证器**

The verifier must:

- derive the ID from `扩展/manifest.json.key` and compare it with `VERSION.txt`;
- require zero Feishu page content scripts and the exact test-copy URL in the built background;
- verify every SHA-256 line;
- require executable `.command`, installer, and app binary;
- reject `.pem`, `.p12`, `.key`, `private.der`, `BEGIN PRIVATE KEY`, `.env.local`, access-token values, refresh-token values, and App Secret assignments;
- require `扩展/`, the Universal app, both scripts, guide, version file, and hashes.

- [ ] **Step 5: 实现构建脚本**

The Bash script runs, in order:

```bash
npm test
VITE_FEISHU_AUTH_MODE=native npm run build
scripts/build-feishu-auth-helper.sh
```

It then recreates the release directory, copies `dist` and the app with `/usr/bin/ditto`, installs scripts/templates with modes `0755` or `0644`, derives the ID, writes metadata/hashes, runs the Node verifier, verifies codesign and both architectures, and creates the zip with:

```bash
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$PACKAGE_DIR" "$ZIP_PATH"
```

- [ ] **Step 6: 运行单元测试和实际打包**

Run:

```bash
npx vitest run tests/distribution.test.js tests/extensionId.test.js tests/manifest.test.js
scripts/build-colleague-distribution.sh
```

Expected: tests PASS; build exits 0; package directory and zip both exist.

- [ ] **Step 7: 解压后独立验证**

Run with a new temporary directory:

```bash
tmp_dir="$(mktemp -d)"
/usr/bin/ditto -x -k release/招聘JD发布助手-macOS-20260714.zip "$tmp_dir"
node scripts/verify-colleague-distribution.mjs "$tmp_dir/招聘JD发布助手-macOS-20260714"
/usr/bin/codesign --verify --strict "$tmp_dir/招聘JD发布助手-macOS-20260714/原生助手/Feishu JD Assistant Helper.app"
/usr/bin/xcrun lipo "$tmp_dir/招聘JD发布助手-macOS-20260714/原生助手/Feishu JD Assistant Helper.app/Contents/MacOS/feishu-auth-host" -verify_arch arm64 x86_64
rm -rf "$tmp_dir"
```

Expected: every command exits 0.

- [ ] **Step 8: 提交打包工具**

```bash
git add .gitignore scripts/create-distribution-metadata.mjs scripts/verify-colleague-distribution.mjs scripts/build-colleague-distribution.sh tests/distribution.test.js
git commit -m "feat: build verified colleague distribution"
```

### Task 4: 完整回归和本机切换准备

**Files:**
- Modify outside Git after fixed ID is known: current-user Chrome/Edge Native Messaging manifests under `~/Library/Application Support/.../NativeMessagingHosts/`
- No source changes expected.

**Interfaces:**
- Consumes: verified fixed extension ID and release zip.
- Produces: current Mac native manifests that retain the old origin and add the new fixed origin, enabling safe side-by-side rollback.

- [ ] **Step 1: 运行完整源代码验证**

Run:

```bash
npm test
npm run verify:legacy
VITE_FEISHU_AUTH_MODE=native npm run build
git diff --check
git status --short
```

Expected: all tests pass; build succeeds; only intentional source changes are committed.

- [ ] **Step 2: 核对 release 记录**

Read `VERSION.txt` and confirm its extension ID equals `node scripts/extension-id.mjs release/招聘JD发布助手-macOS-20260714/扩展/manifest.json`; compute the zip SHA-256 for delivery.

- [ ] **Step 3: 备份并扩展本机 allowed_origins**

Set `NEW_ID` from the verified `VERSION.txt`. Read both existing Native Messaging manifests, preserve every existing origin, and add exactly `chrome-extension://$NEW_ID/`; preserve name, description, path, and type. Do not read or alter the Keychain Secret.

- [ ] **Step 4: 重新加载开发机扩展**

Sync the fixed-ID `dist` to `/Users/vincwnt/Documents/Auto ZhenFund/飞书OpenAPI测试扩展/`. The user reloads it in Edge and confirms the displayed ID equals `VERSION.txt`; keep the old build directory until acceptance.

### Task 5: 飞书应用和测试副本权限配置

**Files:**
- External state only: existing Feishu developer-console app and fixed test-copy collaborators.
- Update after completion: `docs/testing/2026-07-13-feishu-openapi-acceptance.md` with the fixed ID, callback, release hash, and read-only smoke-test outcome; do not record colleague names.

**Interfaces:**
- Consumes: new fixed extension ID, the four-person list supplied in the conversation, and existing App ID.
- Produces: published OAuth callback, four-person app availability, and four-person edit access to the fixed test copy.

- [ ] **Step 1: Discover an official Feishu configuration surface**

Search available tools for a Feishu/Lark developer-console connector. If none exists, use the signed-in browser session and navigate directly to the official Feishu developer console; do not use web search or unofficial APIs.

- [ ] **Step 2: Add the new callback without removing the old callback**

Open App ID `cli_aade4224b8789bef`, add the exact `REDIRECT_URL` from `VERSION.txt`, save, and verify both old and new callbacks remain visible.

- [ ] **Step 3: Set minimum app availability**

Search the three provided colleague names in the official user picker, add them alongside the owner, and confirm no company-wide or whole-department scope is selected. Names stay only in the external admin UI.

- [ ] **Step 4: Publish the app change**

Publish the configuration/version. If Feishu requires owner confirmation, pause for the user to complete it and then verify the version is active.

- [ ] **Step 5: Verify test-copy edit access**

Open only the fixed test copy, inspect its collaborator list, and add edit access only for missing members of the same four-person set. Do not open or change the production document.

- [ ] **Step 6: Owner smoke test without writing**

After the user reloads the fixed-ID extension and authorizes, click “检查测试副本” and generate a plan from the existing draft. Confirm authorization, document inspection, and plan generation succeed; stop before the final write confirmation.

- [ ] **Step 7: Record non-sensitive acceptance evidence**

Update the acceptance document with fixed ID, redirect URL, app publication state, package filename and SHA-256, helper architectures/signature, browser used, and smoke-test outcome. Do not include App Secret, tokens, private key, document content, or colleague names.

- [ ] **Step 8: Final verification and commit**

Run:

```bash
npm test
VITE_FEISHU_AUTH_MODE=native npm run build
git diff --check
```

Expected: all commands exit 0. Commit only the acceptance document if changed:

```bash
git add docs/testing/2026-07-13-feishu-openapi-acceptance.md
git commit -m "docs: record colleague distribution acceptance"
```
