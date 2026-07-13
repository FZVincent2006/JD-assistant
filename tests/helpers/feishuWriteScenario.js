import fixture from "../fixtures/feishu-structural-sample.json";
import { buildBlockModel } from "../../src/lib/feishuBlockModel.js";
import { buildFeishuOpenApiPlan } from "../../src/lib/feishuOpenApiPlan.js";
import { inspectRecruitingDocument } from "../../src/lib/feishuTemplateReader.js";

export const draft = {
  companyName: "CoFANCY 可糖",
  website: "https://example.com",
  companyIntro: ["公司介绍。"],
  jobs: [
    {
      title: "品牌设计",
      location: "上海",
      employment: "社招",
      responsibilities: ["建设品牌。"],
      requirements: ["三年经验。"],
      bonuses: []
    },
    {
      title: "销售主管/分销主管",
      location: "深圳",
      employment: "社招",
      responsibilities: ["管理渠道。"],
      requirements: ["五年经验。"],
      bonuses: []
    }
  ]
};

export function initialSnapshot() {
  return inspectRecruitingDocument(buildBlockModel(structuredClone(fixture.items), fixture.revision_id));
}

export function successfulSnapshots() {
  const initial = initialSnapshot();
  const plan = buildFeishuOpenApiPlan(initial, draft);
  const jd = structuredClone(initial);
  jd.revisionId += 1;
  jd.jd.companies.unshift({
    name: draft.companyName,
    headingBlockId: "new-company-heading",
    blockType: 3,
    parentBlockId: jd.rootId,
    index: plan.jdTarget.index,
    endIndex: plan.jdTarget.index + 8,
    introHeadingBlockId: "new-intro-heading",
    introHeadingBlockType: 4,
    introCalloutBlockId: "new-intro-callout",
    openHeadingBlockId: "new-open-heading",
    openHeadingBlockType: 4,
    jobs: plan.jobs.map((job, index) => ({
      title: job.title,
      ordinal: job.ordinal,
      text: `（${job.ordinal}）${job.title}｜${job.location}｜${job.employment}`,
      blockId: `new-job-${index + 1}`,
      blockType: 5,
      quoteBlockId: `new-quote-${index + 1}`,
      index: plan.jdTarget.index + 4 + (index * 2)
    }))
  });

  const complete = structuredClone(jd);
  complete.revisionId += 1;
  complete.portfolio.companies.unshift({
    name: draft.companyName,
    headingBlockId: "new-summary-company",
    blockType: 5,
    parentBlockId: complete.portfolio.parentBlockId,
    index: plan.summaryTarget.index,
    jobs: plan.jobs.map((job, index) => ({
      title: job.title,
      text: `${job.title}｜${job.location}｜${job.employment}`,
      blockId: `new-summary-job-${index + 1}`,
      blockType: 12,
      index: plan.summaryTarget.index + 1 + index
    }))
  });
  return { initial, plan, jd, complete };
}
