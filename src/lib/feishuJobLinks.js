import { PRODUCTION_FEISHU_DOC_URL } from "./feishuConfig.js";
import { normalizeForMatch } from "./feishuOpenApiPlan.js";

const BLOCK_ID = /^[A-Za-z0-9_-]+$/;
const MAX_BATCH_UPDATES = 200;

export function buildJobAnchorUrl(blockId) {
  const id = String(blockId ?? "").trim();
  if (!BLOCK_ID.test(id)) throw new Error("Invalid Feishu job block ID");
  return `${PRODUCTION_FEISHU_DOC_URL}#${id}`;
}

export function resolvePlannedJobLinks(snapshot = {}, plan = {}) {
  const errors = [];
  const companyName = String(plan.companyName ?? "").trim();
  const companies = matchingCompanies(snapshot.jd?.companies, companyName);
  if (companies.length !== 1) {
    errors.push(`岗位 JD 区无法唯一匹配公司“${companyName || "未知公司"}”。`);
    return { ok: false, jobs: [], errors };
  }

  const jobs = [];
  for (const planned of plan.jobs ?? []) {
    const matches = matchingJobs(companies[0].jobs, planned);
    if (matches.length !== 1) {
      errors.push(`公司“${companyName}”的岗位“${safeJobText(planned)}”无法唯一匹配岗位 JD 标题。`);
      continue;
    }
    let linkUrl;
    try {
      linkUrl = buildJobAnchorUrl(matches[0].blockId);
    } catch {
      errors.push(`公司“${companyName}”的岗位“${safeJobText(planned)}”缺少有效岗位标题标识。`);
      continue;
    }
    jobs.push({ ...structuredClone(planned), linkUrl });
  }

  return {
    ok: errors.length === 0 && jobs.length === (plan.jobs ?? []).length,
    jobs,
    errors
  };
}

export function buildJobLinkRepairPlan(snapshot = {}) {
  const errors = [];
  const updates = [];
  let totalJobs = 0;
  let correctLinks = 0;
  const revisionId = snapshot.revisionId;
  if (!Number.isInteger(revisionId) || revisionId < 0) {
    errors.push("无法读取有效的飞书文档版本号。");
  }

  for (const portfolioCompany of snapshot.portfolio?.companies ?? []) {
    const companyName = String(portfolioCompany.name ?? "").trim();
    const jdCompanies = matchingCompanies(snapshot.jd?.companies, companyName);
    if (jdCompanies.length !== 1) {
      errors.push(`Portfolio 公司“${companyName || "未知公司"}”无法唯一匹配岗位 JD 公司。`);
      totalJobs += portfolioCompany.jobs?.length ?? 0;
      continue;
    }

    const seenPortfolioJobs = new Set();
    for (const portfolioJob of portfolioCompany.jobs ?? []) {
      totalJobs += 1;
      const key = jobKey(portfolioJob);
      if (!key || seenPortfolioJobs.has(key)) {
        errors.push(`公司“${companyName}”的 Portfolio 岗位“${safeJobText(portfolioJob)}”不唯一或字段不完整。`);
        continue;
      }
      seenPortfolioJobs.add(key);

      const jdJobs = matchingJobs(jdCompanies[0].jobs, portfolioJob);
      if (jdJobs.length !== 1) {
        errors.push(`公司“${companyName}”的岗位“${safeJobText(portfolioJob)}”无法唯一匹配岗位 JD 标题。`);
        continue;
      }

      let linkUrl;
      let elements;
      try {
        linkUrl = buildJobAnchorUrl(jdJobs[0].blockId);
        elements = linkTextElements(portfolioJob.elements, linkUrl);
      } catch (error) {
        const reason = error?.message === "Portfolio job contains unsupported rich text"
          ? "包含无法安全保留的富文本"
          : "缺少有效岗位标题标识";
        errors.push(`公司“${companyName}”的岗位“${safeJobText(portfolioJob)}”${reason}。`);
        continue;
      }

      if (portfolioJob.linkUrl === linkUrl) {
        correctLinks += 1;
        continue;
      }
      updates.push({
        companyName,
        jobText: String(portfolioJob.text ?? "").trim(),
        blockId: String(portfolioJob.blockId ?? ""),
        linkUrl,
        elements
      });
    }
  }

  if (updates.length > MAX_BATCH_UPDATES) {
    errors.push(`待更新岗位超过单次安全上限 ${MAX_BATCH_UPDATES} 个，文档不会被修改。`);
  }

  return {
    ok: errors.length === 0,
    baseRevisionId: revisionId,
    totalJobs,
    correctLinks,
    updates,
    errors
  };
}

function matchingCompanies(companies = [], companyName) {
  const expected = normalizeForMatch(companyName);
  if (!expected) return [];
  return companies.filter((company) => normalizeForMatch(company.name) === expected);
}

function matchingJobs(jobs = [], expected) {
  const key = jobKey(expected);
  if (!key) return [];
  return jobs.filter((job) => jobKey(job) === key);
}

function jobKey(job = {}) {
  const parts = [job.title, job.location, job.employment].map(normalizeForMatch);
  return parts.every(Boolean) ? parts.join("\u001f") : "";
}

function safeJobText(job = {}) {
  const title = String(job.title ?? "").trim() || "未知岗位";
  const location = String(job.location ?? "").trim();
  const employment = String(job.employment ?? "").trim();
  return [title, location, employment].filter(Boolean).join("｜");
}

function linkTextElements(elements, linkUrl) {
  if (!Array.isArray(elements) || !elements.length) {
    throw new Error("Portfolio job contains unsupported rich text");
  }
  return elements.map((element) => {
    if (!element?.text_run || typeof element.text_run.content !== "string") {
      throw new Error("Portfolio job contains unsupported rich text");
    }
    const textElementStyle = structuredClone(element.text_run.text_element_style ?? {});
    textElementStyle.link = { url: linkUrl };
    return {
      text_run: {
        ...structuredClone(element.text_run),
        text_element_style: textElementStyle
      }
    };
  });
}
