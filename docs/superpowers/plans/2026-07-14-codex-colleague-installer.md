# Codex Colleague Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a colleague give the public GitHub repository URL to Codex and receive a verified macOS Chrome/Edge installation while only entering the Feishu App Secret and confirming the browser extension once.

**Architecture:** Keep the tested extension and universal native helper in a pinned GitHub Release. A repository-owned release-channel contract identifies the exact asset and digest; a dependency-free macOS shell installer validates both the outer ZIP and all inner files, preserves an existing Keychain secret, installs atomically, and hands the stable extension directory to Codex for the browser security confirmation. Repository documentation is the machine-readable handoff protocol.

**Tech Stack:** Bash 3.2-compatible shell, macOS `curl`/`ditto`/`shasum`/`plutil`/`security`/`open`, Node.js ESM for repository-side validation, Vitest, GitHub Actions on macOS, GitHub Releases.

## Global Constraints

- Support macOS Chrome and Microsoft Edge on both Apple Silicon and Intel.
- Do not require colleagues to install Node.js, Git, GitHub CLI, Swift, or Xcode Command Line Tools.
- Keep extension ID exactly `mlhjjkclfiocgafhjdhoicghiabkeggg`.
- Keep Feishu App ID exactly `cli_aade4224b8789bef`.
- Keep all Feishu writes locked to `https://zhenfund.feishu.cn/wiki/LlhrwSLIvilANZk1opwcQGlUnNv`.
- Never package, log, echo, or pass the App Secret as a command-line argument.
- Never use `curl | bash`, browser profile mutation, enterprise policies, Accessibility, Screen Recording, Input Monitoring, Full Disk Access, `debugger`, or Feishu page injection.
- Preserve the existing Boss/Maimai protected-file hashes and behavior.
- Keep the previous installed extension available until the new package, helper, and secret step succeed.
- Human actions are limited to hidden App Secret entry on first install or explicit rotation and one Chrome/Edge load-or-enable confirmation.

---

## File Structure

- Create `distribution/release-channel.json`: pinned public metadata for one installable Release asset.
- Create `scripts/release-channel.mjs`: repository-side schema and invariant validation.
- Create `tests/releaseChannel.test.js`: release-channel contract tests.
- Modify `scripts/install-feishu-auth-helper.sh`: preserve an existing Keychain item unless replacement is explicit.
- Modify `distribution/安装飞书授权助手.command`: use preserve-existing-secret behavior.
- Modify `tests/nativeHelperInstaller.test.js`: secret-policy dry-run tests.
- Create `scripts/install-from-github.sh`: dependency-free colleague installer and atomic updater.
- Create `tests/codexInstaller.test.js`: shell planning and local-package integration tests.
- Create `tests/helpers/createInstallerFixture.js`: deterministic ZIP and release-channel fixture builder.
- Create `CODEX_INSTALL.md`: exact instructions for another Codex instance.
- Modify `README.md`: top-level copyable Codex installation prompt.
- Modify `distribution/安装说明.md`: explain repository/Codex installation and fallback manual browser confirmation.
- Modify `tests/distribution.test.js`: documentation and safety-boundary regression tests.
- Modify `scripts/build-colleague-distribution.sh`: generate an ASCII Release asset name.
- Create `.github/workflows/release-colleague-package.yml`: build and attach verified universal packages to tags.
- Create `tests/releaseWorkflow.test.js`: workflow and asset-name checks.

---

### Task 1: Pinned Release Channel Contract

**Files:**
- Create: `distribution/release-channel.json`
- Create: `scripts/release-channel.mjs`
- Create: `tests/releaseChannel.test.js`

**Interfaces:**
- Consumes: repository-owned JSON with `schemaVersion`, `repository`, `tag`, `assetName`, `assetUrl`, `sha256`, `extensionId`, `extensionVersion`, `buildCommit`, and `minimumMacOS`.
- Produces: `validateReleaseChannel(value)` returning a normalized frozen object; `loadReleaseChannel(pathname)` returning the validated object.

- [ ] **Step 1: Write the failing schema and invariant tests**

