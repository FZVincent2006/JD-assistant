import { describe, expect, it } from "vitest";
import fixture from "./fixtures/feishu-structural-sample.json";
import { buildBlockModel, fieldForBlockType } from "../src/lib/feishuBlockModel.js";
import { renderJdDescendants, renderSummaryDescendants } from "../src/lib/feishuBlockRenderer.js";
import { buildFeishuOpenApiPlan } from "../src/lib/feishuOpenApiPlan.js";
import { inspectRecruitingDocument } from "../src/lib/feishuTemplateReader.js";

const draft = {
  companyName: "CoFANCY <可糖>",
  website: "https://example.com/company?a=1&b=2",
  companyIntro: ["第一段介绍。", "第二段介绍。"],
  jobs: [
    {
      title: "品牌设计",
      location: "上海",
      employment: "社招",
      responsibilities: ["把控 <品牌> 视觉。", "推进落地。"],
      requirements: ["三年设计经验。"],
      bonuses: []
    },
    {
      title: "销售主管/分销主管",
      location: "深圳",
      employment: "社招",
      responsibilities: ["管理分销渠道。"],
      requirements: ["五年销售经验。"],
      bonuses: ["美妆经验优先。"]
    }
  ]
};

function setup(currentDraft = draft) {
  const snapshot = inspectRecruitingDocument(buildBlockModel(structuredClone(fixture.items), fixture.revision_id));
  return {
    snapshot,
    plan: buildFeishuOpenApiPlan(snapshot, currentDraft)
  };
}

function blockMap(request) {
  return new Map(request.descendants.map((block) => [block.block_id, block]));
}

function blockText(block) {
  const field = fieldForBlockType(block.block_type);
  return (block[field]?.elements ?? []).map((element) => element.text_run?.content ?? "").join("");
}

function allTexts(request) {
  return request.descendants.map(blockText).filter(Boolean);
}

