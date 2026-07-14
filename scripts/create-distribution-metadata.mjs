import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [packageDirArg, extensionId, extensionVersion, gitCommit, buildDate] = process.argv.slice(2);
if (!packageDirArg || !/^[a-p]{32}$/.test(extensionId ?? "")) {
  throw new Error("Usage: create-distribution-metadata <package-dir> <extension-id> <version> <commit> <date>");
}

const packageDir = path.resolve(packageDirArg);
const versionLines = [
  "PRODUCT=招聘 JD 发布助手",
  `BUILD_DATE=${buildDate}`,
  `EXTENSION_VERSION=${extensionVersion}`,
  `EXTENSION_ID=${extensionId}`,
  `REDIRECT_URL=https://${extensionId}.chromiumapp.org/feishu`,
  `GIT_COMMIT=${gitCommit}`,
  ""
];
await writeFile(path.join(packageDir, "VERSION.txt"), versionLines.join("\n"), "utf8");

const files = await listRegularFiles(packageDir);
const hashLines = [];
for (const relativePath of files.filter((value) => value !== "SHA256SUMS.txt")) {
  const data = await readFile(path.join(packageDir, relativePath));
  hashLines.push(`${createHash("sha256").update(data).digest("hex")}  ${relativePath}`);
}
await writeFile(path.join(packageDir, "SHA256SUMS.txt"), `${hashLines.join("\n")}\n`, "utf8");

async function listRegularFiles(root, relativeDirectory = "") {
  const entries = await readdir(path.join(root, relativeDirectory), { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory.split(path.sep).join(path.posix.sep), entry.name);
    if (entry.isDirectory()) {
      results.push(...await listRegularFiles(root, relativePath));
    } else if (entry.isFile()) {
      results.push(relativePath);
    } else {
      throw new Error(`Distribution contains unsupported filesystem entry: ${relativePath}`);
    }
  }
  return results.sort((left, right) => left.localeCompare(right, "en"));
}
