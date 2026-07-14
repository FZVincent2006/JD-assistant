import { describe, expect, it } from "vitest";
import { parseCompanyJdBatch, validateCompanyDraft } from "../src/lib/companyJdParser.js";

describe("parseCompanyJdBatch", () => {
  it("parses one company with multiple normalized jobs", () => {
    const result = parseCompanyJdBatch(`公司：所思科技
公司官网：https://example.com/jobs

公司介绍：
• 所思科技致力于打造全球化娱乐产品。

（1）游戏系统策划 | 上海 | 社招
工作内容：
- 负责游戏内系统设计。
• 跟进功能落地。
职位要求：
1. 3 年以上相关经验。
加分项：
- 有海外项目经验。

（2）游戏客户端开发（U3D）｜上海｜社招
岗位职责：
- 负责客户端功能开发。
任职要求：
- 熟悉 Unity。`);

    expect(result).toEqual({
      companyName: "所思科技",
      website: "https://example.com/jobs",
      companyIntro: ["所思科技致力于打造全球化娱乐产品。"],
      jobs: [
        {
          title: "游戏系统策划",
          location: "上海",
          employment: "社招",
          responsibilities: ["负责游戏内系统设计。", "跟进功能落地。"],
          requirements: ["3 年以上相关经验。"],
          bonuses: ["有海外项目经验。"]
        },
        {
          title: "游戏客户端开发（U3D）",
          location: "上海",
          employment: "社招",
          responsibilities: ["负责客户端功能开发。"],
          requirements: ["熟悉 Unity。"],
          bonuses: []
        }
      ],
      warnings: [],
      errors: []
    });
  });

  it("warns for optional website and company introduction", () => {
    const result = parseCompanyJdBatch(`公司：CoFANCY 可糖
品牌设计｜上海｜社招
工作内容：
- 建设品牌视觉。
职位要求：
- 三年以上经验。`);

    expect(result.website).toBe("");
    expect(result.companyIntro).toEqual([]);
    expect(result.warnings).toEqual(["未识别公司官网，将以纯文本写入公司名。", "未识别公司介绍，确认写入时将使用“待补充”。"]);
    expect(result.errors).toEqual([]);
  });

  it("reports missing required company and incomplete job fields", () => {
    const result = parseCompanyJdBatch(`产品经理｜｜社招
工作内容：
- 负责产品规划。`);

    expect(result.errors).toEqual([
      "未识别公司名。",
      "岗位“产品经理”缺少地点。",
      "岗位“产品经理”缺少职位要求。"
    ]);
  });
});

describe("validateCompanyDraft", () => {
  it("validates edited preview data independently of parsing", () => {
    expect(validateCompanyDraft({ companyName: "", jobs: [] })).toEqual([
      "未识别公司名。",
      "至少需要一个岗位。"
    ]);
  });
});