```js
import { describe, expect, it } from "vitest";
import channel from "../distribution/release-channel.json";
import { validateReleaseChannel } from "../scripts/release-channel.mjs";

const FIXED_ID = "mlhjjkclfiocgafhjdhoicghiabkeggg";

describe("colleague release channel", () => {
  it("pins one asset from the owned GitHub repository", () => {
    const value = validateReleaseChannel(channel);
    expect(value.repository).toBe("FZVincent2006/JD-assistant");
    expect(value.assetUrl).toBe(
      `https://github.com/${value.repository}/releases/download/${value.tag}/${value.assetName}`
    );
    expect(value.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(value.extensionId).toBe(FIXED_ID);
    expect(value.buildCommit).toMatch(/^[0-9a-f]{40}$/);
  });

  it.each([
    ["repository", "attacker/example"],
    ["extensionId", "a".repeat(32)],
    ["sha256", "bad"],
    ["assetUrl", "https://example.com/file.zip"]
  ])("rejects an unsafe %s", (field, replacement) => {
    expect(() => validateReleaseChannel({ ...channel, [field]: replacement })).toThrow();
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/releaseChannel.test.js`

Expected: FAIL because `distribution/release-channel.json` and `scripts/release-channel.mjs` do not exist.

- [ ] **Step 3: Implement the validator**

```js
import { readFile } from "node:fs/promises";

const REPOSITORY = "FZVincent2006/JD-assistant";
const EXTENSION_ID = "mlhjjkclfiocgafhjdhoicghiabkeggg";

export function validateReleaseChannel(input) {
  if (!input || input.schemaVersion !== 1) throw new Error("Unsupported release channel schema");
  const value = { ...input };
  if (value.repository !== REPOSITORY) throw new Error("Unexpected release repository");
  if (!/^v[0-9A-Za-z][0-9A-Za-z._-]*$/.test(value.tag ?? "")) throw new Error("Invalid release tag");
  if (!/^JD-assistant-macOS-[0-9]{8}\.zip$/.test(value.assetName ?? "")) throw new Error("Invalid release asset name");
  const expectedUrl = `https://github.com/${REPOSITORY}/releases/download/${value.tag}/${value.assetName}`;
  if (value.assetUrl !== expectedUrl) throw new Error("Unexpected release asset URL");
  if (!/^[0-9a-f]{64}$/.test(value.sha256 ?? "")) throw new Error("Invalid asset SHA-256");
  if (value.extensionId !== EXTENSION_ID) throw new Error("Unexpected extension ID");
  if (!/^\d+\.\d+\.\d+$/.test(value.extensionVersion ?? "")) throw new Error("Invalid extension version");
  if (!/^[0-9a-f]{40}$/.test(value.buildCommit ?? "")) throw new Error("Invalid build commit");
  if (!/^\d+\.\d+$/.test(value.minimumMacOS ?? "")) throw new Error("Invalid macOS floor");
  return Object.freeze(value);
}

export async function loadReleaseChannel(pathname) {
  return validateReleaseChannel(JSON.parse(await readFile(pathname, "utf8")));
}
```

Seed `distribution/release-channel.json` from the currently verified Release, but use the final ASCII asset contract that Task 6 will publish:

```json
{
  "schemaVersion": 1,
  "repository": "FZVincent2006/JD-assistant",
  "tag": "v0.2.0-codex.1",
  "assetName": "JD-assistant-macOS-20260714.zip",
  "assetUrl": "https://github.com/FZVincent2006/JD-assistant/releases/download/v0.2.0-codex.1/JD-assistant-macOS-20260714.zip",
  "sha256": "70388619c669fa5b56014a709d321c0fd1b628752b72d3dc5c27d4ef3f0e8346",
  "extensionId": "mlhjjkclfiocgafhjdhoicghiabkeggg",
  "extensionVersion": "0.2.0",
  "buildCommit": "d484d0970a47644f3c2360d7af6471a7fa42d35c",
  "minimumMacOS": "13.0"
}
```

The digest and build commit are deliberately replaced with the newly built asset values in Task 6 before any colleague is told to install.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npx vitest run tests/releaseChannel.test.js`

Expected: PASS, with unsafe repository, URL, digest, and extension ID values rejected.

- [ ] **Step 5: Commit**

```bash
git add distribution/release-channel.json scripts/release-channel.mjs tests/releaseChannel.test.js
git commit -m "feat: pin colleague release channel"
```

---

### Task 2: Preserve Existing App Secret During Reinstall

**Files:**
- Modify: `scripts/install-feishu-auth-helper.sh`
- Modify: `distribution/安装飞书授权助手.command`
- Modify: `tests/nativeHelperInstaller.test.js`

**Interfaces:**
- Consumes: `--keep-existing-secret` before `chrome-extension://mlhjjkclfiocgafhjdhoicghiabkeggg/`.
- Produces: existing install behavior on first use; skips Keychain replacement when service `cn.zhenfund.jd-assistant.feishu` and account `cli_aade4224b8789bef` already exist.

- [ ] **Step 1: Add failing dry-run policy tests**

```js
async function runInstallerDryRun(origins, options = []) {
  const home = await mkdtemp(path.join(tmpdir(), "feishu-helper-test-"));
  homes.push(home);
  const { stdout, stderr } = await execFileAsync(
    "bash",
    [installer, "--dry-run", ...options, ...origins],
    { env: { ...process.env, HOME: home } }
  );
  return { output: JSON.parse(stdout), stderr, home };
}

it("declares preserve-or-configure secret behavior for colleague installs", async () => {
  const { output } = await runInstallerDryRun([CHROME_ORIGIN], ["--keep-existing-secret"]);
  expect(output.secretPolicy).toBe("keep-existing-or-configure");
});

it("keeps explicit replacement as the default administrator behavior", async () => {
  const { output } = await runInstallerDryRun([CHROME_ORIGIN]);
  expect(output.secretPolicy).toBe("configure");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/nativeHelperInstaller.test.js`

Expected: FAIL because `--keep-existing-secret` is parsed as an invalid origin and dry-run JSON lacks `secretPolicy`.

- [ ] **Step 3: Implement secret-policy parsing and Keychain presence checking**

Add constants and option parsing before origin validation:

```bash
KEYCHAIN_SERVICE="cn.zhenfund.jd-assistant.feishu"
SECRET_POLICY="configure"

if [[ "${1:-}" == "--dry-run" ]]; then
  MODE="dry-run"
  shift
fi
if [[ "${1:-}" == "--keep-existing-secret" ]]; then
  SECRET_POLICY="keep-existing-or-configure"
  shift
fi
```

Include `secretPolicy` in dry-run JSON and replace the unconditional configure call with:

```bash
configure_secret=1
if [[ "$SECRET_POLICY" == "keep-existing-or-configure" ]] \
  && /usr/bin/security find-generic-password \
    -s "$KEYCHAIN_SERVICE" -a "$APP_ID" >/dev/null 2>&1; then
  configure_secret=0
fi

if [[ "$configure_secret" -eq 1 ]]; then
  printf '%s\n' "Paste the Feishu App Secret, then press Return (input is hidden):" >&2
  "$INSTALL_BINARY" --configure-secret --app-id "$APP_ID" < /dev/tty
else
  printf '%s\n' "Existing Feishu App Secret preserved in Keychain." >&2
fi
```

Update `distribution/安装飞书授权助手.command` to pass `--keep-existing-secret` before the fixed origin.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run tests/nativeHelperInstaller.test.js tests/distribution.test.js`

Expected: PASS; dry-run leaves the temporary HOME empty and exposes only the policy name, never a secret value.

- [ ] **Step 5: Commit**

```bash
git add scripts/install-feishu-auth-helper.sh distribution/安装飞书授权助手.command tests/nativeHelperInstaller.test.js
git commit -m "feat: preserve Feishu secret on reinstall"
```

---

### Task 3: Installer Planning and Browser Selection

**Files:**
- Create: `scripts/install-from-github.sh`
- Create: `tests/codexInstaller.test.js`

**Interfaces:**
- Consumes: `--browser auto|chrome|edge`, `--dry-run`, optional `--package /absolute/path/package.zip`, optional `--replace-secret`.
- Produces: line-oriented plan or completion fields: `STATUS`, `RELEASE_TAG`, `BROWSER`, `EXTENSION_ID`, and `EXTENSION_DIR`.

- [ ] **Step 1: Write failing browser matrix and no-write dry-run tests**

```js
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const installer = fileURLToPath(new URL("../scripts/install-from-github.sh", import.meta.url));
const homes = [];

afterEach(async () => Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true }))));

