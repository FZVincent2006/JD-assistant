import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { extensionIdFromManifestKey } from "./extension-id.mjs";

const packageDir = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Usage: verify-colleague-distribution <package-dir>");

const requiredFiles = [
  "扩展/manifest.json",
  "扩展/index.html",
  "扩展/content.js",
  "skills/jd-skill/SKILL.md",
  "安装说明.md",
  "VERSION.txt",
  "SHA256SUMS.txt"
];
for (const relativePath of requiredFiles) await requireRegularFile(relativePath);

const version = parseKeyValue(await readFile(path.join(packageDir, "VERSION.txt"), "utf8"));
if (!/^[a-p]{32}$/.test(version.EXTENSION_ID ?? "")) throw new Error("VERSION.txt has an invalid extension ID");
const manifest = JSON.parse(await readFile(path.join(packageDir, "扩展/manifest.json"), "utf8"));
if (extensionIdFromManifestKey(manifest.key) !== version.EXTENSION_ID) {
  throw new Error("Packaged manifest key does not match VERSION.txt");
}
if (manifest.background) throw new Error("Reduced extension must not contain a background worker");
if ((manifest.content_scripts ?? []).length !== 1) throw new Error("Package must contain one recruiting content script");
if ((manifest.permissions ?? []).some((permission) => ["alarms", "downloads", "identity", "notifications", "storage"].includes(permission))) {
  throw new Error("Package contains a removed permission");
}

const allFiles = await listRegularFiles(packageDir);
for (const relativePath of allFiles) {
  if (/(^|\/)(?:\.env\.local|private\.der)$/i.test(relativePath)
    || /\.(?:pem|p12|key)$/i.test(relativePath)) {
    throw new Error(`Distribution contains forbidden private material: ${relativePath}`);
  }
  const data = await readFile(path.join(packageDir, relativePath));
  if (data.length <= 2_000_000 && !data.includes(0)) {
    const text = data.toString("utf8");
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)
      || /"(?:accessToken|refreshToken)"\s*:\s*"[^"\s]{16,}"/.test(text)) {
      throw new Error(`Distribution contains sensitive material: ${relativePath}`);
    }
  }
}

const expectedHashFiles = allFiles.filter((value) => value !== "SHA256SUMS.txt").sort(comparePaths);
const hashText = await readFile(path.join(packageDir, "SHA256SUMS.txt"), "utf8");
const hashEntries = hashText.trimEnd().split("\n").map((line) => {
  const match = line.match(/^([0-9a-f]{64})  (.+)$/);
  if (!match) throw new Error("SHA256SUMS.txt contains an invalid line");
  return { expected: match[1], relativePath: match[2] };
});
if (hashEntries.map((entry) => entry.relativePath).sort(comparePaths).join("\n") !== expectedHashFiles.join("\n")) {
  throw new Error("SHA256SUMS.txt does not cover every packaged file exactly once");
}
for (const entry of hashEntries) {
  const data = await readFile(path.join(packageDir, entry.relativePath));
  const actual = createHash("sha256").update(data).digest("hex");
  if (actual !== entry.expected) throw new Error(`SHA-256 mismatch: ${entry.relativePath}`);
}

process.stdout.write(`Verified colleague distribution for ${version.EXTENSION_ID}\n`);

function parseKeyValue(text) {
  return Object.fromEntries(text.trim().split("\n").map((line) => {
    const index = line.indexOf("=");
    if (index <= 0) throw new Error("VERSION.txt contains an invalid line");
    return [line.slice(0, index), line.slice(index + 1)];
  }));
}

async function requireRegularFile(relativePath) {
  const info = await stat(path.join(packageDir, relativePath));
  if (!info.isFile()) throw new Error(`Required distribution file is missing: ${relativePath}`);
}

async function listRegularFiles(root, relativeDirectory = "") {
  const entries = await readdir(path.join(root, relativeDirectory), { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory.split(path.sep).join(path.posix.sep), entry.name);
    if (entry.isDirectory()) results.push(...await listRegularFiles(root, relativePath));
    else if (entry.isFile()) results.push(relativePath);
    else throw new Error(`Distribution contains unsupported filesystem entry: ${relativePath}`);
  }
  return results.sort(comparePaths);
}

function comparePaths(left, right) {
  return left.localeCompare(right, "en");
}
