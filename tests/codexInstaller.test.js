import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createInstallerFixture } from "./helpers/createInstallerFixture.js";

const execFileAsync = promisify(execFile);
const installer = fileURLToPath(new URL("../scripts/install-from-github.sh", import.meta.url));
const homes = [];
const fixtureRoots = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
  await Promise.all(
    fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function run(args, env = {}) {
  const home = await mkdtemp(path.join(tmpdir(), "codex-installer-"));
  homes.push(home);
  const result = await execFileAsync("bash", [installer, ...args], {
    env: { ...process.env, HOME: home, ...env }
  });
  return { ...result, home };
}

describe("Codex colleague installer planning", () => {
  it("prints a Chrome plan without touching HOME", async () => {
    const { stdout, home } = await run(
      ["--dry-run", "--browser", "chrome"],
      {
        JD_ASSISTANT_TEST_MODE: "1",
        JD_ASSISTANT_INSTALLED_CHROME: "1",
        JD_ASSISTANT_INSTALLED_EDGE: "0"
      }
    );

    expect(stdout).toContain("STATUS=planned");
    expect(stdout).toContain("RELEASE_TAG=v0.2.1-codex.1");
    expect(stdout).toContain("BROWSER=chrome");
    expect(stdout).toContain("EXTENSION_ID=mlhjjkclfiocgafhjdhoicghiabkeggg");
    expect(stdout).toContain("Library/Application Support/ZhenFund JD Assistant/Extension");
    expect(await readdir(home)).toEqual([]);
  });

  it.each([
    ["1", "0", "1", "1", "chrome"],
    ["0", "1", "1", "1", "edge"],
    ["0", "0", "1", "0", "chrome"],
    ["0", "0", "0", "1", "edge"]
  ])(
    "selects one unambiguous browser",
    async (runningChrome, runningEdge, installedChrome, installedEdge, expected) => {
      const { stdout } = await run(["--dry-run", "--browser", "auto"], {
        JD_ASSISTANT_TEST_MODE: "1",
        JD_ASSISTANT_RUNNING_CHROME: runningChrome,
        JD_ASSISTANT_RUNNING_EDGE: runningEdge,
        JD_ASSISTANT_INSTALLED_CHROME: installedChrome,
        JD_ASSISTANT_INSTALLED_EDGE: installedEdge
      });

      expect(stdout).toContain(`BROWSER=${expected}`);
    }
  );

  it.each([
    ["0", "0", "0", "0"],
    ["0", "0", "1", "1"],
    ["1", "1", "1", "1"]
  ])(
    "rejects a missing or ambiguous browser state",
    async (runningChrome, runningEdge, installedChrome, installedEdge) => {
      await expect(
        run(["--dry-run", "--browser", "auto"], {
          JD_ASSISTANT_TEST_MODE: "1",
          JD_ASSISTANT_RUNNING_CHROME: runningChrome,
          JD_ASSISTANT_RUNNING_EDGE: runningEdge,
          JD_ASSISTANT_INSTALLED_CHROME: installedChrome,
          JD_ASSISTANT_INSTALLED_EDGE: installedEdge
        })
      ).rejects.toMatchObject({ code: 2 });
    }
  );

  it("rejects non-macOS execution before planning", async () => {
    await expect(
      run(["--dry-run", "--browser", "chrome"], {
        JD_ASSISTANT_TEST_MODE: "1",
        JD_ASSISTANT_UNAME: "Linux",
        JD_ASSISTANT_INSTALLED_CHROME: "1"
      })
    ).rejects.toMatchObject({ code: 2 });
  });
});

async function runFixture(fixture, browser = "chrome", extraArgs = []) {
  const installedBrowser = browser === "chrome"
    ? { JD_ASSISTANT_INSTALLED_CHROME: "1", JD_ASSISTANT_INSTALLED_EDGE: "0" }
    : { JD_ASSISTANT_INSTALLED_CHROME: "0", JD_ASSISTANT_INSTALLED_EDGE: "1" };
  return execFileAsync(
    "bash",
    [fixture.installer, "--browser", browser, "--package", fixture.zipPath, ...extraArgs],
    {
      env: {
        ...process.env,
        HOME: fixture.home,
        JD_ASSISTANT_TEST_MODE: "1",
        JD_ASSISTANT_NO_OPEN: "1",
        ...installedBrowser
      }
    }
  );
}

describe("Codex colleague installer package execution", () => {
  it("installs a verified local package into the stable user directory", async () => {
    const fixture = await createInstallerFixture({ extensionVersion: "0.2.0" });
    fixtureRoots.push(fixture.root);

    const { stdout } = await runFixture(fixture);

    expect(stdout).toContain("STATUS=browser_confirmation_required");
    expect(
      await readFile(path.join(fixture.installParent, "Extension/manifest.json"), "utf8")
    ).toContain('"version": "0.2.0"');
    const receipt = JSON.parse(
      await readFile(path.join(fixture.installParent, "install-receipt.json"), "utf8")
    );
    expect(receipt.extensionId).toBe("mlhjjkclfiocgafhjdhoicghiabkeggg");
    expect(receipt.releaseTag).toBe("v0.2.0-codex.1");
    expect(await readFile(path.join(fixture.home, "helper-install.txt"), "utf8"))
      .toContain("--keep-existing-secret");
  });

  it("only replaces the stored secret when explicitly requested", async () => {
    const fixture = await createInstallerFixture({ extensionVersion: "0.2.0" });
    fixtureRoots.push(fixture.root);

    await runFixture(fixture, "chrome", ["--replace-secret"]);

    expect(await readFile(path.join(fixture.home, "helper-install.txt"), "utf8"))
      .not.toContain("--keep-existing-secret");
  });

  it("keeps the previous extension when the outer digest is wrong", async () => {
    const fixture = await createInstallerFixture({
      corruptOuterDigest: true,
      existingMarker: "old-version"
    });
    fixtureRoots.push(fixture.root);

    await expect(runFixture(fixture, "edge")).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("Outer package SHA-256 mismatch")
    });
    expect(
      await readFile(path.join(fixture.installParent, "Extension/marker.txt"), "utf8")
    ).toBe("old-version");
  });

  it("rejects a tampered inner file before replacing the old extension", async () => {
    const fixture = await createInstallerFixture({
      tamperInnerFile: true,
      existingMarker: "old-version"
    });
    fixtureRoots.push(fixture.root);

    await expect(runFixture(fixture)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("Package file checksums do not match")
    });
    expect(
      await readFile(path.join(fixture.installParent, "Extension/marker.txt"), "utf8")
    ).toBe("old-version");
  });

  it("rejects a package whose VERSION extension id differs from the fixed id", async () => {
    const fixture = await createInstallerFixture({
      mismatchedExtensionId: true,
      existingMarker: "old-version"
    });
    fixtureRoots.push(fixture.root);

    await expect(runFixture(fixture)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("Package extension ID does not match")
    });
    expect(
      await readFile(path.join(fixture.installParent, "Extension/marker.txt"), "utf8")
    ).toBe("old-version");
  });

  it("reinstalls idempotently and keeps exactly one previous extension", async () => {
    const fixture = await createInstallerFixture({ existingMarker: "old-version" });
    fixtureRoots.push(fixture.root);

    await runFixture(fixture);
    await runFixture(fixture);

    expect(
      await readFile(path.join(fixture.installParent, "Extension/manifest.json"), "utf8")
    ).toContain('"version": "0.2.0"');
    expect(
      await readFile(path.join(fixture.installParent, "Extension.previous/manifest.json"), "utf8")
    ).toContain('"version": "0.2.0"');
    await expect(
      readFile(path.join(fixture.installParent, "Extension.previous.previous/manifest.json"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
