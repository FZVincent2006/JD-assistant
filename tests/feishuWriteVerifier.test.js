import { describe, expect, it } from "vitest";
import { buildFeishuOpenApiPlan } from "../src/lib/feishuOpenApiPlan.js";
import { verifyJdWrite, verifySummaryWrite } from "../src/lib/feishuWriteVerifier.js";
import { draft, initialSnapshot, successfulSnapshots } from "./helpers/feishuWriteScenario.js";

describe("Feishu persisted-write verification", () => {
  it("accepts a root Heading 1 without Feishu automatic numbering", () => {
    const { plan, unnumberedJd } = successfulSnapshots();

    expect(verifyJdWrite(unnumberedJd, plan)).toEqual({ ok: true, errors: [] });
  });

  it("accepts only the complete root-level JD and exact summary structure", () => {
    const { plan, jd, complete } = successfulSnapshots();

    expect(verifyJdWrite(jd, plan)).toEqual({ ok: true, errors: [] });
    expect(verifySummaryWrite(complete, plan)).toEqual({ ok: true, errors: [] });
  });

  it("rejects a company nested under the previous company or rendered at the wrong heading level", () => {
    const { plan, jd } = successfulSnapshots();
    jd.jd.companies[0].parentBlockId = "previous-company";
    jd.jd.companies[0].blockType = 4;

    const result = verifyJdWrite(jd, plan);

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("Heading 1");
    expect(result.errors.join(" ")).toContain("根级");
  });

  it("rejects the wrong sibling index, missing Callout, or missing QuoteContainer", () => {
    const { plan, jd } = successfulSnapshots();
    jd.jd.companies[0].index += 1;
    jd.jd.companies[0].introCalloutBlockId = "";
    jd.jd.companies[0].jobs[0].quoteBlockId = "";

    const result = verifyJdWrite(jd, plan);

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("计划位置");
    expect(result.errors.join(" ")).toContain("Callout");
    expect(result.errors.join(" ")).toContain("QuoteContainer");
  });

  it("accepts the real document's gray Heading 1 for 开放岗位", () => {
    const { plan, jd } = successfulSnapshots();
    jd.jd.companies[0].openHeadingBlockType = 3;

    expect(verifyJdWrite(jd, plan)).toEqual({ ok: true, errors: [] });
  });

  it("verifies both sections during an unnumbered JD-only recovery", () => {
    const { unnumberedJd, complete } = successfulSnapshots();
    const plan = buildFeishuOpenApiPlan(unnumberedJd, draft);

    expect(plan.mode).toBe("resume-new-company");
    expect(verifyJdWrite(unnumberedJd, plan)).toEqual({ ok: true, errors: [] });
    expect(verifySummaryWrite(complete, plan)).toEqual({ ok: true, errors: [] });
  });

  it("rejects wrong job counts, ordinals, title text, and root sibling positions", () => {
    const { plan, jd } = successfulSnapshots();
    jd.jd.companies[0].jobs.pop();
    jd.jd.companies[0].jobs[0].ordinal = 9;
    jd.jd.companies[0].jobs[0].text = "错误标题";
    jd.jd.companies[0].jobs[0].index += 1;

    const result = verifyJdWrite(jd, plan);

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("岗位数量");
    expect(result.errors.join(" ")).toContain("序号");
    expect(result.errors.join(" ")).toContain("标题文本");
    expect(result.errors.join(" ")).toContain("根级位置");
  });

  it("rejects summary blocks at the wrong position or with incomplete Bullet text", () => {
    const { plan, complete } = successfulSnapshots();
    complete.portfolio.companies[0].index += 1;
    complete.portfolio.companies[0].jobs[0].text = "品牌设计";
    complete.portfolio.companies[0].jobs[1].blockType = 2;

    const result = verifySummaryWrite(complete, plan);

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("计划位置");
    expect(result.errors.join(" ")).toContain("Bullet");
    expect(result.errors.join(" ")).toContain("完整文本");
  });

  it("verifies append targets without requiring a second company heading", () => {
    const current = initialSnapshot();
    current.portfolio.companies[0].name = draft.companyName;
    current.jd.companies[0].name = draft.companyName;
    const appendedDraft = { ...draft, jobs: [{ ...draft.jobs[0], title: "新增岗位" }] };
    const plan = buildFeishuOpenApiPlan(current, appendedDraft);
    const after = structuredClone(current);
    after.jd.companies[0].jobs.push({
      title: "新增岗位",
      ordinal: 2,
      text: "（2）新增岗位｜上海｜社招",
      blockId: "appended-job",
      blockType: 5,
      quoteBlockId: "appended-quote",
      index: plan.jdTarget.index
    });
    after.portfolio.companies[0].jobs.push({
      title: "新增岗位",
      text: "新增岗位｜上海｜社招",
      blockId: "appended-summary-job",
      blockType: 12,
      index: plan.summaryTarget.index
    });

    expect(plan.mode).toBe("append-jobs");
    expect(verifyJdWrite(after, plan).ok).toBe(true);
    expect(verifySummaryWrite(after, plan).ok).toBe(true);
  });

  it("requires a fresh document revision before allowing the next phase", () => {
    const { plan, jd, complete } = successfulSnapshots();
    jd.revisionId = undefined;
    complete.revisionId = -1;

    expect(verifyJdWrite(jd, plan).errors.join(" ")).toContain("版本号");
    expect(verifySummaryWrite(complete, plan).errors.join(" ")).toContain("版本号");
  });
});
