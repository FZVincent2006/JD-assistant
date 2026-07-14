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
  const manifestPath = process.argv[2];
  if (!manifestPath) throw new Error("Usage: node scripts/extension-id.mjs <manifest-path>");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  process.stdout.write(`${extensionIdFromManifestKey(manifest.key)}\n`);
}
