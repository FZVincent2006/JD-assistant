// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  PRODUCTION_FEISHU_DOC_URL,
  findFeishuInsertionTarget,
  inspectFeishuDocument,
  isAllowedFeishuDocument
} from "../src/content/feishuDocument.js";

function makeDocument() {
  document.body.innerHTML = `
    <button>编辑</button>
    <div class="block docx-heading1-block" data-block-id="p"><div contenteditable="true">📁 Portfolio开放岗位汇总</div></div>
    <div class="block docx-callout-block" data-block-id="summary">
      <div class="block docx-heading3-block callout-render-unit" data-block-id="s1"><div contenteditable="true">CoFANCY 可糖</div></div>
      <div class="block docx-bullet-block callout-render-unit" data-block-id="s2"><div contenteditable="true">品牌设计｜上海｜社招</div></div>
      <div class="block docx-heading3-block callout-render-unit" data-block-id="s3"><div contenteditable="true">闪念贝壳</div></div>
      <div class="block docx-bullet-block callout-render-unit" data-block-id="s4"><div contenteditable="true">Agent 工程师｜深圳｜社招</div></div>
    </div>
    <div class="block docx-heading1-block" data-block-id="j"><div contenteditable="true">💻 岗位JD整理</div></div>
    <div class="block docx-heading1-block" data-block-id="c1"><button class="heading-order">1.</button><div contenteditable="true">CoFANCY 可糖</div></div>
    <div class="block docx-heading2-block" data-block-id="c1i"><div contenteditable="true">公司介绍</div></div>
    <div class="block docx-heading1-block" data-block-id="c1o"><div contenteditable="true">开放岗位</div></div>
    <div class="block docx-heading3-block" data-block-id="c1j"><div contenteditable="true">（1）品牌设计｜上海｜社招</div></div>
    <div class="block docx-text-block" data-block-id="c1b"><div contenteditable="true">正文</div></div>
    <div class="block docx-heading1-block" data-block-id="c2"><button class="heading-order">2.</button><div contenteditable="true">闪念贝壳</div></div>
    <div class="block docx-heading2-block" data-block-id="c2i"><div contenteditable="true">公司介绍</div></div>
    <div class="block docx-heading1-block" data-block-id="c2o"><div contenteditable="true">开放岗位</div></div>
    <div class="block docx-heading3-block" data-block-id="c2j"><div contenteditable="true">（1）Agent 工程师｜深圳｜社招</div></div>
    <div class="block docx-text-block" data-block-id="c2b"><div contenteditable="true">正文</div></div>
  `;
  return document;
}

describe("isAllowedFeishuDocument", () => {
  it("only allows the configured production document regardless of query or hash", () => {
    expect(PRODUCTION_FEISHU_DOC_URL).toContain("RTWjwVZjri4uCUk0J8wcn2K3n6d");
    expect(isAllowedFeishuDocument(`${PRODUCTION_FEISHU_DOC_URL}?fromScene=spaceOverview#block`)).toBe(true);
    expect(isAllowedFeishuDocument("https://zhenfund.feishu.cn/wiki/LlhrwSLIvilANZk1opwcQGlUnNv")).toBe(false);
  });
});

describe("inspectFeishuDocument", () => {
  it("extracts company and job structure from both target regions", () => {
    const snapshot = inspectFeishuDocument(makeDocument());
    expect(snapshot).toEqual({
      editable: true,
      portfolioHeadingCount: 1,
      jdHeadingCount: 1,
      portfolioCompanies: [
        { name: "CoFANCY 可糖", jobs: ["品牌设计"] },
        { name: "闪念贝壳", jobs: ["Agent 工程师"] }
      ],
      jdCompanies: [
        { name: "CoFANCY 可糖", jobs: ["品牌设计"] },
        { name: "闪念贝壳", jobs: ["Agent 工程师"] }
      ]
    });
  });
});

describe("findFeishuInsertionTarget", () => {
  it("targets the first company for new-company insertion", () => {
    const doc = makeDocument();
    const plan = { mode: "new-company" };
    expect(findFeishuInsertionTarget(doc, plan, "summary")).toMatchObject({ blockId: "s1", position: "start" });
    expect(findFeishuInsertionTarget(doc, plan, "jd")).toMatchObject({ blockId: "c1", position: "start" });
  });

  it("targets the next company boundary when appending to an existing company", () => {
    const doc = makeDocument();
    const plan = { mode: "append-jobs", companyName: "CoFANCY 可糖" };
    expect(findFeishuInsertionTarget(doc, plan, "summary")).toMatchObject({ blockId: "s3", position: "start" });
    expect(findFeishuInsertionTarget(doc, plan, "jd")).toMatchObject({ blockId: "c2", position: "start" });
  });

  it("uses the last block when appending to the final company", () => {
    const doc = makeDocument();
    const plan = { mode: "append-jobs", companyName: "闪念贝壳" };
    expect(findFeishuInsertionTarget(doc, plan, "summary")).toMatchObject({ blockId: "s4", position: "end" });
    expect(findFeishuInsertionTarget(doc, plan, "jd")).toMatchObject({ blockId: "c2b", position: "end" });
  });
});