async function run(args, env = {}) {
  const home = await mkdtemp(path.join(tmpdir(), "codex-installer-"));
  homes.push(home);
  const result = await execFileAsync("bash", [installer, ...args], {
    env: { ...process.env, HOME: home, ...env }
  });
  return { ...result, home };
}

it("prints a Chrome plan without touching HOME", async () => {
  const { stdout, home } = await run(["--dry-run", "--browser", "chrome"]);
  expect(stdout).toContain("STATUS=planned");
  expect(stdout).toContain("BROWSER=chrome");
  expect(stdout).toContain("EXTENSION_ID=mlhjjkclfiocgafhjdhoicghiabkeggg");
  expect(await readdir(home)).toEqual([]);
});

it("rejects non-macOS execution before planning", async () => {
  await expect(run(["--dry-run", "--browser", "chrome"], {
    JD_ASSISTANT_TEST_MODE: "1",
    JD_ASSISTANT_UNAME: "Linux"
  })).rejects.toMatchObject({ code: 2 });
});

it.each([
  ["1", "0", "1", "1", "chrome"],
  ["0", "1", "1", "1", "edge"],
  ["0", "0", "1", "0", "chrome"],
  ["0", "0", "0", "1", "edge"]
])("selects one unambiguous browser", async (runningChrome, runningEdge, installedChrome, installedEdge, expected) => {
  const { stdout } = await run(["--dry-run", "--browser", "auto"], {
    JD_ASSISTANT_TEST_MODE: "1",
    JD_ASSISTANT_RUNNING_CHROME: runningChrome,
    JD_ASSISTANT_RUNNING_EDGE: runningEdge,
    JD_ASSISTANT_INSTALLED_CHROME: installedChrome,
    JD_ASSISTANT_INSTALLED_EDGE: installedEdge
  });
  expect(stdout).toContain(`BROWSER=${expected}`);
});
```

Add rejection tests for neither browser and ambiguous dual-browser states, expecting exit code `2` and an instruction to rerun with `--browser chrome` or `--browser edge`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/codexInstaller.test.js`

