import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

describe("Feishu operator documentation", () => {
  it("distinguishes confirmed-JD partial results from unconfirmed page-numbering partial results", () => {
    expect(readme).toContain(
      "显示“岗位 JD 区已确认写入”时，JD 已通过完整回读校验但 Portfolio 未完成；只修复 Portfolio 指定位置。"
    );
    expect(readme).toContain(
      "诊断为“页面自动编号”时，JD 内容已经创建但自动编号状态与完整 JD 校验尚未确认，不能视为 JD 完成；Portfolio 不会写入。"
    );
    expect(readme).not.toContain("“部分完成”表示岗位 JD 已通过回读校验，但 Portfolio 未完成。");
  });

  it("documents the four-Mac Accessibility setup and exact JD-only recovery", () => {
    expect(readme).toContain("系统设置 → 隐私与安全性 → 辅助功能");
    expect(readme).toContain("resume-new-company");
    expect(readme).toContain("不会重复写入 JD");
    expect(readme).toContain("只保留一个测试副本标签页");
    expect(readme).toContain("不需要“屏幕录制”");
    expect(readme).toContain("不要重复提交");
  });
});
