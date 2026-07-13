import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const LEGACY_HASHES = Object.freeze({
  "src/lib/jdParser.js": "709e2fa1d89f300fa0d9085069827e0d5cbfd85b5d85c90035178b9a5ac32b28",
  "src/content/formFiller.js": "7d5578d8526c6ca1bf01976efa54ee1a92f9b5c94534c6e7c70d142bd1925215"
});

export async function verifyLegacyIntegrity(rootUrl = new URL("../", import.meta.url)) {
  for (const [path, expected] of Object.entries(LEGACY_HASHES)) {
    const content = await readFile(new URL(path, rootUrl));
    const actual = createHash("sha256").update(content).digest("hex");
    if (actual !== expected) {
      throw new Error(`${path} changed: expected ${expected}, got ${actual}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyLegacyIntegrity();
}
