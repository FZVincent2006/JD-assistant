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
    expect(() => inspect(incomplete)).toThrow("complete JD company template");
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
});
