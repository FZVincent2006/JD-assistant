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
    expect(value.tag).toBe("v0.2.4-codex.1");
    expect(value.extensionVersion).toBe("0.2.4");
    expect(value.sha256).toBe(
      "31a573c6d36c863412a542fc6b2f6a972153ae256d46b68d4ac99b1d58292a36"
    );
    expect(value.buildCommit).toBe("ad9a1b868c354dc6d5b3ecf57add1eef2024225f");
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
