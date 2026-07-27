import { describe, expect, it } from "vitest";
import { PRODUCTION_FEISHU_DOC_URL } from "../src/lib/feishuConfig.js";
import {
  buildJobAnchorUrl,
  buildJobLinkRepairPlan,
  resolvePlannedJobLinks
} from "../src/lib/feishuJobLinks.js";
import {
  initialSnapshot,
  successfulSnapshots
} from "./helpers/feishuWriteScenario.js";

describe("Feishu job block anchors", () => {
  it("builds a production-document anchor from a validated block ID", () => {
    expect(buildJobAnchorUrl("RzVZdfII4odibZxouyzcVxKln7c"))
      .toBe(`${PRODUCTION_FEISHU_DOC_URL}#RzVZdfII4odibZxouyzcVxKln7c`);
    expect(() => buildJobAnchorUrl("bad#fragment")).toThrow("block ID");
    expect(() => buildJobAnchorUrl("")).toThrow("block ID");
  });

  it("resolves every planned job to one persisted JD heading after read-back", () => {
    const { plan, unnumberedJd } = successfulSnapshots();

    const result = resolvePlannedJobLinks(unnumberedJd, plan);

    expect(result).toEqual({
      ok: true,
      jobs: [
        expect.objectContaining({
          title: "品牌设计",
          linkUrl: `${PRODUCTION_FEISHU_DOC_URL}#new-job-1`
        }),
        expect.objectContaining({
          title: "销售主管/分销主管",
          linkUrl: `${PRODUCTION_FEISHU_DOC_URL}#new-job-2`
        })
      ],
      errors: []
    });
  });

  it("rejects a duplicate or missing JD target instead of guessing", () => {
    const { plan, unnumberedJd } = successfulSnapshots();
    const duplicate = structuredClone(unnumberedJd.jd.companies[0].jobs[0]);
    duplicate.blockId = "duplicate-job-heading";
    unnumberedJd.jd.companies[0].jobs.push(duplicate);

    const duplicated = resolvePlannedJobLinks(unnumberedJd, plan);
    expect(duplicated.ok).toBe(false);
    expect(duplicated.errors.join("；")).toContain("品牌设计");

    unnumberedJd.jd.companies = [];
    const missing = resolvePlannedJobLinks(unnumberedJd, plan);
    expect(missing.ok).toBe(false);
    expect(missing.errors.join("；")).toContain("CoFANCY 可糖");
  });
});