Expected: FAIL because `scripts/install-from-github.sh` does not exist.

- [ ] **Step 3: Implement argument parsing, safe channel reads, browser selection, and dry-run**

The script must start with:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CHANNEL_PATH="$ROOT_DIR/distribution/release-channel.json"
FIXED_REPOSITORY="FZVincent2006/JD-assistant"
FIXED_EXTENSION_ID="mlhjjkclfiocgafhjdhoicghiabkeggg"
APP_ID="cli_aade4224b8789bef"
INSTALL_PARENT="$HOME/Library/Application Support/ZhenFund JD Assistant"
EXTENSION_DIR="$INSTALL_PARENT/Extension"
```

Use `/usr/bin/plutil -extract repository raw -o - "$CHANNEL_PATH"` and the same command for the allowlisted `tag`, `assetName`, `assetUrl`, `sha256`, `extensionId`, `extensionVersion`, `buildCommit`, and `minimumMacOS` fields. Compare repository, reconstructed asset URL, SHA format, and extension ID before any network call. Implement browser selection as a pure shell function receiving four `0|1` values; only allow test overrides when `JD_ASSISTANT_TEST_MODE=1`.

Reject any platform other than `Darwin` before reading the channel. Compare `/usr/bin/sw_vers -productVersion` with the channel's `minimumMacOS` using numeric major/minor fields. `JD_ASSISTANT_UNAME` may replace `uname` only when `JD_ASSISTANT_TEST_MODE=1`.

Dry-run must print:

```text
STATUS=planned
RELEASE_TAG=v0.2.0-codex.1
BROWSER=chrome
EXTENSION_ID=mlhjjkclfiocgafhjdhoicghiabkeggg
EXTENSION_DIR=/Users/example/Library/Application Support/ZhenFund JD Assistant/Extension
```

and exit before creating directories, reading Keychain, downloading, or opening a browser.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run tests/codexInstaller.test.js tests/releaseChannel.test.js`

Expected: PASS for explicit Chrome/Edge and all unambiguous auto states; ambiguous and missing-browser states fail with code `2`.

- [ ] **Step 5: Commit**

```bash
git add scripts/install-from-github.sh tests/codexInstaller.test.js
git commit -m "feat: plan Codex colleague installation"
```

---

### Task 4: Verified Package Install, Atomic Update, and Receipt

**Files:**
- Modify: `scripts/install-from-github.sh`
- Modify: `tests/codexInstaller.test.js`
- Create: `tests/helpers/createInstallerFixture.js`

**Interfaces:**
- Consumes: validated channel and either its HTTPS asset or `--package /absolute/path/JD-assistant-macOS-20260714.zip`.
- Produces: stable `Extension`, at most one `Extension.previous`, `install-receipt.json`, installed native helper/manifests, and `STATUS=browser_confirmation_required`.

