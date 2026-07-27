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
    expect(value.tag).toBe("v0.2.6-codex.1");
    expect(value.extensionVersion).toBe("0.2.6");
    expect(value.sha256).toBe(
      "e135702a1424f253a67a646063f5f4683d9561140a82d1de3a893daf380fe889"
    );
    expect(value.buildCommit).toBe("224d0adb666c0db3b3f92e0dabbe272f058a579d");
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
