import { describe, expect, it } from "vitest";
import fixture from "./fixtures/feishu-structural-sample.json";
import { buildBlockModel } from "../src/lib/feishuBlockModel.js";
import { inspectRecruitingDocument } from "../src/lib/feishuTemplateReader.js";

function inspect(items = fixture.items) {
  return inspectRecruitingDocument(buildBlockModel(items, fixture.revision_id));
}

describe("Feishu recruiting document templates", () => {
  it("finds the first JD company as a root-level Heading1 after 岗位JD整理", () => {
    const snapshot = inspect();

    expect(snapshot.jd.companies[0]).toMatchObject({
      name: "示例公司甲",
      headingBlockId: "jd-company-a",
      parentBlockId: "page",
      index: 3,
      jobs: [{ title: "示例岗位甲", ordinal: 1 }]
    });
    expect(snapshot.jd.firstCompanyIndex).toBe(3);
    expect(snapshot.portfolio).toMatchObject({
      parentBlockId: "portfolio-callout",
      firstCompanyIndex: 0
    });
    expect(snapshot.portfolio.companies[0]).toMatchObject({
      name: "示例公司甲",
      jobs: [{ title: "示例岗位甲" }]
    });
  });

  it("copies style contracts but never copies source prose", () => {
    const snapshot = inspect();
    const serialized = JSON.stringify(snapshot.templates);

    expect(snapshot.templates.jd.callout).toMatchObject({ block_type: 19 });
    expect(snapshot.templates.jd.quote).toMatchObject({ block_type: 34 });
    expect(snapshot.templates.jd.subheading.heading2.elements[0].text_run.text_element_style)
      .toMatchObject({ text_color: 3 });
    expect(serialized).not.toContain("示例公司甲介绍正文");
    expect(serialized).not.toContain("示例工作内容");
  });

  it("requires unique target headings and a complete root-level company template", () => {
    const duplicate = structuredClone(fixture.items);
    duplicate.push({
      block_id: "duplicate-jd-heading",
      parent_id: "page",
      block_type: 3,
      heading1: { elements: [{ text_run: { content: "岗位JD整理" } }], style: {} },
      children: []
    });
    duplicate[0].children.push("duplicate-jd-heading");
    expect(() => inspect(duplicate)).toThrow("must appear exactly once");

    const incomplete = structuredClone(fixture.items);
    const quote = incomplete.find((block) => block.block_id === "jd-company-a-quote-1");
    quote.block_type = 2;
    quote.text = { elements: [{ text_run: { content: "不是引用容器" } }], style: {} };
    delete quote.quote_container;
    let failure;
    try {
      inspect(incomplete);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      message: "No complete JD company template was found",
      reasonCode: "jd-job-quote",
      companyName: "示例公司甲",
      jobTitle: "示例岗位甲"
    });
  });

  it("accepts legacy wording inside an existing quote container", () => {
    const legacy = structuredClone(fixture.items);
    const workLabel = legacy.find((block) => block.block_id === "jd-company-b-work-label");
    const requirementLabel = legacy.find((block) => block.block_id === "jd-company-b-require-label");
    workLabel.text.elements[0].text_run.content = "岗位职责：";
    requirementLabel.text.elements[0].text_run.content = "任职要求：";

    const snapshot = inspect(legacy);

    expect(snapshot.jd.companies).toHaveLength(2);
    expect(snapshot.jd.companies[1].jobs).toEqual([
      expect.objectContaining({ title: "示例岗位乙", ordinal: 1 })
    ]);
  });

  it("ignores empty root paragraphs between structural JD blocks", () => {
    const withBlanks = structuredClone(fixture.items);
    const page = withBlanks.find((block) => block.block_id === "page");
    const blankAfterCompany = {
      block_id: "blank-after-company-a",
      parent_id: "page",
      block_type: 2,
      text: { elements: [{ text_run: { content: "" } }], style: {} },
      children: []
    };
    const blankBeforeQuote = {
      block_id: "blank-before-company-a-quote",
      parent_id: "page",
      block_type: 2,
      text: { elements: [{ text_run: { content: "  " } }], style: {} },
      children: []
    };
    withBlanks.push(blankAfterCompany, blankBeforeQuote);
    page.children.splice(page.children.indexOf("jd-company-a") + 1, 0, blankAfterCompany.block_id);
    page.children.splice(page.children.indexOf("jd-company-a-quote-1"), 0, blankBeforeQuote.block_id);

    const snapshot = inspect(withBlanks);

    expect(snapshot.jd.companies[0]).toMatchObject({
      name: "示例公司甲",
      jobs: [{ title: "示例岗位甲" }]
    });
  });

  it("finds a company introduction callout nested in a layout container", () => {
    const nested = structuredClone(fixture.items);
    const page = nested.find((block) => block.block_id === "page");
    const callout = nested.find((block) => block.block_id === "jd-company-a-intro-callout");
    const wrapper = {
      block_id: "jd-company-a-intro-layout",
      parent_id: "page",
      block_type: 25,
      grid_column: { width_ratio: 100 },
      children: [callout.block_id]
    };
    callout.parent_id = wrapper.block_id;
    page.children.splice(page.children.indexOf(callout.block_id), 1, wrapper.block_id);
    nested.push(wrapper);

    const snapshot = inspect(nested);

    expect(snapshot.jd.companies[0]).toMatchObject({
      name: "示例公司甲",
      introCalloutBlockId: "jd-company-a-intro-callout"
    });
    expect(snapshot.templates.jd.callout).toMatchObject({ block_type: 19 });
  });

  it("finds the open-jobs Heading 2 nested in a layout container", () => {
    const nested = structuredClone(fixture.items);
    const page = nested.find((block) => block.block_id === "page");
    const openHeading = nested.find((block) => block.block_id === "jd-company-a-open-heading");
    const wrapper = {
      block_id: "jd-company-a-open-layout",
      parent_id: "page",
      block_type: 25,
      grid_column: { width_ratio: 100 },
      children: [openHeading.block_id]
    };
    openHeading.parent_id = wrapper.block_id;
    page.children.splice(page.children.indexOf(openHeading.block_id), 1, wrapper.block_id);
    nested.push(wrapper);

    const snapshot = inspect(nested);

    expect(snapshot.jd.companies[0]).toMatchObject({
      name: "示例公司甲",
      openHeadingBlockId: "jd-company-a-open-heading",
      jobs: [{ title: "示例岗位甲" }]
    });
  });
});