describe("Feishu native block rendering", () => {
  it("renders a new company as root H1/H2/Callout/H2 plus job-title and QuoteContainer siblings", () => {
    const { snapshot, plan } = setup();
    const request = renderJdDescendants(draft, plan, snapshot.templates.jd);
    const byId = blockMap(request);
    const rootTypes = request.children_id.map((id) => byId.get(id).block_type);
    const companyHeading = byId.get("jd-company-heading");

    expect(rootTypes).toEqual([3, 4, 19, 4, 5, 34, 5, 34]);
    expect(companyHeading.heading1.style.sequence).toBe("auto");
    expect(blockText(companyHeading)).toBe(draft.companyName);
    expect(blockText(companyHeading)).not.toMatch(/^\s*1[.、]/);
    expect(request.descendants.map((block) => block.block_type)).toEqual(expect.arrayContaining([2, 3, 4, 5, 12, 19, 34]));
    expect(byId.get("jd-intro-callout").children.every((id) => byId.get(id).block_type === 12)).toBe(true);
    expect(byId.get("jd-job-1-quote").children.map((id) => byId.get(id).block_type)).toEqual([2, 12, 12, 2, 12]);
    expect(allTexts(request)).toContain("（1）品牌设计｜上海｜社招");
    expect(byId.get("jd-job-1-quote").children.map((id) => blockText(byId.get(id)))).not.toContain("加分项：");
    expect(allTexts(request)).toContain("加分项：");
    expect(allTexts(request)).toContain("美妆经验优先。");
  });

  it("copies a distinct gray Heading 1 template for 开放岗位 when the document uses it", () => {
    const { snapshot, plan } = setup();
    snapshot.templates.jd.openHeading = {
      block_type: 3,
      heading1: {
        style: {},
        elements: [{ text_run: { text_element_style: { text_color: 3 } } }]
      }
    };

    const request = renderJdDescendants(draft, plan, snapshot.templates.jd);
    const openHeading = blockMap(request).get("jd-open-heading");

    expect(openHeading).toMatchObject({
      block_type: 3,
      heading1: {
        elements: [{ text_run: { content: "开放岗位", text_element_style: { text_color: 3 } } }]
      }
    });
  });

  it("renders append mode without duplicating company, intro, or open-jobs blocks", () => {
    const current = setup().snapshot;
    current.portfolio.companies[0].name = draft.companyName;
    current.jd.companies[0].name = draft.companyName;
    const appended = { ...draft, jobs: [{ ...draft.jobs[0], title: "新岗位" }] };
    const plan = buildFeishuOpenApiPlan(current, appended);
    const request = renderJdDescendants(appended, plan, current.templates.jd);
    const byId = blockMap(request);

    expect(plan.mode).toBe("append-jobs");
    expect(request.children_id.map((id) => byId.get(id).block_type)).toEqual([5, 34]);
    expect(allTexts(request)).toContain("（2）新岗位｜上海｜社招");
    expect(request.descendants.some((block) => block.block_type === 3 || block.block_type === 4 || block.block_type === 19)).toBe(false);
  });

  it("renders the summary hierarchy and applies only a safe company link", () => {
    const { snapshot, plan } = setup();
    const request = renderSummaryDescendants(draft, plan, snapshot.templates.portfolio);
    const byId = blockMap(request);
    const company = byId.get(request.children_id[0]);
    const run = company.heading3.elements[0].text_run;

    expect(request.children_id.map((id) => byId.get(id).block_type)).toEqual([5, 12, 12]);
    expect(run.content).toBe("CoFANCY <可糖>");
    expect(run.text_element_style.link).toEqual({ url: draft.website });
    expect(allTexts(request)).toContain("品牌设计｜上海｜社招");

    const plainDraft = { ...draft, website: "" };
    const plainRequest = renderSummaryDescendants(plainDraft, setup(plainDraft).plan, snapshot.templates.portfolio);
    const plainCompany = blockMap(plainRequest).get(plainRequest.children_id[0]);
    expect(plainCompany.heading3.elements[0].text_run.text_element_style).not.toHaveProperty("link");
  });

  it("uses one 待补充 bullet for a missing introduction and keeps HTML-like input as plain text", () => {
    const minimal = {
      ...draft,
      companyIntro: [],
      jobs: [{ ...draft.jobs[0], responsibilities: ["<script>not markup</script>"] }]
    };
    const { snapshot, plan } = setup(minimal);
    const request = renderJdDescendants(minimal, plan, snapshot.templates.jd);
    const byId = blockMap(request);

    expect(byId.get("jd-intro-callout").children).toEqual(["jd-intro-1"]);
    expect(blockText(byId.get("jd-intro-1"))).toBe("待补充");
    expect(allTexts(request)).toContain("<script>not markup</script>");
  });

  it("rejects unsafe URL schemes and control characters", () => {
    const { snapshot } = setup();
    for (const website of ["javascript:alert(1)", "data:text/plain,bad"]) {
      const unsafe = { ...draft, website };
      const plan = setup(unsafe).plan;
      expect(() => renderJdDescendants(unsafe, plan, snapshot.templates.jd)).toThrow("http or https");
    }

    const controlled = {
      ...draft,
      companyIntro: ["bad\u0000text"]
    };
    expect(() => renderJdDescendants(controlled, setup(controlled).plan, snapshot.templates.jd)).toThrow("control characters");
  });

  it("returns a complete, acyclic descendant graph with no missing IDs", () => {
    const { snapshot, plan } = setup();
    for (const request of [
      renderJdDescendants(draft, plan, snapshot.templates.jd),
      renderSummaryDescendants(draft, plan, snapshot.templates.portfolio)
    ]) {
      const ids = new Set(request.descendants.map((block) => block.block_id));
      expect(ids.size).toBe(request.descendants.length);
      expect(request.children_id.every((id) => ids.has(id))).toBe(true);
      expect(request.descendants.flatMap((block) => block.children ?? []).every((id) => ids.has(id))).toBe(true);
    }
  });
});
