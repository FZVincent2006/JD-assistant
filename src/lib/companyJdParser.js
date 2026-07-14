const SECTION_HEADINGS = new Map([
  ["公司介绍", "companyIntro"],
  ["关于我们", "companyIntro"],
  ["我们是谁", "companyIntro"],
  ["工作内容", "responsibilities"],
  ["职位描述", "responsibilities"],
  ["岗位职责", "responsibilities"],
  ["核心职责", "responsibilities"],
  ["你会做什么", "responsibilities"],
  ["职位要求", "requirements"],
  ["岗位要求", "requirements"],
  ["任职要求", "requirements"],
  ["我们希望你", "requirements"],
  ["加分项", "bonuses"],
  ["优先项", "bonuses"]
]);

export function parseCompanyJdBatch(input = "") {
  const lines = normalizeLines(input);
  const companyName = extractCompanyName(lines);
  const website = extractWebsite(lines);
  const jobs = [];
  const companyIntro = [];
  let currentJob = null;
  let currentSection = "companyIntro";

  for (const line of lines) {
    if (isCompanyLine(line) || isWebsiteLine(line)) continue;

    const jobTitle = parseJobTitle(line);
    if (jobTitle) {
      currentJob = { ...jobTitle, responsibilities: [], requirements: [], bonuses: [] };
      jobs.push(currentJob);
      currentSection = "responsibilities";
      continue;
    }

    const heading = sectionForHeading(line);
    if (heading) {
      currentSection = heading;
      continue;
    }

    const value = stripBullet(line);
    if (!value) continue;
    if (currentSection === "companyIntro" || !currentJob) {
      companyIntro.push(value);
    } else {
      currentJob[currentSection].push(value);
    }
  }

  const draft = {
    companyName,
    website,
    companyIntro,
    jobs,
    warnings: optionalWarnings(website, companyIntro),
    errors: []
  };
  draft.errors = validateCompanyDraft(draft);
  return draft;
}

export function validateCompanyDraft(draft = {}) {
  const errors = [];
  if (!draft.companyName?.trim()) errors.push("未识别公司名。");
  if (!draft.jobs?.length) {
    errors.push("至少需要一个岗位。");
    return errors;
  }

  for (const job of draft.jobs) {
    const label = job.title?.trim() || "未命名岗位";
    if (!job.title?.trim()) errors.push("存在未识别岗位名的岗位。");
    if (!job.location?.trim()) errors.push(`岗位“${label}”缺少地点。`);
    if (!job.employment?.trim()) errors.push(`岗位“${label}”缺少招聘类型。`);
    if (!job.responsibilities?.length) errors.push(`岗位“${label}”缺少工作内容。`);
    if (!job.requirements?.length) errors.push(`岗位“${label}”缺少职位要求。`);
  }

  return errors;
}

function normalizeLines(input) {
  return String(input)
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/^>\s?/, "").trim())
    .filter(Boolean);
}

function extractCompanyName(lines) {
  const explicit = lines.find(isCompanyLine);
  if (explicit) return explicit.replace(/^(公司|公司名|公司名称)\s*[:：]\s*/, "").trim();

  for (const line of lines) {
    const match = line.match(/^([A-Za-z0-9\u4e00-\u9fa5][A-Za-z0-9\u4e00-\u9fa5 ._-]{1,60}?)\s*(?:是|为)(?:一家|一个|真格基金)/);
    if (match) return match[1].trim();
  }
  return "";
}

function extractWebsite(lines) {
  const websiteLine = lines.find(isWebsiteLine);
  if (!websiteLine) return "";
  return websiteLine.match(/https?:\/\/[^\s，。]+/i)?.[0] ?? "";
}

function isCompanyLine(line) {
  return /^(公司|公司名|公司名称)\s*[:：]/.test(line);
}

function isWebsiteLine(line) {
  return /^(公司官网|官网|Website)\s*[:：]/i.test(line);
}

function parseJobTitle(line) {
  const clean = line.replace(/^#{1,6}\s*/, "").replace(/\*\*/g, "").replace(/^（?\d+[）.)、]?\s*/, "").trim();
  const parts = clean.split(/[｜|]/).map((part) => part.trim());
  if (parts.length < 3) return null;
  return {
    title: parts[0],
    location: parts[1],
    employment: parts.slice(2).filter(Boolean).join("/")
  };
}

function sectionForHeading(line) {
  const normalized = line.replace(/[：:\s【】]/g, "");
  for (const [heading, section] of SECTION_HEADINGS) {
    if (normalized === heading) return section;
  }
  return "";
}

function stripBullet(line) {
  return line
    .replace(/^[•·●▪◦]\s*/, "")
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+[.、)]\s*/, "")
    .trim();
}

function optionalWarnings(website, companyIntro) {
  const warnings = [];
  if (!website) warnings.push("未识别公司官网，将以纯文本写入公司名。");
  if (!companyIntro.length) warnings.push("未识别公司介绍，确认写入时将使用“待补充”。");
  return warnings;
}
