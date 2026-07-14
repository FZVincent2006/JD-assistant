import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

describe("colleague release workflow", () => {
  it("builds one ASCII-named universal macOS asset", () => {
    const build = read("scripts/build-colleague-distribution.sh");

    expect(build).toContain("JD-assistant-macOS-$BUILD_DATE.zip");
    expect(build).toContain("date -u +%Y%m%d");
    expect(build).toContain("BUILD_DATE must use YYYYMMDD");
    expect(build).toContain("lipo");
    expect(build).toContain("codesign --verify --strict");
  });

  it("publishes only after tests and package verification", () => {
    const workflow = read(".github/workflows/release-colleague-package.yml");

    expect(workflow).toContain("macos-");
    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("scripts/build-colleague-distribution.sh");
    expect(workflow).toContain("gh release upload");
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("pull_request_target");
  });

  it("checks out the requested existing tag and uploads only the expected asset", () => {
    const workflow = read(".github/workflows/release-colleague-package.yml");

    expect(workflow).toContain("ref: ${{ inputs.tag }}");
    expect(workflow).toContain("JD-assistant-macOS-*.zip");
    expect(workflow).toContain("gh release create");
    expect(workflow).toContain("--prerelease");
    expect(workflow).toContain("--clobber");
  });
});