- [ ] **Step 1: Build a deterministic local package fixture and write failing integration tests**

`createInstallerFixture.js` must create a temporary repository-shaped directory, copy the installer, build one top-level package containing `VERSION.txt`, `SHA256SUMS.txt`, `扩展/manifest.json`, a fake executable helper app, and a fake executable `scripts/install-feishu-auth-helper.sh`, then ZIP it with `ditto`. It writes a matching channel JSON next to the copied installer.

The tests must assert:

```js
it("installs a verified local package into the stable user directory", async () => {
  const fixture = await createInstallerFixture({ extensionVersion: "0.2.0" });
  homes.push(fixture.home);
  const { stdout } = await execFileAsync("bash", [
    fixture.installer,
    "--browser", "chrome",
    "--package", fixture.zipPath
  ], { env: {
    ...process.env,
    HOME: fixture.home,
    JD_ASSISTANT_TEST_MODE: "1",
    JD_ASSISTANT_NO_OPEN: "1"
  } });

  expect(stdout).toContain("STATUS=browser_confirmation_required");
  expect(await readFile(path.join(fixture.installParent, "Extension", "manifest.json"), "utf8"))
    .toContain("0.2.0");
  const receipt = JSON.parse(await readFile(path.join(fixture.installParent, "install-receipt.json"), "utf8"));
  expect(receipt.extensionId).toBe("mlhjjkclfiocgafhjdhoicghiabkeggg");
  expect(receipt.releaseTag).toBe("v0.2.0-codex.1");
});

it("keeps the previous extension when the outer digest is wrong", async () => {
  const fixture = await createInstallerFixture({ corruptOuterDigest: true, existingMarker: "old-version" });
  homes.push(fixture.home);
  await expect(execFileAsync("bash", [fixture.installer, "--browser", "edge", "--package", fixture.zipPath], {
    env: {
      ...process.env,
      HOME: fixture.home,
      JD_ASSISTANT_TEST_MODE: "1",
      JD_ASSISTANT_NO_OPEN: "1"
    }
  })).rejects.toMatchObject({ code: 1 });
  expect(await readFile(path.join(fixture.installParent, "Extension", "marker.txt"), "utf8"))
    .toBe("old-version");
});
```

Add tests for one tampered inner file, a mismatched `VERSION.txt` extension ID, paths containing spaces/Chinese, and a successful second install leaving exactly one `Extension.previous`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx vitest run tests/codexInstaller.test.js`

Expected: FAIL because the script currently stops after planning and does not validate or install packages.

- [ ] **Step 3: Implement download, dual verification, helper invocation, and atomic promotion**

Required implementation sequence:

```bash
WORK_DIR="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/jd-assistant-install.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

if [[ -n "$PACKAGE_PATH" ]]; then
  /bin/cp "$PACKAGE_PATH" "$WORK_DIR/package.zip"
else
  /usr/bin/curl --fail --location --proto '=https' --tlsv1.2 \
    --output "$WORK_DIR/package.zip" "$ASSET_URL"
fi

actual_outer_hash="$(/usr/bin/shasum -a 256 "$WORK_DIR/package.zip" | /usr/bin/awk '{print $1}')"
[[ "$actual_outer_hash" == "$EXPECTED_SHA256" ]] || fail "outer package SHA-256 mismatch"

/usr/bin/ditto -x -k "$WORK_DIR/package.zip" "$WORK_DIR/extracted"
```

Locate exactly one `VERSION.txt`, parse only known `KEY=VALUE` lines with `awk`, validate the fixed ID/tag/commit/version, and run `(cd "$PACKAGE_ROOT" && /usr/bin/shasum -a 256 -c SHA256SUMS.txt)`. Confirm required executable bits before calling:

```bash
secret_option="--keep-existing-secret"
[[ "$REPLACE_SECRET" -eq 1 ]] && secret_option=""
FEISHU_HELPER_APP_PATH="$PACKAGE_ROOT/原生助手/Feishu JD Assistant Helper.app" \
  "$PACKAGE_ROOT/scripts/install-feishu-auth-helper.sh" \
  ${secret_option:+$secret_option} \
  "chrome-extension://$FIXED_EXTENSION_ID/"
