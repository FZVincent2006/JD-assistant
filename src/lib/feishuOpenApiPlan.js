import { validateCompanyDraft } from "./companyJdParser.js";
import { matchResumeCompany } from "./feishuResumeMatcher.js";

const DASHES = /[‐‑‒–—―−﹘﹣－]/g;

export function buildFeishuOpenApiPlan(snapshot = {}, draft = {}) {
  const errors = validateInputs(snapshot, draft);
  const companyName = String(draft.companyName ?? "").trim();
  const portfolioMatches = matchingCompanies(snapshot.portfolio?.companies, companyName);
  const jdMatches = matchingCompanies(snapshot.jd?.companies, companyName);
  const resumeCandidate = portfolioMatches.length === 0 && jdMatches.length === 1;
  const resumeMatch = resumeCandidate ? matchResumeCompany(jdMatches[0], draft) : null;

  if (portfolioMatches.length > 1 || jdMatches.length > 1) {
    errors.push("公司名在目标区域中不唯一，已停止写入。");
  } else if (resumeCandidate) {
    if (!resumeMatch.ok) {
      errors.push(`现有岗位 JD 与本次草稿不完全一致：${resumeMatch.errors.join("、")}`);
    }
    if (jdMatches[0]?.index !== snapshot.jd?.firstCompanyIndex) {
      errors.push("现有岗位 JD 不在首家公司位置，不能安全恢复。");
    }
  } else if ((portfolioMatches.length === 1) !== (jdMatches.length === 1)) {
    errors.push("公司只存在于一个目标区域，文档结构不一致。");
  }

  const mode = resumeCandidate && resumeMatch.ok
    && jdMatches[0]?.index === snapshot.jd?.firstCompanyIndex
    ? "resume-new-company"
    : portfolioMatches.length === 1 && jdMatches.length === 1
      ? "append-jobs"
      : "new-company";
  const portfolioCompany = portfolioMatches[0];
  const jdCompany = jdMatches[0];
  const existingPortfolioJobs = portfolioCompany?.jobs ?? [];
  const existingJdJobs = jdCompany?.jobs ?? [];

  detectStoredDuplicates(existingPortfolioJobs, "Portfolio", errors);
  detectStoredDuplicates(existingJdJobs, "岗位 JD", errors);

  const existingTitles = new Set(
    (mode === "append-jobs" ? [...existingPortfolioJobs, ...existingJdJobs] : [])
      .map((job) => normalizeForMatch(job.title))
      .filter(Boolean)
  );
  const inputTitles = new Set();
  for (const job of draft.jobs ?? []) {
    const normalized = normalizeForMatch(job.title);
    if (!normalized) continue;
    if (inputTitles.has(normalized)) {
      errors.push(`本次输入包含重复岗位“${String(job.title).trim()}”，已停止写入。`);
    } else if (existingTitles.has(normalized)) {
      errors.push(`岗位“${String(job.title).trim()}”已存在，已停止写入。`);
    }
    inputTitles.add(normalized);
  }

  const nextOrdinal = mode === "append-jobs" ? maximumOrdinal(existingJdJobs) + 1 : 1;
  const jobs = (draft.jobs ?? []).map((job, index) => ({
    ...structuredClone(job),
    title: String(job.title ?? "").trim(),
    ordinal: mode === "resume-new-company"
      ? Number(existingJdJobs[index]?.ordinal)
      : nextOrdinal + index
  }));
  const jdTarget = mode === "append-jobs"
    ? { parentBlockId: snapshot.jd?.parentBlockId, index: jdCompany?.endIndex }
    : mode === "resume-new-company"
      ? { parentBlockId: snapshot.jd?.parentBlockId, index: jdCompany?.index }
    : { parentBlockId: snapshot.jd?.parentBlockId, index: snapshot.jd?.firstCompanyIndex };
  const summaryTarget = mode === "append-jobs"
    ? {
        parentBlockId: snapshot.portfolio?.parentBlockId,
        index: nextSummaryIndex(portfolioCompany)
      }
    : {
        parentBlockId: snapshot.portfolio?.parentBlockId,
        index: snapshot.portfolio?.firstCompanyIndex
      };

  validateTarget(jdTarget, "岗位 JD", errors);
  validateTarget(summaryTarget, "Portfolio", errors);

  return {
    ok: errors.length === 0,
    mode,
    baseRevisionId: snapshot.revisionId,
    companyName,
    jobs,
    jdTarget,
    summaryTarget,
    expected: {
      companyName,
      jobTitles: jobs.map((job) => job.title),
      totalJdJobs: mode === "resume-new-company"
        ? existingJdJobs.length
        : existingJdJobs.length + jobs.length,
      totalSummaryJobs: mode === "resume-new-company"
        ? jobs.length
        : existingPortfolioJobs.length + jobs.length
    },
    errors
  };
}

export function normalizeForMatch(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(DASHES, "-")
    .replace(/｜/g, "|")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*([|-])\s*/g, "$1")
    .toLocaleLowerCase("en-US");
}

function validateInputs(snapshot, draft) {
  const errors = [...validateCompanyDraft(draft)];
  if (!Number.isInteger(snapshot.revisionId) || snapshot.revisionId < 0) {
    errors.push("无法读取有效的飞书文档版本号。");
  }
  if (!snapshot.rootId || snapshot.jd?.parentBlockId !== snapshot.rootId) {
    errors.push("岗位 JD 公司必须是文档根级一级标题。");
  }
  if (!Number.isInteger(snapshot.portfolio?.headingIndex)
    || !Number.isInteger(snapshot.jd?.headingIndex)
    || snapshot.portfolio.headingIndex >= snapshot.jd.headingIndex) {
    errors.push("Portfolio 区必须位于岗位 JD 区之前。");
  }
  return errors;
}

function matchingCompanies(companies = [], companyName) {
  const expected = normalizeForMatch(companyName);
  if (!expected) return [];
  return companies.filter((company) => normalizeForMatch(company.name) === expected);
}

function detectStoredDuplicates(jobs, sectionName, errors) {
  const seen = new Set();
  for (const job of jobs) {
    const normalized = normalizeForMatch(job.title);
    if (!normalized) continue;
    if (seen.has(normalized)) {
      errors.push(`${sectionName} 区已存在重复岗位“${job.title}”，已停止写入。`);
    }
    seen.add(normalized);
  }
}

function maximumOrdinal(jobs) {
  return jobs.reduce((maximum, job) => {
    const ordinal = Number(job.ordinal);
    return Number.isInteger(ordinal) && ordinal > maximum ? ordinal : maximum;
  }, 0);
}

function nextSummaryIndex(company) {
  if (!company) return undefined;
  return Math.max(company.index, ...(company.jobs ?? []).map((job) => job.index)) + 1;
}

function validateTarget(target, label, errors) {
  if (!target.parentBlockId || !Number.isInteger(target.index) || target.index < 0) {
    errors.push(`无法确定${label}区的唯一写入位置。`);
  }
}
