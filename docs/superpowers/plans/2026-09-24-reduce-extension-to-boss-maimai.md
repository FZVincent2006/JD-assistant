# Reduce Extension to Boss and Maimai Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Feishu document publishing and Outlook monitoring so the browser extension retains only JD parsing and user-reviewed Boss/Maimai field filling, while preserving the standalone JD Skill.

**Architecture:** The side panel becomes a two-platform interface and the extension no longer has a background service worker, Feishu authentication surface, Outlook content script, or native messaging dependency. The Manifest V3 package keeps only Boss/Maimai hosts and the minimum tab, side-panel, scripting, and active-tab permissions. `skills/jd-skill` remains independent of the extension.

**Tech Stack:** Manifest V3, React 19, Vite 7, Vitest 3, jsdom, JavaScript modules, macOS shell scripts.

**Spec:** `docs/superpowers/specs/2026-09-24-remove-feishu-document-publishing-design.md`

## Global Constraints

- Retain Boss and Maimai JD parsing, iframe fallback, diagnostic, click-recording, and manual final-publish behavior.
- Retain `skills/jd-skill` and `scripts/install-jd-skill.sh` unchanged.
- Remove all Feishu document publishing, OAuth, Native Messaging, Keychain, and Outlook scanning or notification capability.
- Do not request, store, document, or package an App Secret.
- Do not retain Feishu or Outlook extension host permissions, content scripts, background messages, or native-helper release artifacts.
- Keep documentation in Chinese and state clearly that final Boss/Maimai publication is manual.

## Review Focus

- An active Boss or Maimai tab must still receive filling and diagnostics after the background service worker is removed.
- The extension manifest must omit `identity`, `downloads`, `alarms`, `notifications`, `storage`, Feishu hosts, Outlook hosts, and every Feishu/Outlook content script.
- A release installer must not prompt for, preserve, or mention an App Secret or native helper.
- The independent JD Skill installer must still copy a usable `SKILL.md` into `$CODEX_HOME/skills/jd-skill`.
- Old local extension storage containing Outlook or Feishu data must be ignored rather than surfaced by the reduced UI.

---

### Task 1: Reduce the extension UI and message surface

**Files:**
- Modify: `src/sidepanel/App.jsx`
- Modify: `src/sidepanel/fillPage.js`
- Modify: `src/content/index.js`
- Delete: `src/sidepanel/OutlookMonitorPanel.jsx`
- Delete: `src/sidepanel/outlookMonitorApi.js`
- Delete: `src/sidepanel/outlookMonitorUi.js`
- Delete: `src/sidepanel/feishuUi.js`
- Delete: `src/content/feishuDocument.js`
- Delete: `src/content/feishuHeadingMessages.js`
- Delete: `src/content/feishuHeadingNumbering.js`
- Delete: `src/content/feishuMessages.js`
- Delete: `src/content/feishuScanner.js`
- Delete: `src/content/feishuWriter.js`
- Test: `tests/sidepanelReduction.test.js`
- Test: `tests/fillPage.test.js`

**Interfaces:**
- Consumes: `parseJd(input)` from `src/lib/jdParser.js` and `sendFillRequest(draft, platform)` from `src/sidepanel/fillPage.js`.
- Produces: side-panel platform state limited to `"boss" | "maimai"`; content message handling limited to fill, diagnostic, and click-recording requests.

- [ ] **Step 1: Write the failing UI-surface test**

Create `tests/sidepanelReduction.test.js` with a source-level regression test:

```js
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appPath = fileURLToPath(new URL("../src/sidepanel/App.jsx", import.meta.url));

describe("reduced side panel", () => {
  it("offers only Boss and Maimai modes", async () => {
    const source = await readFile(appPath, "utf8");
    expect(source).toContain('useState("maimai")');
    expect(source).toContain('onClick={() => setPlatform("boss")}');
    expect(source).not.toContain('setPlatform("feishu")');
    expect(source).not.toContain('setPlatform("outlook")');
    expect(source).not.toContain("OutlookMonitorPanel");
    expect(source).not.toContain("parseCompanyJdBatch");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/sidepanelReduction.test.js`

Expected: FAIL because the current side panel still contains Feishu and Outlook modes.

- [ ] **Step 3: Remove UI and document-message implementation**

In `src/sidepanel/App.jsx`, remove Feishu/Outlook imports, state, platform buttons, conditional panels, preview components, document write handlers, and the Feishu/Outlook-specific JD-text placeholder. Keep the Boss/Maimai draft editor, fill action, diagnostics, and click recording.

In `src/sidepanel/fillPage.js`, remove `sendFeishuInspectRequest`, `sendFeishuWriteRequest`, and their private helpers. Keep `sendFillRequest`, `sendDiagnosticRequest`, `startClickRecording`, and `collectClickRecording`.

In `src/content/index.js`, remove all Feishu message imports and branches. Keep the existing fill, diagnostic, and click-recording message routes.