```

Stage the extension under `$INSTALL_PARENT/.Extension.new`, then use `mv` operations to keep one `$INSTALL_PARENT/Extension.previous` and promote only after helper success. Write `install-receipt.json` with fixed metadata and an ISO-8601 timestamp; never write a secret status or secret value.

The fixture test environments above must also set `JD_ASSISTANT_TEST_MODE: "1"`. Only skip `/usr/bin/open` when both test variables are present:

```bash
if [[ "${JD_ASSISTANT_NO_OPEN:-0}" == "1" ]]; then
  [[ "${JD_ASSISTANT_TEST_MODE:-0}" == "1" ]] || fail "JD_ASSISTANT_NO_OPEN is test-only"
else
  if [[ "$BROWSER" == "chrome" ]]; then
    /usr/bin/open -a "Google Chrome" "chrome://extensions/"
  else
    /usr/bin/open -a "Microsoft Edge" "edge://extensions/"
  fi
fi
```

Production completion prints:

```text
STATUS=browser_confirmation_required
BROWSER=chrome
EXTENSION_ID=mlhjjkclfiocgafhjdhoicghiabkeggg
EXTENSION_DIR=/Users/example/Library/Application Support/ZhenFund JD Assistant/Extension
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run tests/codexInstaller.test.js tests/nativeHelperInstaller.test.js`

Expected: PASS for verified install, idempotent reinstall, Unicode paths, and failure preservation; tampered packages fail before helper or stable-directory mutation.

- [ ] **Step 5: Commit**

```bash
git add scripts/install-from-github.sh tests/codexInstaller.test.js tests/helpers/createInstallerFixture.js
git commit -m "feat: install verified colleague package atomically"
```

---

### Task 5: Codex Handoff Protocol and User Documentation

**Files:**
- Create: `CODEX_INSTALL.md`
- Modify: `README.md`
- Modify: `distribution/安装说明.md`
- Modify: `tests/distribution.test.js`

**Interfaces:**
- Consumes: repository URL and the Task 3/4 installer output fields.
- Produces: one copyable prompt and deterministic Codex behavior with only the approved human pauses.

- [ ] **Step 1: Write failing documentation contract tests**

```js
it("gives colleagues one repository-to-Codex installation entry", () => {
  const readme = read("README.md");
  const protocol = read("CODEX_INSTALL.md");

  expect(readme).toContain("让 Codex 安装");
  expect(readme).toContain("https://github.com/FZVincent2006/JD-assistant");
  expect(readme).toContain("CODEX_INSTALL.md");
  expect(protocol).toContain("scripts/install-from-github.sh");
  expect(protocol).toContain("STATUS=browser_confirmation_required");
  expect(protocol).toContain("App Secret");
  expect(protocol).toContain("mlhjjkclfiocgafhjdhoicghiabkeggg");
});

