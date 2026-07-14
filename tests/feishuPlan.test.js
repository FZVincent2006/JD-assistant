import { describe, expect, it } from "vitest";
import { buildFeishuWritePlan } from "../src/lib/feishuPlan.js";
import { renderJdFragment, renderPortfolioFragment } from "../src/lib/feishuRichText.js";

const draft = {
  companyName: "New <AI>",
  website: "https://example.com/?a=1&b=2",
  companyIntro: ["Build & ship."],
  jobs: [
    {
      title: "Agent 工程师",
      location: "上海",
      employment: "社招",
      responsibilities: ["构建 <Agent>。"],
      requirements: ["熟悉 Node.js。"],
      bonuses: []
    },
    {
      title: "产品经理",
      location: "深圳",
      employment: "社招",
      responsibilities: ["定义产品。"],
      requirements: ["有 ownership。"],
      bonuses: ["英语流利。"]
    }
  ]
};

function emptySnapshot(overrides = {}) {
  return {
    editable: true,
    portfolioHeadingCount: 1,
    jdHeadingCount: 1,
    portfolioCompanies: [],
    jdCompanies: [],
    ...overrides
  };
}

describe("buildFeishuWritePlan", () => {
  it("plans a new company at the beginning with job ordinals starting at one", () => {
    expect(buildFeishuWritePlan(emptySnapshot(), draft)).toEqual({
      ok: true,
      mode: "new-company",
      companyName: "New <AI>",
      jobs: [
        { title: "Agent 工程师", ordinal: 1 },
        { title: "产品经理", ordinal: 2 }
      ],
      errors: []
    });
  });

  it("appends jobs to an existing company using the next ordinal", () => {
    const snapshot = emptySnapshot({
      portfolioCompanies: [{ name: "New <AI>", jobs: ["设计师"] }],
      jdCompanies: [{ name: "New <AI>", jobs: ["设计师", "研究员"] }]
    });

    const plan = buildFeishuWritePlan(snapshot, { ...draft, jobs: [draft.jobs[0]] });

    expect(plan.mode).toBe("append-jobs");
    expect(plan.jobs).toEqual([{ title: "Agent 工程师", ordinal: 3 }]);
  });

  it("stops on duplicates or inconsistent document structure", () => {
    const duplicate = emptySnapshot({
      portfolioCompanies: [{ name: "New <AI>", jobs: ["Agent 工程师"] }],
      jdCompanies: [{ name: "New <AI>", jobs: ["Agent 工程师"] }]
    });
    expect(buildFeishuWritePlan(duplicate, draft).errors).toContain("岗位“Agent 工程师”已存在，已停止写入。");

    const inconsistent = emptySnapshot({
      portfolioCompanies: [{ name: "New <AI>", jobs: [] }]
    });
    expect(buildFeishuWritePlan(inconsistent, draft).errors).toContain("公司只存在于一个目标区域，文档结构不一致。");
  });

  it("stops when the same job title appears twice in one draft", () => {
    const duplicateDraft = { ...draft, jobs: [draft.jobs[0], { ...draft.jobs[0] }] };
    const plan = buildFeishuWritePlan(emptySnapshot(), duplicateDraft);

    expect(plan.ok).toBe(false);
    expect(plan.errors).toContain("本次输入包含重复岗位“Agent 工程师”，已停止写入。");
  });

  it("requires edit access and unique target headings", () => {
    const plan = buildFeishuWritePlan(emptySnapshot({ editable: false, jdHeadingCount: 2 }), draft);
    expect(plan.ok).toBe(false);
    expect(plan.errors).toEqual(["当前文档不可编辑。", "“岗位JD整理”标题必须且只能出现一次。"]);
  });
});

describe("Feishu rich text rendering", () => {
  it("renders linked company and escaped job content for a new company", () => {
    const plan = buildFeishuWritePlan(emptySnapshot(), draft);
    const portfolio = renderPortfolioFragment(draft, plan);
    const jd = renderJdFragment(draft, plan);

    expect(portfolio.html).toContain('<a href="https://example.com/?a=1&amp;b=2">New &lt;AI&gt;</a>');
    expect(portfolio.text).toContain("New <AI>\n- Agent 工程师｜上海｜社招");
    expect(jd.html).toContain("（1）Agent 工程师｜上海｜社招");
    expect(jd.html).toContain("构建 &lt;Agent&gt;。");
    expect(jd.html).not.toContain("加分项：</h3><ul></ul>");
    expect(jd.text).toContain("加分项：\n- 英语流利。");
  });

  it("uses plain company text and a placeholder introduction when optional data is missing", () => {
    const minimal = { ...draft, website: "", companyIntro: [], jobs: [draft.jobs[0]] };
    const plan = buildFeishuWritePlan(emptySnapshot(), minimal);
    const portfolio = renderPortfolioFragment(minimal, plan);
    const jd = renderJdFragment(minimal, plan);

    expect(portfolio.html).not.toContain("<a ");
    expect(portfolio.html).toContain("New &lt;AI&gt;");
    expect(jd.text).toContain("公司介绍\n- 待补充");
  });
});
