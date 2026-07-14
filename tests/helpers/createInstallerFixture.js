import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SOURCE_INSTALLER = fileURLToPath(
  new URL("../../scripts/install-from-github.sh", import.meta.url)
);
const FIXED_ID = "mlhjjkclfiocgafhjdhoicghiabkeggg";
const BUILD_COMMIT = "b".repeat(40);

export async function createInstallerFixture(options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "Codex 安装 fixture-"));
  const repoRoot = path.join(root, "repo with spaces");
  const scriptsDir = path.join(repoRoot, "scripts");
  const distributionDir = path.join(repoRoot, "distribution");
  const home = path.join(root, "home with spaces");
  const installParent = path.join(
    home,
    "Library/Application Support/ZhenFund JD Assistant"
  );
  const packageName = "招聘JD发布助手-macOS-20260714";
  const packageRoot = path.join(root, "package source", packageName);
  const zipPath = path.join(root, "JD-assistant-macOS-20260714.zip");
  const extensionVersion = options.extensionVersion ?? "0.2.0";
  const versionExtensionId = options.mismatchedExtensionId
    ? "a".repeat(32)
    : FIXED_ID;

  await mkdir(scriptsDir, { recursive: true });
  await mkdir(distributionDir, { recursive: true });
  await mkdir(home, { recursive: true });
  await copyFile(SOURCE_INSTALLER, path.join(scriptsDir, "install-from-github.sh"));
  await chmod(path.join(scriptsDir, "install-from-github.sh"), 0o755);

  const helperBinary = path.join(
    packageRoot,
    "原生助手/Feishu JD Assistant Helper.app/Contents/MacOS/feishu-auth-host"
  );
  const helperInstaller = path.join(packageRoot, "scripts/install-feishu-auth-helper.sh");
  await mkdir(path.dirname(helperBinary), { recursive: true });
  await mkdir(path.dirname(helperInstaller), { recursive: true });
  await mkdir(path.join(packageRoot, "扩展"), { recursive: true });

  await writeFile(helperBinary, "#!/usr/bin/env bash\nexit 0\n", "utf8");
  await chmod(helperBinary, 0o755);
  await writeFile(
    helperInstaller,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "printf '%s\\n' \"$*\" > \"$HOME/helper-install.txt\"",
      "exit 0",
      ""
    ].join("\n"),
    "utf8"
  );
  await chmod(helperInstaller, 0o755);
  await writeFile(
    path.join(packageRoot, "扩展/manifest.json"),
    `${JSON.stringify({
      manifest_version: 3,
      name: "Fixture JD Assistant",
      version: extensionVersion
    }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(packageRoot, "扩展/background.js"),
    "globalThis.fixture = true;\n",
    "utf8"
  );
  await writeFile(
    path.join(packageRoot, "安装飞书授权助手.command"),
    "#!/usr/bin/env bash\nexit 0\n",
    "utf8"
  );
  await chmod(path.join(packageRoot, "安装飞书授权助手.command"), 0o755);
  await writeFile(path.join(packageRoot, "安装说明.md"), "# Fixture\n", "utf8");
  await writeFile(
    path.join(packageRoot, "VERSION.txt"),
    [
      "PRODUCT=招聘 JD 发布助手",
      "BUILD_DATE=20260714",
      `EXTENSION_VERSION=${extensionVersion}`,
      `EXTENSION_ID=${versionExtensionId}`,
      `REDIRECT_URL=https://${versionExtensionId}.chromiumapp.org/feishu`,
      `GIT_COMMIT=${BUILD_COMMIT}`,
      ""
    ].join("\n"),
    "utf8"
  );

  await writeInnerChecksums(packageRoot);
  if (options.tamperInnerFile) {
    await writeFile(path.join(packageRoot, "扩展/background.js"), "tampered\n", "utf8");
  }

  await execFileAsync("/usr/bin/ditto", [
    "-c",
    "-k",
    "--sequesterRsrc",
    "--keepParent",
    packageRoot,
    zipPath
  ]);
  const outerSha = createHash("sha256").update(await readFile(zipPath)).digest("hex");
  const channelSha = options.corruptOuterDigest ? "0".repeat(64) : outerSha;

  const channel = {
    schemaVersion: 1,
    repository: "FZVincent2006/JD-assistant",
    tag: "v0.2.0-codex.1",
    assetName: "JD-assistant-macOS-20260714.zip",
    assetUrl:
      "https://github.com/FZVincent2006/JD-assistant/releases/download/v0.2.0-codex.1/JD-assistant-macOS-20260714.zip",
    sha256: channelSha,
    extensionId: FIXED_ID,
    extensionVersion,
    buildCommit: BUILD_COMMIT,
    minimumMacOS: "13.0"
  };
  await writeFile(
    path.join(distributionDir, "release-channel.json"),
    `${JSON.stringify(channel, null, 2)}\n`,
    "utf8"
  );

  if (options.existingMarker) {
    await mkdir(path.join(installParent, "Extension"), { recursive: true });
    await writeFile(
      path.join(installParent, "Extension/marker.txt"),
      options.existingMarker,
      "utf8"
    );
  }

  return {
    root,
    repoRoot,
    home,
    installParent,
    installer: path.join(scriptsDir, "install-from-github.sh"),
    zipPath
  };
}

async function writeInnerChecksums(packageRoot) {
  const files = await listFiles(packageRoot);
  const lines = [];
  for (const relativePath of files.filter((value) => value !== "SHA256SUMS.txt")) {
    const digest = createHash("sha256")
      .update(await readFile(path.join(packageRoot, relativePath)))
      .digest("hex");
    lines.push(`${digest}  ${relativePath}`);
  }
  await writeFile(path.join(packageRoot, "SHA256SUMS.txt"), `${lines.join("\n")}\n`, "utf8");
}

async function listFiles(root, relativeDirectory = "") {
  const entries = await readdir(path.join(root, relativeDirectory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, relativePath));
    else if (entry.isFile()) files.push(relativePath.split(path.sep).join("/"));
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}
