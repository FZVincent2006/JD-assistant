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
    expect(snapshot.jd.companies.map((company) => company.headingSequence)).toEqual(["auto", "auto"]);
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

  it("requires unique target headings", () => {
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

  });

  it("keeps historical jobs with nonstandard bodies and selects a later reusable quote template", () => {
    const mixed = structuredClone(fixture.items);
    const firstQuote = mixed.find((block) => block.block_id === "jd-company-a-quote-1");
    firstQuote.block_type = 2;
    firstQuote.text = { elements: [{ text_run: { content: "历史正文不是引用容器" } }], style: {} };
    delete firstQuote.quote_container;
    const secondQuoteLabel = mixed.find((block) => block.block_id === "jd-company-b-work-label");
    secondQuoteLabel.text.elements[0].text_run.text_element_style = { text_color: 6 };

    const snapshot = inspect(mixed);

    expect(snapshot.jd.companies[0].jobs).toEqual([
      expect.objectContaining({ title: "示例岗位甲", quoteBlockId: "" })
    ]);
    expect(snapshot.jd.companies[1].jobs).toEqual([
      expect.objectContaining({ title: "示例岗位乙", quoteBlockId: "jd-company-b-quote-1" })
    ]);
    expect(snapshot.templates.jd.quote).toMatchObject({ block_type: 34 });
    expect(snapshot.templates.jd.quoteText).toMatchObject({
      block_type: 2,
      text: { elements: [{ text_run: { text_element_style: { text_color: 6 } } }] }
    });
    expect(JSON.stringify(snapshot.templates.jd)).not.toContain("历史正文不是引用容器");
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

  it("treats a gray Heading 1 named 开放岗位 as a section heading, not a company", () => {
    const actual = structuredClone(fixture.items);
    const openHeading = actual.find((block) => block.block_id === "jd-company-a-open-heading");
    openHeading.block_type = 3;
    openHeading.heading1 = openHeading.heading2;
    delete openHeading.heading2;

    const snapshot = inspect(actual);

    expect(snapshot.jd.companies).toHaveLength(2);
    expect(snapshot.jd.companies[0]).toMatchObject({
      name: "示例公司甲",
      openHeadingBlockId: "jd-company-a-open-heading",
      openHeadingBlockType: 3,
      jobs: [{ title: "示例岗位甲" }]
    });
    expect(snapshot.templates.jd.openHeading).toMatchObject({ block_type: 3 });
  });

  it("allows legacy plain-text introductions and selects a later Bullet callout as the write template", () => {
    const mixed = structuredClone(fixture.items);
    const firstIntro = mixed.find((block) => block.block_id === "jd-company-a-intro-bullet");
    firstIntro.block_type = 2;
    firstIntro.text = firstIntro.bullet;
    delete firstIntro.bullet;
    const secondIntro = mixed.find((block) => block.block_id === "jd-company-b-intro-bullet");
    secondIntro.bullet.elements[0].text_run.text_element_style = { text_color: 7 };

    const snapshot = inspect(mixed);

    expect(snapshot.jd.companies).toHaveLength(2);
    expect(snapshot.templates.jd.introBullet).toMatchObject({
      block_type: 12,
      bullet: {
        elements: [{ text_run: { text_element_style: { text_color: 7 } } }]
      }
    });
    expect(JSON.stringify(snapshot.templates.jd)).not.toContain("示例公司乙介绍正文");
  });

  it("keeps a legacy company even when none of its job headings match the canonical pattern", () => {
    const mixed = structuredClone(fixture.items);
    const secondJob = mixed.find((block) => block.block_id === "jd-company-b-job-1");
    secondJob.heading3.elements[0].text_run.content = "招聘详情";

    const snapshot = inspect(mixed);

    expect(snapshot.jd.companies).toHaveLength(2);
    expect(snapshot.jd.companies[1]).toMatchObject({
      name: "示例公司乙",
      jobs: []
    });
    expect(snapshot.templates.jd.jobTitle).toMatchObject({ block_type: 5 });
    expect(snapshot.templates.jd.quote).toMatchObject({ block_type: 34 });
  });

  it("reads incomplete historical company sections and selects complete templates from another company", () => {
    const mixed = structuredClone(fixture.items);
    const page = mixed.find((block) => block.block_id === "page");
    const removedIds = new Set([
      "jd-company-a-intro-heading",
      "jd-company-a-intro-callout",
      "jd-company-a-intro-bullet",
      "jd-company-a-open-heading"
    ]);
    page.children = page.children.filter((id) => !removedIds.has(id));
    const remaining = mixed.filter((block) => !removedIds.has(block.block_id));
    const secondIntroHeading = remaining.find((block) => block.block_id === "jd-company-b-intro-heading");
    secondIntroHeading.heading2.elements[0].text_run.text_element_style = { text_color: 8 };

    const snapshot = inspect(remaining);

    expect(snapshot.jd.companies[0]).toMatchObject({
      name: "示例公司甲",
      introHeadingBlockId: "",
      introCalloutBlockId: "",
      openHeadingBlockId: "",
      jobs: [{ title: "示例岗位甲" }]
    });
    expect(snapshot.templates.jd.subheading).toMatchObject({
      block_type: 4,
      heading2: {
        elements: [{ text_run: { text_element_style: { text_color: 8 } } }]
      }
    });
    expect(snapshot.templates.jd.callout).toMatchObject({ block_type: 19 });
  });
});
