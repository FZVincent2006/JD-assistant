import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const installer = fileURLToPath(new URL("../scripts/install-feishu-auth-helper.sh", import.meta.url));
const homes = [];
const CHROME_ORIGIN = `chrome-extension://${"a".repeat(32)}/`;
const EDGE_ORIGIN = `chrome-extension://${"b".repeat(32)}/`;

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function runInstallerDryRun(origins) {
  const home = await mkdtemp(path.join(tmpdir(), "feishu-helper-test-"));
  homes.push(home);
  const { stdout, stderr } = await execFileAsync("bash", [installer, "--dry-run", ...origins], {
    env: { ...process.env, HOME: home }
  });
  return { output: JSON.parse(stdout), stderr, home };
}

describe("Feishu native helper installer", () => {
  it("renders Chrome and Edge manifests with only the requested origins", async () => {
    const { output, stderr, home } = await runInstallerDryRun([CHROME_ORIGIN, EDGE_ORIGIN]);

    expect(stderr).toBe("");
    expect(output.manifests).toHaveLength(2);
    for (const manifest of output.manifests) {
      expect(manifest.name).toBe("cn.zhenfund.jd_assistant.feishu_auth");
      expect(manifest.type).toBe("stdio");
      expect(manifest.allowed_origins).toEqual([CHROME_ORIGIN, EDGE_ORIGIN]);
      expect(manifest.path).toContain("Feishu JD Assistant Helper.app/Contents/MacOS/feishu-auth-host");
    }
    expect(await readdir(home)).toEqual([]);
  });

  it("rejects malformed or non-extension origins", async () => {
    await expect(runInstallerDryRun(["https://example.com/"])).rejects.toMatchObject({ code: 2 });
    await expect(runInstallerDryRun(["chrome-extension://abc/"])).rejects.toMatchObject({ code: 2 });
  });

  it("does not request macOS Accessibility after installation", async () => {
    const script = await readFile(installer, "utf8");

    expect(script).not.toContain("--check-accessibility");
    expect(script).not.toContain("--request-accessibility");
    expect(script).not.toMatch(/tccutil|ScreenCapture|Input Monitoring/i);
    expect(script).toContain("Feishu JD Assistant Helper.app");
  });
});
