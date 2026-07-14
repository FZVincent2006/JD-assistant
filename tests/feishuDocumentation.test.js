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
});
