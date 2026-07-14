import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const installer = fileURLToPath(new URL("../scripts/install-from-github.sh", import.meta.url));
const homes = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
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
    expect(stdout).toContain("RELEASE_TAG=v0.2.0-codex.1");
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