Delete each UI/content file listed above, rather than leaving dead exports.

- [ ] **Step 4: Run focused tests to verify the reduced UI passes**

Run: `npx vitest run tests/sidepanelReduction.test.js tests/fillPage.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the UI reduction**

```bash
git add src/sidepanel src/content tests/sidepanelReduction.test.js tests/fillPage.test.js
git commit -m "refactor: remove Feishu and Outlook UI"
```

### Task 2: Remove Feishu and Outlook backend modules and restrict the manifest

**Files:**
- Modify: `public/manifest.json`
- Modify: `vite.config.js`
- Delete: `src/background.js`
- Delete: `src/background/`
- Delete: `src/lib/feishuBlockModel.js`
- Delete: `src/lib/feishuBlockRenderer.js`
- Delete: `src/lib/feishuConfig.js`
- Delete: `src/lib/feishuJobLinks.js`
- Delete: `src/lib/feishuOpenApiPlan.js`
- Delete: `src/lib/feishuPkce.js`
- Delete: `src/lib/feishuPlan.js`
- Delete: `src/lib/feishuResumeMatcher.js`
- Delete: `src/lib/feishuRichMail.js`
- Delete: `src/lib/feishuRichText.js`
- Delete: `src/lib/feishuTemplateReader.js`
- Delete: `src/lib/feishuWebhook.js`
- Delete: `src/lib/feishuWriteVerifier.js`
- Delete: `src/lib/manifestAuthMode.js`
- Delete: `src/lib/outlookDeliveryQueue.js`
- Delete: `src/lib/outlookGuiClient.js`
- Delete: `src/lib/outlookMonitorCore.js`
- Delete: `src/lib/outlookMonitorService.js`
- Delete: `src/lib/outlookPageBridge.js`
- Delete: `src/content/outlookMailDetail.js`
- Delete: `src/content/outlookMonitor.js`
- Delete: `tests/feishu*.test.js`
- Delete: `tests/outlook*.test.js`
- Delete: `tests/manifest.test.js`
- Test: `tests/manifestReduction.test.js`

**Interfaces:**
- Consumes: the retained `src/content/index.js` bundle entry.
- Produces: a manifest with one Boss/Maimai content script and no background service worker.

- [ ] **Step 1: Write the failing manifest regression test**

Create `tests/manifestReduction.test.js`:

```js
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const manifestPath = fileURLToPath(new URL("../public/manifest.json", import.meta.url));

