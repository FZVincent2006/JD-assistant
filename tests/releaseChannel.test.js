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
    expect(value.tag).toBe("v0.2.2-codex.1");
    expect(value.extensionVersion).toBe("0.2.2");
    expect(value.sha256).toBe(
      "c9129fa14212b96d047b9f9acda1e7e81ec520cd58253320e1ef423a76ff7aa3"
    );
    expect(value.buildCommit).toBe("61ba39dc5d48f873365f1bd9348c94b167a37780");
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
