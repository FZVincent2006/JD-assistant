import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const installerPath = fileURLToPath(new URL("../scripts/install-from-github.sh", import.meta.url));
const skillInstallerPath = fileURLToPath(new URL("../scripts/install-jd-skill.sh", import.meta.url));

describe("reduced distribution", () => {
  it("does not install Feishu helpers and retains the JD Skill installer", async () => {
    const installer = await readFile(installerPath, "utf8");
    const skillInstaller = await readFile(skillInstallerPath, "utf8");
    expect(installer).not.toMatch(/feishu|app secret|native messaging/i);
    expect(skillInstaller).toContain('TARGET_DIR="${TARGET_ROOT}/jd-skill"');
  });
});