describe("reduced extension manifest", () => {
  it("keeps only the permissions and host matches required by Boss and Maimai", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(manifest.background).toBeUndefined();
    expect(manifest.permissions).toEqual(["activeTab", "scripting", "sidePanel", "tabs"]);
    expect(manifest.host_permissions.join(" ")).not.toMatch(/feishu|outlook/i);
    expect(manifest.content_scripts).toHaveLength(1);
    expect(manifest.content_scripts[0].matches.join(" ")).toMatch(/zhipin|maimai/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/manifestReduction.test.js`

Expected: FAIL because the manifest still includes background, Outlook, Feishu, and unused permissions.

- [ ] **Step 3: Remove backend code and minimize the manifest**

Delete all Feishu and Outlook modules and their tests listed above. Delete `src/background.js` and the complete `src/background/` directory because the retained platform filler does not need a service worker.

Update `public/manifest.json` to remove `background`, `identity`, `downloads`, `alarms`, `notifications`, `storage`, Outlook and Feishu hosts, and the Outlook content script. Retain only `activeTab`, `scripting`, `sidePanel`, and `tabs`; keep Boss/Maimai host patterns and their one `content.js` content-script entry.

Update `vite.config.js` so `rollupOptions.input` includes only `index` and `content`; keep `content.js` as an explicit content-script output and remove `background.js`/`outlook.js` output handling.

- [ ] **Step 4: Run focused manifest and retained filler tests**

Run: `npx vitest run tests/manifestReduction.test.js tests/formFiller.test.js tests/jdParser.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the backend reduction**

```bash
git add public/manifest.json vite.config.js src tests
git add -u src tests
git commit -m "refactor: remove Feishu and Outlook services"
```

### Task 3: Remove native-helper and distribution dependencies while retaining JD Skill

**Files:**
- Modify: `scripts/verify-extension-build.mjs`
- Modify: `scripts/verify-legacy-integrity.mjs`
- Modify: `scripts/install-from-github.sh`
- Modify: `scripts/build-colleague-distribution.sh`
- Modify: `scripts/verify-colleague-distribution.mjs`
- Delete: `native-helper/`
- Delete: `scripts/build-feishu-auth-helper.sh`
- Delete: `scripts/install-feishu-auth-helper.sh`
- Delete: `distribution/安装飞书授权助手.command`
- Delete: `tests/nativeHelperInstaller.test.js`
- Delete: `tests/feishuDocumentation.test.js`
- Test: `tests/distributionReduction.test.js`
- Test: `tests/legacyIntegrity.test.js`

**Interfaces:**
- Consumes: a built `dist/` extension and `skills/jd-skill/SKILL.md`.
- Produces: installer/distribution validation that requires no Native Messaging app or App Secret.

- [ ] **Step 1: Write the failing distribution regression test**

Create `tests/distributionReduction.test.js`:

```js
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const installerPath = fileURLToPath(new URL("../scripts/install-from-github.sh", import.meta.url));
const skillInstallerPath = fileURLToPath(new URL("../scripts/install-jd-skill.sh", import.meta.url));

describe("reduced distribution", () => {
  it("does not install a Feishu helper and retains the JD Skill installer", async () => {
    const installer = await readFile(installerPath, "utf8");
    const skillInstaller = await readFile(skillInstallerPath, "utf8");
    expect(installer).not.toMatch(/feishu|app secret|native messaging/i);
    expect(skillInstaller).toContain('TARGET_DIR="${TARGET_ROOT}/jd-skill"');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/distributionReduction.test.js`

Expected: FAIL because the installer currently validates and installs the Feishu helper.

- [ ] **Step 3: Remove helper packaging and update verification**

Delete `native-helper/`, the two Feishu-helper scripts, its distribution command, and the tests listed above.

Rewrite `scripts/install-from-github.sh` to download and verify the fixed release package, report the stable extension directory and extension ID, but never install a helper or ask for an App Secret. Update its dry-run output and checks accordingly.

Update `scripts/build-colleague-distribution.sh` and `scripts/verify-colleague-distribution.mjs` to package only the extension, checksums, version metadata, installation guide, and JD Skill source. Update `scripts/verify-extension-build.mjs` and `scripts/verify-legacy-integrity.mjs` to assert the reduced manifest and retained Boss/Maimai baseline files without checking removed output bundles.

- [ ] **Step 4: Run focused installer, distribution, and legacy tests**

Run: `npx vitest run tests/distributionReduction.test.js tests/distribution.test.js tests/legacyIntegrity.test.js`

Expected: PASS.

- [ ] **Step 5: Commit packaging changes**

```bash
git add scripts distribution tests
git add -u native-helper scripts distribution tests
git commit -m "refactor: remove Feishu installer dependencies"
```

### Task 4: Rewrite operating documentation and validate the release build

**Files:**
- Modify: `README.md`
- Modify: `CODEX_INSTALL.md`
- Modify: `distribution/安装说明.md`
- Modify: `docs/superpowers/specs/2026-09-24-remove-feishu-document-publishing-design.md`
- Modify: `docs/superpowers/plans/2026-09-24-reduce-extension-to-boss-maimai.md`
- Test: `tests/documentationReduction.test.js`

**Interfaces:**
- Consumes: the reduced manifest, installer, build scripts, and retained JD Skill.
- Produces: operator-facing documentation that names only Boss/Maimai filling and JD Skill installation.

- [ ] **Step 1: Write the failing documentation regression test**

Create `tests/documentationReduction.test.js`:

```js
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (name) => readFile(fileURLToPath(new URL(`../${name}`, import.meta.url)), "utf8");

describe("operator documentation", () => {
  it("documents Boss/Maimai and JD Skill without Feishu or Outlook operations", async () => {
    for (const name of ["README.md", "CODEX_INSTALL.md", "distribution/安装说明.md"]) {
      const text = await read(name);
      expect(text).not.toMatch(/Outlook|飞书正式文档|App Secret|Native Messaging/i);
    }
    expect(await read("README.md")).toMatch(/Boss|脉脉/);
    expect(await read("README.md")).toMatch(/JD Skill/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/documentationReduction.test.js`

Expected: FAIL because the current operating documents describe Feishu and Outlook features.

- [ ] **Step 3: Rewrite the user-facing documents**

Rewrite `README.md` as the canonical operating guide for JD parsing, Boss/Maimai page filling, manual publishing, extension installation, JD Skill installation, development build, verification, and rollback. Rewrite `CODEX_INSTALL.md` to install only the verified extension release and require only the browser’s unpacked-extension confirmation. Rewrite `distribution/安装说明.md` to remove all helper and authorization steps.

Keep the design and plan documents as historical engineering records but ensure they accurately describe the reduced scope.

- [ ] **Step 4: Run complete verification**

Run: `npm test && npm run build`

Expected: all tests pass and the build produces `dist/index.html`, `dist/content.js`, and assets without `dist/background.js` or `dist/outlook.js`.

- [ ] **Step 5: Inspect the final package and commit documentation**

Run:

```bash
rg -n "feishu|outlook|native helper|app secret" dist public/manifest.json README.md CODEX_INSTALL.md distribution scripts -i
git status --short
```

Expected: no runtime/package references remain outside historical design records.

Then commit:

```bash
git add README.md CODEX_INSTALL.md distribution docs tests
git commit -m "docs: document Boss and Maimai only workflow"
```