describe("historical Portfolio job-link repair plans", () => {
  it("plans one in-place update per unlinked Portfolio job", () => {
    const snapshot = initialSnapshot();

    const plan = buildJobLinkRepairPlan(snapshot);

    expect(plan).toMatchObject({
      ok: true,
      baseRevisionId: 7,
      totalJobs: 2,
      correctLinks: 0,
      errors: []
    });
    expect(plan.updates).toEqual([
      expect.objectContaining({
        companyName: "示例公司甲",
        jobText: "示例岗位甲｜上海｜社招",
        blockId: "summary-job-a1",
        linkUrl: `${PRODUCTION_FEISHU_DOC_URL}#jd-company-a-job-1`
      }),
      expect.objectContaining({
        companyName: "示例公司乙",
        jobText: "示例岗位乙｜深圳｜社招",
        blockId: "summary-job-b1",
        linkUrl: `${PRODUCTION_FEISHU_DOC_URL}#jd-company-b-job-1`
      })
    ]);
    expect(plan.updates[0].elements).toEqual([{
      text_run: {
        content: "示例岗位甲｜上海｜社招",
        text_element_style: {
          link: { url: `${PRODUCTION_FEISHU_DOC_URL}#jd-company-a-job-1` }
        }
      }
    }]);
  });

  it("is idempotent when every text run already has the canonical target", () => {
    const snapshot = initialSnapshot();
    for (const [companyIndex, company] of snapshot.portfolio.companies.entries()) {
      const target = snapshot.jd.companies[companyIndex].jobs[0];
      const url = buildJobAnchorUrl(target.blockId);
      company.jobs[0].linkUrl = url;
      company.jobs[0].elements[0].text_run.text_element_style = {
        bold: true,
        link: { url }
      };
    }

    const plan = buildJobLinkRepairPlan(snapshot);

    expect(plan).toMatchObject({
      ok: true,
      totalJobs: 2,
      correctLinks: 2,
      updates: [],
      errors: []
    });
  });

  it("preserves existing Feishu selection links instead of rewriting them", () => {
    const snapshot = initialSnapshot();
    const job = snapshot.portfolio.companies[0].jobs[0];
    const selectionUrl = `${PRODUCTION_FEISHU_DOC_URL}#share-YvKtd8t8joNewExlyrhckYQAngb`;
    job.linkUrl = selectionUrl;
    job.elements[0].text_run.text_element_style = {
      link: { url: selectionUrl }
    };

    const plan = buildJobLinkRepairPlan(snapshot);

    expect(plan.ok).toBe(true);
    expect(plan.correctLinks).toBe(1);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].companyName).toBe("示例公司乙");
  });

  it("keeps safe updates executable while reporting unrelated manual issues", () => {
    const snapshot = initialSnapshot();
    snapshot.portfolio.companies[0].jobs[0].elements[0].text_run.text_element_style = {
      link: { url: "https://example.com/legacy" }
    };

    const plan = buildJobLinkRepairPlan(snapshot);

    expect(plan).toMatchObject({
      ok: true,
      totalJobs: 2,
      correctLinks: 0,
      errors: []
    });
    expect(plan.updates.map((item) => item.blockId)).toEqual(["summary-job-b1"]);
    expect(plan.issues).toHaveLength(1);
    expect(plan.issues[0].message).toContain("已有链接");
    expect(plan.issues[0].blockId).toBe("summary-job-a1");
  });

  it("returns an executable manual-only plan when no safe update remains", () => {
    const snapshot = initialSnapshot();
    for (const company of snapshot.portfolio.companies) {
      company.jobs[0].elements[0].text_run.text_element_style = {
        link: { url: "https://example.com/legacy" }
      };
    }

    const plan = buildJobLinkRepairPlan(snapshot);

    expect(plan.ok).toBe(true);
    expect(plan.updates).toEqual([]);
    expect(plan.issues).toHaveLength(2);
    expect(plan.errors).toEqual([]);
  });

  it("preserves existing run styles while adding a missing target", () => {
    const snapshot = initialSnapshot();
    const job = snapshot.portfolio.companies[0].jobs[0];
    job.linkUrl = "";
    job.elements = [{
      text_run: {
        content: "示例岗位甲｜",
        text_element_style: { bold: true }
      }
    }, {
      text_run: {
        content: "上海｜社招",
        text_element_style: { text_color: 2 }
      }
    }];

    const plan = buildJobLinkRepairPlan(snapshot);
    const update = plan.updates.find((item) => item.blockId === job.blockId);

    expect(update.elements).toEqual([
      {
        text_run: {
          content: "示例岗位甲｜",
          text_element_style: {
            bold: true,
            link: { url: `${PRODUCTION_FEISHU_DOC_URL}#jd-company-a-job-1` }
          }
        }
      },
      {
        text_run: {
          content: "上海｜社招",
          text_element_style: {
            text_color: 2,
            link: { url: `${PRODUCTION_FEISHU_DOC_URL}#jd-company-a-job-1` }
          }
        }
      }
    ]);
  });

  it("reports ambiguous jobs, unsafe existing links, and non-text elements as manual issues", () => {
    const ambiguous = initialSnapshot();
    const duplicate = structuredClone(ambiguous.jd.companies[0].jobs[0]);
    duplicate.blockId = "duplicate-job-heading";
    ambiguous.jd.companies[0].jobs.push(duplicate);
    const ambiguousPlan = buildJobLinkRepairPlan(ambiguous);
    expect(ambiguousPlan.ok).toBe(true);
    expect(ambiguousPlan.errors).toEqual([]);
    expect(ambiguousPlan.issues.map((issue) => issue.message).join("；")).toContain("示例岗位甲");

    const external = initialSnapshot();
    external.portfolio.companies[0].jobs[0].linkUrl = "https://example.com/wrong";
    external.portfolio.companies[0].jobs[0].elements[0].text_run.text_element_style = {
      link: { url: "https://example.com/wrong" }
    };
    const externalPlan = buildJobLinkRepairPlan(external);
    expect(externalPlan.ok).toBe(true);
    expect(externalPlan.issues.map((issue) => issue.message).join("；")).toContain("已有链接");
    expect(externalPlan.updates.some((item) => item.blockId === "summary-job-a1")).toBe(false);

    const mixed = initialSnapshot();
    mixed.portfolio.companies[0].jobs[0].elements = [
      { text_run: { content: "示例岗位甲｜", text_element_style: {
        link: { url: `${PRODUCTION_FEISHU_DOC_URL}#share-one` }
      } } },
      { text_run: { content: "上海｜社招" } }
    ];
    const mixedPlan = buildJobLinkRepairPlan(mixed);
    expect(mixedPlan.ok).toBe(true);
    expect(mixedPlan.issues.map((issue) => issue.message).join("；")).toContain("混合");

    const nonText = initialSnapshot();
    nonText.portfolio.companies[0].jobs[0].elements = [{
      mention_user: { user_id: "ou_private" }
    }];
    const nonTextPlan = buildJobLinkRepairPlan(nonText);
    expect(nonTextPlan.ok).toBe(true);
    expect(nonTextPlan.issues.map((issue) => issue.message).join("；")).toContain("富文本");
  });

  it("rejects a batch larger than the single-request safety limit", () => {
    const snapshot = initialSnapshot();
    const portfolioCompany = snapshot.portfolio.companies[0];
    const jdCompany = snapshot.jd.companies[0];
    portfolioCompany.jobs = [];
    jdCompany.jobs = [];
    for (let index = 0; index < 201; index += 1) {
      portfolioCompany.jobs.push({
        title: `岗位${index}`,
        location: "上海",
        employment: "社招",
        text: `岗位${index}｜上海｜社招`,
        blockId: `summary-${index}`,
        linkUrl: "",
        elements: [{ text_run: { content: `岗位${index}｜上海｜社招` } }]
      });
      jdCompany.jobs.push({
        title: `岗位${index}`,
        location: "上海",
        employment: "社招",
        blockId: `jd-${index}`
      });
    }
    snapshot.portfolio.companies = [portfolioCompany];
    snapshot.jd.companies = [jdCompany];

    const plan = buildJobLinkRepairPlan(snapshot);

    expect(plan.ok).toBe(false);
    expect(plan.errors.join("；")).toContain("200");
  });
});
