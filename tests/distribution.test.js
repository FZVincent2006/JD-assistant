import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

describe("reduced colleague distribution", () => {
  it("documents the two supported recruiting platforms and the JD Skill", () => {
    const readme = read("README.md");
    expect(readme).toContain("Boss");
    expect(readme).toContain("脉脉");
    expect(readme).toContain("JD Skill");
    expect(readme).toContain("手动发布");
    expect(readme).toContain("scripts/install-jd-skill.sh");
  });

  it("keeps package checksums and JD Skill source in the distribution", () => {
    const buildScript = read("scripts/build-colleague-distribution.sh");
    const verifier = read("scripts/verify-colleague-distribution.mjs");
    const buildVerifier = read("scripts/verify-extension-build.mjs");
    expect(buildScript).toContain("npm test");
    expect(buildScript).toContain("npm run build");
    expect(buildScript).toContain("skills/jd-skill");
    expect(buildScript).toContain("verify-colleague-distribution.mjs");
    expect(verifier).toContain("skills/jd-skill/SKILL.md");
    expect(verifier).toContain("SHA256SUMS.txt");
    expect(verifier).toContain("PRIVATE KEY");
    expect(buildVerifier).toContain("webNavigation");
    expect(buildVerifier).toContain("recruitingMatches");
  });

  it("does not expose removed platform operations in operator documentation", () => {
    for (const name of ["README.md", "CODEX_INSTALL.md", "distribution/安装说明.md"]) {
      expect(read(name)).not.toMatch(/飞书|Feishu|Outlook|App Secret|Native Messaging/i);
    }
  });
});
