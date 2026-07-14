import { describe, expect, it } from "vitest";
import fixture from "./fixtures/feishu-structural-sample.json";
import { buildBlockModel } from "../src/lib/feishuBlockModel.js";
import { inspectRecruitingDocument } from "../src/lib/feishuTemplateReader.js";
import { buildFeishuOpenApiPlan } from "../src/lib/feishuOpenApiPlan.js";
import { draft, successfulSnapshots } from "./helpers/feishuWriteScenario.js";

const coFANCYDraft = {
  companyName: "CoFANCY 可糖",
  website: "https://cofancy.com",
  companyIntro: ["一家高端角膜接触镜品牌。"],
  jobs: [
    {
      title: "品牌设计",
      location: "上海",
      employment: "社招",
      responsibilities: ["建设品牌视觉。"],
      requirements: ["三年设计经验。"],
      bonuses: []
    },
    {
      title: "销售主管/分销主管",
      location: "深圳",
      employment: "社招",
      responsibilities: ["管理分销渠道。"],
      requirements: ["五年销售经验。"],
      bonuses: []
    }
  ]
};

function snapshot() {
  return inspectRecruitingDocument(buildBlockModel(structuredClone(fixture.items), fixture.revision_id));
}

function renameFirstCompany(value) {
  const current = snapshot();
  current.portfolio.companies[0].name = value;
  current.jd.companies[0].name = value;
  return current;
}

describe("buildFeishuOpenApiPlan", () => {
  it("inserts a new company before the first company in both sections", () => {
    const current = snapshot();
    const plan = buildFeishuOpenApiPlan(current, coFANCYDraft);

    expect(plan).toMatchObject({
      ok: true,
      mode: "new-company",
      baseRevisionId: fixture.revision_id,
      companyName: "CoFANCY 可糖",
      jdTarget: { parentBlockId: "page", index: current.jd.firstCompanyIndex },
      summaryTarget: { parentBlockId: "portfolio-callout", index: current.portfolio.firstCompanyIndex },
      jobs: [{ ordinal: 1 }, { ordinal: 2 }],
      expected: {
        companyName: "CoFANCY 可糖",
        jobTitles: ["品牌设计", "销售主管/分销主管"],
        totalJdJobs: 2,
        totalSummaryJobs: 2
      },
      errors: []
    });
  });

  it("appends after the existing company and derives the next ordinal from the maximum", () => {
    const current = renameFirstCompany("CoFANCY 可糖");
    current.jd.companies[0].jobs = [
      { title: "视觉设计", ordinal: 1, index: 7, blockId: "job-1", quoteBlockId: "quote-1" },
      { title: "研究员", ordinal: 4, index: 8, blockId: "job-4", quoteBlockId: "quote-4" }
    ];
    current.jd.companies[0].endIndex = 9;
    current.portfolio.companies[0].jobs = [
      { title: "视觉设计", index: 1, blockId: "summary-job-1" },
      { title: "研究员", index: 2, blockId: "summary-job-4" }
    ];
    current.portfolio.companies[1].index = 3;

    const plan = buildFeishuOpenApiPlan(current, { ...coFANCYDraft, jobs: [coFANCYDraft.jobs[0]] });

    expect(plan).toMatchObject({
      ok: true,
      mode: "append-jobs",
      jdTarget: { parentBlockId: "page", index: 9 },
      summaryTarget: { parentBlockId: "portfolio-callout", index: 3 },
      jobs: [{ title: "品牌设计", ordinal: 5 }],
      expected: { totalJdJobs: 3, totalSummaryJobs: 3 }
    });
  });

  it("stops when the same normalized job already exists", () => {
    const current = renameFirstCompany("ＣｏＦＡＮＣＹ　可糖");
    current.portfolio.companies[0].jobs[0].title = "品牌－设计";
    current.jd.companies[0].jobs[0].title = "品牌－设计";
    const draft = { ...coFANCYDraft, companyName: "cofancy 可糖", jobs: [{ ...coFANCYDraft.jobs[0], title: "品牌-设计" }] };

    const plan = buildFeishuOpenApiPlan(current, draft);

    expect(plan.ok).toBe(false);
    expect(plan.errors.join(" ")).toContain("品牌-设计");
  });

  it("normalizes full-width separators, dash variants, whitespace, and case for duplicate input jobs", () => {
    const duplicateDraft = {
      ...coFANCYDraft,
      jobs: [
        { ...coFANCYDraft.jobs[0], title: "AI｜平台 - 工程师" },
        { ...coFANCYDraft.jobs[0], title: " ai|平台－工程师 " }
      ]
    };

    const plan = buildFeishuOpenApiPlan(snapshot(), duplicateDraft);

    expect(plan.ok).toBe(false);
    expect(plan.errors.join(" ")).toContain("重复岗位");
  });

  it("stops on duplicate company matches or a company present in only one section", () => {
    const duplicate = renameFirstCompany("CoFANCY 可糖");
    duplicate.jd.companies.push({ ...duplicate.jd.companies[0], headingBlockId: "duplicate-company" });
    expect(buildFeishuOpenApiPlan(duplicate, coFANCYDraft).errors.join(" ")).toContain("公司名在目标区域中不唯一");

    const oneSection = renameFirstCompany("CoFANCY 可糖");
    oneSection.jd.companies[0].name = "其他公司";
    expect(buildFeishuOpenApiPlan(oneSection, coFANCYDraft).errors.join(" ")).toContain("只存在于一个目标区域");
  });

  it("stops when section ordering or required input is invalid", () => {
    const current = snapshot();
    current.portfolio.headingIndex = current.jd.headingIndex + 1;
    const plan = buildFeishuOpenApiPlan(current, { ...coFANCYDraft, companyName: "", jobs: [] });

    expect(plan.ok).toBe(false);
    expect(plan.errors.join(" ")).toContain("Portfolio 区必须位于岗位 JD 区之前");
    expect(plan.errors.join(" ")).toContain("公司名");
    expect(plan.errors.join(" ")).toContain("至少需要一个岗位");
  });

  it("builds a resume plan when an exact JD company exists without Portfolio", () => {
    const current = successfulSnapshots().unnumberedJd;

    const plan = buildFeishuOpenApiPlan(current, draft);

    expect(plan).toMatchObject({
      ok: true,
      mode: "resume-new-company",
      companyName: draft.companyName,
      jdTarget: { parentBlockId: current.rootId, index: current.jd.firstCompanyIndex },
      summaryTarget: {
        parentBlockId: current.portfolio.parentBlockId,
        index: current.portfolio.firstCompanyIndex
      },
      jobs: [{ ordinal: 1 }, { ordinal: 2 }],
      expected: { totalJdJobs: 2, totalSummaryJobs: 2 },
      errors: []
    });
  });

  it("refuses recovery when existing JD prose differs from the draft", () => {
    const current = successfulSnapshots().unnumberedJd;
    current.jd.companies[0].jobs[0].responsibilities[0] = "被人工修改的职责";

    const plan = buildFeishuOpenApiPlan(current, draft);

    expect(plan.ok).toBe(false);
    expect(plan.errors.join(" ")).toContain("现有岗位 JD 与本次草稿不完全一致");
    expect(plan.errors.join(" ")).toContain("工作内容");
  });
});
