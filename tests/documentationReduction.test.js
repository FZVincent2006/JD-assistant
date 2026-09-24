import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (name) => readFile(fileURLToPath(new URL(`../${name}`, import.meta.url)), "utf8");

describe("operator documentation", () => {
  it("documents only Boss/Maimai filling and retained JD Skill operations", async () => {
    for (const name of ["README.md", "CODEX_INSTALL.md", "distribution/安装说明.md"]) {
      const text = await read(name);
      expect(text).not.toMatch(/飞书|Feishu|Outlook|App Secret|Native Messaging/i);
    }
    const readme = await read("README.md");
    expect(readme).toMatch(/Boss/);
    expect(readme).toMatch(/脉脉/);
    expect(readme).toMatch(/JD Skill/);
    expect(readme).toMatch(/手动发布/);
  });
});
