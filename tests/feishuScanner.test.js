import { describe, expect, it } from "vitest";
// @vitest-environment jsdom
import { findFeishuInsertionTargetFully, mergeFeishuSlices } from "../src/content/feishuScanner.js";

describe("mergeFeishuSlices", () => {
  it("merges virtualized company tokens across overlapping slices", () => {
    const snapshot = mergeFeishuSlices([
      {
        editable: true,
        portfolioHeadingIds: ["portfolio"],
        jdHeadingIds: [],
        portfolioTokens: [
          { type: "company", name: "CoFANCY 可糖" },
          { type: "job", title: "品牌设计" }
        ],
        jdTokens: []
      },
      {
        editable: true,
        portfolioHeadingIds: [],
        jdHeadingIds: ["jd"],
        portfolioTokens: [
          { type: "job", title: "销售主管" },
          { type: "company", name: "闪念贝壳" },
          { type: "job", title: "Agent 工程师" }
        ],
        jdTokens: [
          { type: "company", name: "CoFANCY 可糖" },
          { type: "job", title: "品牌设计" }
        ]
      },
      {
        editable: true,
        portfolioHeadingIds: [],
        jdHeadingIds: [],
        portfolioTokens: [],
        jdTokens: [
          { type: "job", title: "销售主管" },
          { type: "company", name: "闪念贝壳" },
          { type: "job", title: "Agent 工程师" }
        ]
      }
    ]);

    expect(snapshot).toEqual({
      editable: true,
      portfolioHeadingCount: 1,
      jdHeadingCount: 1,
      portfolioCompanies: [
        { name: "CoFANCY 可糖", jobs: ["品牌设计", "销售主管"] },
        { name: "闪念贝壳", jobs: ["Agent 工程师"] }
      ],
      jdCompanies: [
        { name: "CoFANCY 可糖", jobs: ["品牌设计", "销售主管"] },
        { name: "闪念贝壳", jobs: ["Agent 工程师"] }
      ]
    });
  });

  it("keeps distinct duplicate heading ids so preflight can reject them", () => {
    const snapshot = mergeFeishuSlices([
      { editable: true, portfolioHeadingIds: ["a"], jdHeadingIds: ["j1"], portfolioTokens: [], jdTokens: [] },
      { editable: true, portfolioHeadingIds: ["b"], jdHeadingIds: ["j2"], portfolioTokens: [], jdTokens: [] }
    ]);
    expect(snapshot.portfolioHeadingCount).toBe(2);
    expect(snapshot.jdHeadingCount).toBe(2);
  });

  it("keeps distinct same-name company blocks while deduplicating the same virtual block", () => {
    const snapshot = mergeFeishuSlices([
      {
        editable: true,
        portfolioHeadingIds: ["p"],
        jdHeadingIds: ["j"],
        portfolioTokens: [],
        jdTokens: [{ type: "company", id: "company-a", name: "重复公司" }]
      },
      {
        editable: true,
        portfolioHeadingIds: [],
        jdHeadingIds: [],
        portfolioTokens: [],
        jdTokens: [
          { type: "company", id: "company-a", name: "重复公司" },
          { type: "company", id: "company-b", name: "重复公司" }
        ]
      }
    ]);
    expect(snapshot.jdCompanies).toEqual([
      { name: "重复公司", jobs: [] },
      { name: "重复公司", jobs: [] }
    ]);
  });
});

describe("findFeishuInsertionTargetFully", () => {
  it("keeps final-company summary appends inside the summary callout", async () => {
    document.body.innerHTML = `
      <div class="bear-web-x-container">
        <div class="docx-heading1-block" data-block-id="portfolio"><div contenteditable="true">Portfolio开放岗位汇总</div></div>
        <div class="docx-callout-block" data-block-id="summary">
          <div class="docx-heading3-block callout-render-unit" data-block-id="s1"><div contenteditable="true">最后公司</div></div>
          <div class="docx-bullet-block callout-render-unit" data-block-id="s2"><div contenteditable="true">已有岗位｜上海｜社招</div></div>
        </div>
        <div class="docx-text-block" data-block-id="later"><div contenteditable="true">文档后续内容</div></div>
      </div>`;
    const scroll = document.querySelector(".bear-web-x-container");
    Object.defineProperties(scroll, {
      scrollHeight: { value: 1200 },
      clientHeight: { value: 500 }
    });

    const target = await findFeishuInsertionTargetFully(
      document,
      { mode: "append-jobs", companyName: "最后公司" },
      "summary",
      { portfolioCompanies: [{ name: "最后公司", jobs: ["已有岗位"] }], jdCompanies: [] },
      { settleMs: 0 }
    );

    expect(target).toMatchObject({ blockId: "s2", position: "end" });
  });
});