it("forbids unsafe shortcuts and unnecessary build prerequisites", () => {
  const protocol = read("CODEX_INSTALL.md");
  expect(protocol).not.toMatch(/curl\s+[^\n|]+\|\s*(?:ba)?sh/);
  expect(protocol).toContain("不要安装 Node.js");
  expect(protocol).toContain("不要修改浏览器 profile");
  expect(protocol).toContain("只允许两次人工确认");
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx vitest run tests/distribution.test.js`

Expected: FAIL because `CODEX_INSTALL.md` and the README entry do not exist.

- [ ] **Step 3: Write the Codex protocol and concise human-facing docs**

`README.md` must start with this copyable prompt:

```text
请安装这个仓库中的招聘 JD 发布助手：
https://github.com/FZVincent2006/JD-assistant
按照仓库的 CODEX_INSTALL.md 执行。除 App Secret 和浏览器安全确认外，其余步骤请自动完成并验证。
```

`CODEX_INSTALL.md` must require Codex to:

1. reuse a local checkout or download the `main` source archive to a temporary directory;
2. read the protocol and inspect the shell script before execution;
3. never use `curl | bash` and never request the Secret in chat;
4. detect the active browser and run `bash scripts/install-from-github.sh --browser chrome|edge`;
5. pause for hidden terminal Secret input only when the installer asks;
6. use available browser/desktop control to load `EXTENSION_DIR`, pausing for the browser security confirmation;
7. verify the displayed fixed extension ID and enabled state;
8. report each completed check and link the fixed test document for the user's own Feishu authorization.

Update the packaged `安装说明.md` with the same security boundary and a fallback three-click manual browser path when Codex cannot control Chrome/Edge.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run tests/distribution.test.js tests/feishuDocumentation.test.js`

Expected: PASS with one recommended repository prompt and no unsafe install shortcut.

- [ ] **Step 5: Commit**

```bash
git add CODEX_INSTALL.md README.md distribution/安装说明.md tests/distribution.test.js
git commit -m "docs: add repository-to-Codex installer handoff"
```

---

### Task 6: Reproducible GitHub Release Packaging

**Files:**
- Modify: `scripts/build-colleague-distribution.sh`
- Create: `.github/workflows/release-colleague-package.yml`
- Create: `tests/releaseWorkflow.test.js`
- Modify: `distribution/release-channel.json`

**Interfaces:**
- Consumes: a tag matching `v*` or a manually supplied existing tag.
- Produces: `release/JD-assistant-macOS-YYYYMMDD.zip`, a GitHub Release asset with the same name, and a channel digest matching GitHub's reported digest.

- [ ] **Step 1: Write failing asset-name and workflow safety tests**

```js
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("colleague release workflow", () => {
  it("builds one ASCII-named universal macOS asset", () => {
    const build = read("scripts/build-colleague-distribution.sh");
    expect(build).toContain("JD-assistant-macOS-$BUILD_DATE.zip");
    expect(build).toContain("lipo");
    expect(build).toContain("codesign --verify --strict");
  });

  it("publishes only after tests and package verification", () => {
    const workflow = read(".github/workflows/release-colleague-package.yml");
    expect(workflow).toContain("macos-");
    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("scripts/build-colleague-distribution.sh");
    expect(workflow).toContain("gh release upload");
    expect(workflow).toContain("contents: write");
    expect(workflow).not.toContain("pull_request_target");
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/releaseWorkflow.test.js`

Expected: FAIL because the current ZIP name contains Chinese characters and the workflow does not exist.

- [ ] **Step 3: Use an ASCII outer asset name and add the tag workflow**

Keep the human-readable package directory name, but change only the ZIP path:

```bash
BUILD_DATE="${BUILD_DATE:-$(date -u +%Y%m%d)}"
[[ "$BUILD_DATE" =~ ^[0-9]{8}$ ]] || {
  printf '%s\n' "BUILD_DATE must use YYYYMMDD." >&2
  exit 2
}
PACKAGE_NAME="招聘JD发布助手-macOS-$BUILD_DATE"
ZIP_NAME="JD-assistant-macOS-$BUILD_DATE.zip"
ZIP_PATH="$RELEASE_DIR/$ZIP_NAME"
```

The workflow must use GitHub's macOS runner, `actions/checkout`, `actions/setup-node`, `npm ci`, and the existing build script. It creates the release when missing, otherwise uploads with `--clobber`:

```yaml
name: Release colleague package
on:
  workflow_dispatch:
    inputs:
      tag:
        description: Existing or new release tag
        required: true
permissions:
  contents: write
jobs:
  package:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ inputs.tag }}
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: BUILD_DATE="$(date -u +%Y%m%d)" scripts/build-colleague-distribution.sh
      - name: Upload verified package
        env:
          GH_TOKEN: ${{ github.token }}
          TAG: ${{ inputs.tag }}
        run: |
          asset="$(find release -maxdepth 1 -name 'JD-assistant-macOS-*.zip' -print -quit)"
          gh release view "$TAG" >/dev/null 2>&1 || gh release create "$TAG" --prerelease --title "$TAG"
          gh release upload "$TAG" "$asset" --clobber
```

Reject a manually supplied `BUILD_DATE` unless it matches `^[0-9]{8}$`, so local and workflow package names have the same format.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run tests/releaseWorkflow.test.js tests/distribution.test.js`

Expected: PASS and the workflow contains no pull-request-triggered write permission.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-colleague-distribution.sh .github/workflows/release-colleague-package.yml tests/releaseWorkflow.test.js
git commit -m "ci: publish verified colleague package"
```

- [ ] **Step 6: Run complete local verification and build the final asset**

Run:

```bash
npm test
npm run build
BUILD_DATE=20260714 scripts/build-colleague-distribution.sh
```

Expected:

- every Vitest file passes;
- Boss/Maimai protected hashes pass;
- production build passes;
- Swift helper assertions pass;
- `lipo` verifies both `arm64` and `x86_64`;
- `codesign --verify --strict` passes;
- `release/JD-assistant-macOS-20260714.zip` exists.

- [ ] **Step 7: Publish the final prerelease and replace channel digest/build commit with authoritative values**

Create tag `v0.2.0-codex.1` at the verified build commit, push it, upload the ASCII asset, then read GitHub's authoritative digest:

```bash
git tag -a v0.2.0-codex.1 -m "Codex colleague installer v0.2.0"
git push origin v0.2.0-codex.1
gh release create v0.2.0-codex.1 release/JD-assistant-macOS-20260714.zip \
  --repo FZVincent2006/JD-assistant --target v0.2.0-codex.1 --prerelease \
  --title "招聘 JD 发布助手 v0.2.0 Codex 安装版"
gh release view v0.2.0-codex.1 --repo FZVincent2006/JD-assistant --json assets,targetCommitish
```

Update only `sha256` and `buildCommit` in `distribution/release-channel.json` to the returned asset digest (without the `sha256:` prefix) and tagged commit. Re-run:

```bash
npx vitest run tests/releaseChannel.test.js tests/codexInstaller.test.js
git add distribution/release-channel.json
git commit -m "chore: activate Codex installer release channel"
```

Expected: the channel URL downloads the exact GitHub asset and both local `shasum -a 256` and GitHub's asset digest equal the committed channel digest.

---

### Task 7: End-to-End Installation Acceptance and PR Handoff

**Files:**
- Modify only if acceptance exposes a defect: the smallest file and its failing regression test.

**Interfaces:**
- Consumes: public repository URL, merged-or-PR source containing `CODEX_INSTALL.md`, final GitHub Release, one Chrome Mac, and one Edge Mac.
- Produces: evidence that a colleague can install from the repository handoff without a developer toolchain.

- [ ] **Step 1: Verify GitHub surfaces before touching a colleague machine**

Run:

```bash
gh pr view 1 --repo FZVincent2006/JD-assistant --json url,state,isDraft,headRefName,baseRefName
gh release view v0.2.0-codex.1 --repo FZVincent2006/JD-assistant --json url,isPrerelease,assets,targetCommitish
curl --fail --location --output /tmp/JD-assistant-macOS-20260714.zip \
  https://github.com/FZVincent2006/JD-assistant/releases/download/v0.2.0-codex.1/JD-assistant-macOS-20260714.zip
shasum -a 256 /tmp/JD-assistant-macOS-20260714.zip
```

Expected: PR targets `main`; Release is a prerelease; one ASCII-named ZIP exists; its digest equals `distribution/release-channel.json`.

- [ ] **Step 2: Run Chrome acceptance from the repository prompt**

On a Chrome Mac, give Codex only the repository URL and the README prompt. Confirm Codex downloads/reads the protocol, runs the installer, pauses for hidden App Secret entry, loads the stable extension directory, and asks for exactly one browser security confirmation.

Expected: extension ID is `mlhjjkclfiocgafhjdhoicghiabkeggg`, side panel opens, “授权飞书” completes with the colleague's own account, and “检查测试副本” reads the fixed test document.

- [ ] **Step 3: Run Edge acceptance from the repository prompt**

Repeat on an Edge Mac with `--browser edge` selected by Codex.

Expected: same fixed extension ID, side panel, authorization, and read-only inspection result; no Accessibility or Screen Recording prompt appears.

- [ ] **Step 4: Run upgrade/reinstall acceptance**

Run the same installation prompt again on one accepted Mac.

Expected: the installer preserves the existing Keychain item, does not ask for App Secret, retains one `Extension.previous`, repairs Native Messaging manifests, and asks only for browser reload/confirmation if Chrome/Edge requires it.

- [ ] **Step 5: Run final regression suite**

Run:

```bash
npm test
npm run build
git status --short
```

Expected: all tests/build checks pass and the worktree is clean.

- [ ] **Step 6: Commit any acceptance-only regression fix, push the branch, and update the Draft PR**

If a defect was found, first add a focused failing test, verify RED, apply the smallest fix, verify GREEN, then:

```bash
git add scripts/install-from-github.sh tests/codexInstaller.test.js
git commit -m "fix: harden Codex colleague installation"
git push origin codex/feishu-openapi-impl
```

If no defect was found, push the already committed branch without creating an empty commit. Update PR #1 with final test, release, and acceptance evidence; keep it Draft until the user approves merging into `main`.
