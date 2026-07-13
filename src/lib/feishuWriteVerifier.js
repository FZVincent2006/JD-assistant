import { BLOCK } from "./feishuBlockModel.js";
import { normalizeForMatch } from "./feishuOpenApiPlan.js";

export function verifyJdWrite(snapshot = {}, plan = {}) {
  const errors = [];
  verifyRevision(snapshot, errors);
  const companies = matchingCompanies(snapshot.jd?.companies, plan.companyName);
  if (companies.length !== 1) {
    errors.push(`公司“${plan.companyName}”未以唯一的 Heading 1 出现在岗位 JD 区。`);
    return result(errors);
  }

  const company = companies[0];
  if (company.parentBlockId !== snapshot.rootId || invalidOptionalType(company.blockType, BLOCK.HEADING1)) {
    errors.push(`公司“${plan.companyName}”必须是文档根级 Heading 1。`);
  }
  if (plan.mode === "new-company" && company.index !== plan.jdTarget?.index) {
    errors.push("新公司 Heading 1 不在计划位置。");
  }
  if (!company.introHeadingBlockId || invalidOptionalType(company.introHeadingBlockType, BLOCK.HEADING2)) {
    errors.push("岗位 JD 区缺少“公司介绍”Heading 2。");
  }
  if (!company.introCalloutBlockId) errors.push("岗位 JD 区缺少公司介绍 Callout。");
  if (!company.openHeadingBlockId || invalidOptionalType(company.openHeadingBlockType, BLOCK.HEADING2)) {
    errors.push("岗位 JD 区缺少“开放岗位”Heading 2。");
  }

  const jobs = company.jobs ?? [];
  if (jobs.length !== plan.expected?.totalJdJobs) {
    errors.push(`岗位 JD 区岗位数量应为 ${plan.expected?.totalJdJobs}，实际为 ${jobs.length}。`);
  }
  verifyPlannedJdJobs(jobs, plan, errors);
  return result(errors);
}

export function verifySummaryWrite(snapshot = {}, plan = {}) {
  const errors = [];
  verifyRevision(snapshot, errors);
  const companies = matchingCompanies(snapshot.portfolio?.companies, plan.companyName);
  if (companies.length !== 1) {
    errors.push(`公司“${plan.companyName}”未唯一出现在 Portfolio 区。`);
    return result(errors);
  }

  const company = companies[0];
  if (company.parentBlockId !== plan.summaryTarget?.parentBlockId) {
    errors.push("Portfolio 公司块不在计划的 Callout 中。");
  }
  if (invalidOptionalType(company.blockType, BLOCK.HEADING3)) {
    errors.push("Portfolio 公司块不是预期的 Heading 3。");
  }
  if (plan.mode === "new-company" && company.index !== plan.summaryTarget?.index) {
    errors.push("Portfolio 新公司不在计划位置。");
  }

  const jobs = company.jobs ?? [];
  if (jobs.length !== plan.expected?.totalSummaryJobs) {
    errors.push(`Portfolio 区岗位数量应为 ${plan.expected?.totalSummaryJobs}，实际为 ${jobs.length}。`);
  }
  verifyPlannedSummaryJobs(jobs, plan, errors);
  return result(errors);
}

function verifyPlannedJdJobs(jobs, plan, errors) {
  for (const [plannedIndex, planned] of (plan.jobs ?? []).entries()) {
    const matches = jobs.filter((job) => normalizeForMatch(job.title) === normalizeForMatch(planned.title));
    if (matches.length !== 1) {
      errors.push(`岗位 JD 区应且只能包含一个岗位“${planned.title}”。`);
      continue;
    }
    const persisted = matches[0];
    if (persisted.ordinal !== planned.ordinal) {
      errors.push(`岗位“${planned.title}”的序号应为 ${planned.ordinal}。`);
    }
    if (invalidOptionalType(persisted.blockType, BLOCK.HEADING3)) {
      errors.push(`岗位“${planned.title}”的标题不是 Heading 3。`);
    }
    if (!persisted.quoteBlockId) {
      errors.push(`岗位“${planned.title}”缺少 QuoteContainer。`);
    }
    const expectedText = `（${planned.ordinal}）${planned.title}｜${planned.location}｜${planned.employment}`;
    if (normalizeForMatch(persisted.text) !== normalizeForMatch(expectedText)) {
      errors.push(`岗位“${planned.title}”的标题文本不完整。`);
    }
    const expectedIndex = plan.mode === "new-company"
      ? plan.jdTarget.index + 4 + (plannedIndex * 2)
      : plan.jdTarget.index + (plannedIndex * 2);
    if (persisted.index !== expectedIndex) {
      errors.push(`岗位“${planned.title}”不在计划的根级位置。`);
    }
  }
}

function verifyPlannedSummaryJobs(jobs, plan, errors) {
  for (const [plannedIndex, planned] of (plan.jobs ?? []).entries()) {
    const matches = jobs.filter((job) => normalizeForMatch(job.title) === normalizeForMatch(planned.title));
    if (matches.length !== 1) {
      errors.push(`Portfolio 区应且只能包含一个岗位“${planned.title}”。`);
      continue;
    }
    const persisted = matches[0];
    if (invalidOptionalType(persisted.blockType, BLOCK.BULLET)) {
      errors.push(`岗位“${planned.title}”不是 Portfolio Bullet。`);
    }
    const expectedText = `${planned.title}｜${planned.location}｜${planned.employment}`;
    if (normalizeForMatch(persisted.text) !== normalizeForMatch(expectedText)) {
      errors.push(`岗位“${planned.title}”的 Portfolio Bullet 完整文本不正确。`);
    }
    const expectedIndex = plan.mode === "new-company"
      ? plan.summaryTarget.index + 1 + plannedIndex
      : plan.summaryTarget.index + plannedIndex;
    if (persisted.index !== expectedIndex) {
      errors.push(`岗位“${planned.title}”不在 Portfolio 计划位置。`);
    }
  }
}

function matchingCompanies(companies = [], companyName) {
  const normalized = normalizeForMatch(companyName);
  return companies.filter((company) => normalizeForMatch(company.name) === normalized);
}

function invalidOptionalType(value, expected) {
  return value !== undefined && value !== expected;
}

function result(errors) {
  return { ok: errors.length === 0, errors };
}

function verifyRevision(snapshot, errors) {
  if (!Number.isInteger(snapshot.revisionId) || snapshot.revisionId < 0) {
    errors.push("飞书回读结果缺少有效的文档版本号。");
  }
}
