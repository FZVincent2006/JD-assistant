import { describe, expect, it } from "vitest";
import { verifyLegacyIntegrity } from "../scripts/verify-legacy-integrity.mjs";

describe("legacy integrity", () => {
  it("keeps the Boss/Maimai parser and filler byte-identical", async () => {
    await expect(verifyLegacyIntegrity(new URL("../", import.meta.url))).resolves.toBeUndefined();
  });
});
