import { describe, expect, it } from "vitest";
import { mergeFeishuSlices } from "../src/content/feishuScanner.js";

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
