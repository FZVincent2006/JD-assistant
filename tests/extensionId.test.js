import { describe, expect, it } from "vitest";
import manifest from "../public/manifest.json";

describe("fixed Chromium extension identity", () => {
  it("derives one stable 32-letter id from the manifest public key", async () => {
    expect(typeof manifest.key).toBe("string");
    expect(manifest.key.length).toBeGreaterThan(100);

    const { extensionIdFromManifestKey } = await import("../scripts/extension-id.mjs");
    const first = extensionIdFromManifestKey(manifest.key);
    expect(first).toMatch(/^[a-p]{32}$/);
    expect(extensionIdFromManifestKey(manifest.key)).toBe(first);
  });
});
