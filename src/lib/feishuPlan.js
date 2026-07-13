export { buildFeishuOpenApiPlan } from "./feishuOpenApiPlan.js";

export function buildFeishuWritePlan(snapshot = {}, draft = {}) {
  const errors = validateSnapshot(snapshot);
  const companyName = draft.companyName?.trim() ?? "";
  const portfolioMatches = matchingCompanies(snapshot.portfolioCompanies, companyName);
  const jdMatches = matchingCompanies(snapshot.jdCompanies, companyName);

  if (portfolioMatches.length > 1 || jdMatches.length > 1) {
    errors.push("公司名在目标区域中不唯一，已停止写入。");
  } else if (portfolioMatches.length !== jdMatches.length) {
    errors.push("公司只存在于一个目标区域，文档结构不一致。");
  }

  const mode = portfolioMatches.length === 1 && jdMatches.length === 1 ? "append-jobs" : "new-company";
  const existingPortfolioJobs = portfolioMatches[0]?.jobs ?? [];
  const existingJdJobs = jdMatches[0]?.jobs ?? [];
  const existingTitles = new Set([...existingPortfolioJobs, ...existingJdJobs].map(normalizeText));
  const draftTitles = new Set();

  for (const job of draft.jobs ?? []) {
    const title = normalizeText(job.title);
    if (draftTitles.has(title)) {
      errors.push(`本次输入包含重复岗位“${job.title}”，已停止写入。`);
    } else if (existingTitles.has(title)) {
      errors.push(`岗位“${job.title}”已存在，已停止写入。`);
    }
    draftTitles.add(title);
  }

  const firstOrdinal = mode === "append-jobs" ? existingJdJobs.length + 1 : 1;
  const jobs = (draft.jobs ?? []).map((job, index) => ({ title: job.title, ordinal: firstOrdinal + index }));

  return { ok: errors.length === 0, mode, companyName, jobs, errors };
}

function validateSnapshot(snapshot) {
  const errors = [];
  if (!snapshot.editable) errors.push("当前文档不可编辑。");
  if (snapshot.portfolioHeadingCount !== 1) errors.push("“Portfolio开放岗位汇总”标题必须且只能出现一次。");
  if (snapshot.jdHeadingCount !== 1) errors.push("“岗位JD整理”标题必须且只能出现一次。");
  return errors;
}

function matchingCompanies(companies = [], companyName) {
  const target = normalizeText(companyName);
  return companies.filter((company) => normalizeText(company.name) === target);
}

function normalizeText(value = "") {
  return String(value).replace(/\s+/g, " ").trim().toLocaleLowerCase();
}
