import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

describe("production Feishu operator copy", () => {
  it("shows only the production document actions", () => {
    const app = read("src/sidepanel/App.jsx");

    expect(app).toContain("检查正式招聘文档");
    expect(app).toContain("确认并写入正式招聘文档");
    expect(app).toContain("仅写入正式招聘文档");
    expect(app).not.toContain("测试副本");
  });

  it("removes the test token from runtime source and operator docs", () => {
    const paths = [
      "src/lib/feishuConfig.js",
      "src/sidepanel/App.jsx",
      "src/background/feishuOpenApiWriter.js",
      "README.md",
      "CODEX_INSTALL.md",
      "distribution/安装说明.md"
    ];

    for (const relativePath of paths) {
      expect(read(relativePath), relativePath)
        .not.toContain("LlhrwSLIvilANZk1opwcQGlUnNv");
    }
  });
});
