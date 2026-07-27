import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

describe("Feishu operator documentation", () => {
  it("documents confirmed-JD recovery without page numbering", () => {
    expect(readme).toContain(
      "完全匹配的 `resume-new-company` 计划不会重复写 JD，只补 Portfolio。"
    );
    expect(readme).not.toContain("页面自动编号");
    expect(readme).not.toContain("APPLY_HEADING_NUMBERING");
  });

  it("documents permission-free page handling and exact JD-only recovery", () => {
    expect(readme).toContain("不需要“辅助功能”");
    expect(readme).toContain("resume-new-company");
    expect(readme).toContain("不会重复写入 JD");
    expect(readme).toContain("不需要保持为活动标签页");
    expect(readme).toContain("手动为该 Heading 1 开启有序编号");
    expect(readme).toContain("不要再次点击写入");
  });

  it("documents automatic and historical Portfolio job anchors", () => {
    expect(readme).toContain("Portfolio 岗位 Bullet 会直接带上");
    expect(readme).toContain("维护已有岗位链接");
    expect(readme).toContain("检查岗位链接");
    expect(readme).toContain("确认补全");
    expect(readme).toContain("首次建议只选 `CoFANCY 可糖`");
    expect(readme).toContain("#share-…");
    expect(readme).toContain("文档版本已变化");
    expect(readme).toContain("不需要剪贴板、飞书页面权限或 macOS 辅助功能权限");
    expect(readme).toContain("再次检查应显示“全部岗位链接已正确”");
  });
});
