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
    expect(value.tag).toBe("v0.2.3-codex.1");
    expect(value.extensionVersion).toBe("0.2.3");
    expect(value.sha256).toBe(
      "d64c596a50368e2cb66e2da777fa32e356adb2a1f0020c23a56e853c1dbe9aa1"
    );
    expect(value.buildCommit).toBe("ab0d61baab5f96dca8c19c9eef4c49f7b12363f7");
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
