import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

describe("production Feishu operator copy", () => {
  it("shows a guided production workflow without standalone document checks", () => {
    const app = read("src/sidepanel/App.jsx");

    expect(app).toContain("检查并生成写入计划");
    expect(app).toContain("确认并写入正式招聘文档");
    expect(app).toContain("打开正式文档检查");
    expect(app).toContain("仅写入正式招聘文档");
    expect(app).not.toContain("打开文档检查");
    expect(app).not.toContain("sendFeishuInspectRequest");
    expect(app).not.toContain("onInspect");
    expect(app).not.toMatch(/<button[^>]*>\s*检查正式招聘文档\s*<\/button>/);
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

  it("documents automatic planning checks in version 0.2.2", () => {
    const manifest = JSON.parse(read("public/manifest.json"));
    expect(manifest.version).toBe("0.2.2");

    for (const path of ["README.md", "CODEX_INSTALL.md", "distribution/安装说明.md"]) {
      const text = read(path);
      expect(text, path).toContain("检查并生成写入计划");
      expect(text, path).not.toContain("点击“检查正式招聘文档”");
    }
  });
});
