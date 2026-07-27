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
    expect(value.tag).toBe("v0.2.7-codex.1");
    expect(value.extensionVersion).toBe("0.2.7");
    expect(value.sha256).toBe(
      "6558364ffd761dba68aba67571f31f72111bc00afe4881d08a422549242732d1"
    );
    expect(value.buildCommit).toBe("909ca8c28c3f15c47c4d78a0779dc9b2821ff9c9");
    expect(value.buildCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.isFrozen(value)).toBe(true);
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
