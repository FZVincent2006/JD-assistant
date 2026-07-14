import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

describe("colleague distribution entry", () => {
  it("uses the bundled helper and fixed extension id without accessibility setup", () => {
    const installer = read("scripts/install-feishu-auth-helper.sh");
    const command = read("distribution/安装飞书授权助手.command");

    expect(installer).toContain("FEISHU_HELPER_APP_PATH");
    expect(command).toContain("VERSION.txt");
    expect(command).toContain("chrome-extension://");
    expect(command).toContain("FEISHU_HELPER_APP_PATH");
    expect(`${installer}\n${command}`).not.toContain("--request-accessibility");
  });

  it("documents local secret entry, both browsers, manual numbering, and rollback", () => {
    const guide = read("distribution/安装说明.md");

    expect(guide).toContain("App Secret");
    expect(guide).toContain("Chrome");
    expect(guide).toContain("Edge");
    expect(guide).toContain("手动");
    expect(guide).toContain("旧版本");
  });

  it("builds and verifies a release without private-key material", () => {
    const gitignore = read(".gitignore");
    const buildScript = read("scripts/build-colleague-distribution.sh");
    const verifier = read("scripts/verify-colleague-distribution.mjs");

    expect(gitignore).toContain("release/");
    expect(buildScript).toContain("npm test");
    expect(buildScript).toContain("npm run build");
    expect(buildScript).toContain("build-feishu-auth-helper.sh");
    expect(buildScript).toContain("/usr/bin/ditto");
    expect(buildScript).toContain("verify-colleague-distribution.mjs");
    expect(verifier).toContain("pem|p12|key");
    expect(verifier).toContain("PRIVATE KEY");
    expect(verifier).toContain("SHA256SUMS.txt");
    expect(verifier).toContain("extensionJavaScript");
  });
});
