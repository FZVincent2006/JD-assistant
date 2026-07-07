const SECTION_RULES = [
  { key: "responsibilities", label: "【岗位职责】", patterns: ["工作内容", "职位描述", "岗位职责", "核心职责"] },
  { key: "requirements", label: "【任职要求】", patterns: ["岗位要求", "任职要求", "职位要求"] },
  { key: "bonuses", label: "【加分项】", patterns: ["加分项", "优先项"] },
  { key: "benefits", label: "【岗位福利】", patterns: ["岗位福利", "福利待遇"] }
];

const KEYWORD_RULES = [
  ["agent", "Agent"],
  ["runtime", "Runtime"],
  ["typescript", "TypeScript"],
  ["node.js", "Node.js"],
  ["nodejs", "Node.js"],
  ["react", "React"],
  ["python", "Python"],
  ["sql", "SQL"],
  ["llm", "LLM"],
  ["ai", "AI"]
];

export function parseJd(input = "") {
  const lines = normalizeLines(input);
  const titleIndex = findTitleLineIndex(lines);
  const explicitCompanyName = extractCompanyName(lines, titleIndex);
  const titleLine = titleIndex >= 0 ? lines[titleIndex] : "";
  const titleParts = splitTitle(titleLine, explicitCompanyName);
  const bodyLines = lines
    .map((line, index) => ({ line, beforeTitle: titleIndex >= 0 && index < titleIndex }))
    .filter((entry, index) => index !== titleIndex && !isCompanyLine(entry.line));
  const sections = parseSections(bodyLines);
  const cities = extractCities(titleParts.location);
  const description = buildDescription(titleParts, cities, sections);
  const sourceText = `${input}\n${description}`;

  return {
    companyName: titleParts.companyName,
    title: formatPortfolioTitle(titleParts),
    cities,
    recruitmentType: inferRecruitmentType(titleParts.employment),
    jobType: "",
    experience: inferExperience(sourceText),
    education: inferEducation(sourceText),
    ...inferSalary(sourceText),
    industry: "",
    keywords: inferKeywords(sourceText),
    highlights: "",
    location: cities[0] ?? "",
    email: "",
    description,
    sections
  };
}

function normalizeLines(input) {
  return normalizeCompatibilityCjk(input)
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/^>\s?/, "").trim())
    .filter((line) => line !== "");
}

function normalizeCompatibilityCjk(input) {
  return Array.from(input, (char) => {
    if (/[\u2e80-\u2fdf\uf900-\ufaff]/u.test(char)) return char.normalize("NFKC");
    return char;
  }).join("");
}

function splitTitle(line, fallbackCompanyName = "") {
  const clean = line
    .replace(/^#{1,6}\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/^（?\d+[）.)]\s*/, "")
    .trim();
  const parts = clean.split(/[｜|]/).map((part) => part.trim()).filter(Boolean);

  const rawTitle = stripOrdinal(parts[0] ?? clean);
  const prefixed = rawTitle.match(/^【真格被投-([^】]+)】(.+)$/);

  return {
    companyName: prefixed ? prefixed[1].trim() : fallbackCompanyName,
    title: prefixed ? prefixed[2].trim() : rawTitle,
    location: parts[1] ?? "",
    employment: parts.slice(2).join(" / ")
  };
}

function extractCompanyName(lines, titleIndex = -1) {
  const companyLine = lines.find(isCompanyLine);
  if (companyLine) return companyLine.replace(/^(公司|公司名|公司名称|企业|企业名称)\s*[:：]\s*/, "").trim();

  const introLines = titleIndex >= 0 ? lines.slice(0, titleIndex) : lines;
  return extractCompanyNameFromIntro(introLines);
}

function isCompanyLine(line) {
  return /^(公司|公司名|公司名称|企业|企业名称)\s*[:：]/.test(line);
}

function extractCompanyNameFromIntro(lines) {
  for (const line of lines) {
    const match = line.match(/^([A-Za-z0-9\u4e00-\u9fa5][A-Za-z0-9\u4e00-\u9fa5 ._-]{1,60}?)\s*(?:是|为)(?:真格基金|一家|一个|由)/);
    if (match) return match[1].trim();
  }

  return "";
}

function findTitleLineIndex(lines) {
  const explicitTitleIndex = lines.findIndex((line) => isTitleLine(line));
  if (explicitTitleIndex >= 0) return explicitTitleIndex;

  return lines.findIndex((line) => line.trim() && !isCompanyLine(line) && !matchCompanyIntroLine(line));
}

function isTitleLine(line) {
  if (isCompanyLine(line) || matchCompanyIntroLine(line)) return false;
  const parts = line.split(/[｜|]/).map((part) => part.trim()).filter(Boolean);
  return parts.length >= 2;
}

function formatPortfolioTitle(titleParts) {
  if (!titleParts.companyName) return titleParts.title;
  return `【真格被投-${titleParts.companyName}】${titleParts.title}`;
}

function stripOrdinal(value) {
  return value.replace(/^（?\d+[）.)]\s*/, "").trim();
}

function extractCities(value) {
  return value
    .replace(/remote/gi, "")
    .split(/[/&、,，]/)
    .map((city) => city.trim())
    .filter(Boolean);
}

function inferRecruitmentType(value) {
  const normalized = value.toLowerCase();
  if (/(实习|intern)/i.test(value)) return "实习生招聘";
  if (/(校招|应届)/.test(value)) return "应届校园招聘";
  if (/(兼职|part)/i.test(value)) return "兼职招聘";
  if (/(社招|full\s*time|全职)/i.test(normalized)) return "社招全职";
  return "社招全职";
}

function parseSections(lines) {
  const sections = {
    companyIntro: [],
    responsibilities: [],
    requirements: [],
    bonuses: [],
    benefits: []
  };
  let current = "responsibilities";

  for (const entry of lines) {
    const line = typeof entry === "string" ? entry : entry.line;
    if (entry.beforeTitle && !matchSectionHeading(line)) {
      current = "companyIntro";
    }

    const companyIntro = matchCompanyIntroLine(line);
    if (companyIntro) {
      current = "companyIntro";
      if (companyIntro.value) sections.companyIntro.push(companyIntro.value);
      continue;
    }

    const heading = matchSectionHeading(line);
    if (heading) {
      current = heading;
      continue;
    }

    sections[current].push(line);
  }

  return trimSections(sections);
}

function matchSectionHeading(line) {
  const normalized = line.replace(/[:：\s]/g, "");

  for (const section of SECTION_RULES) {
    if (section.patterns.some((pattern) => normalized.includes(pattern))) {
      return section.key;
    }
  }

  return "";
}

function matchCompanyIntroLine(line) {
  const normalized = line.replace(/\s/g, "");
  const introMatch = line.match(/^(公司介绍|关于我们|我们是谁|团队介绍)\s*[:：]?\s*(.*)$/);
  if (introMatch) {
    return { value: introMatch[2].trim() };
  }

  if (/^(团队里的人|公司官网)\s*[:：]?/.test(normalized)) {
    return { value: line };
  }

  return null;
}

function trimSections(sections) {
  return Object.fromEntries(
    Object.entries(sections).map(([key, values]) => [key, values.filter(Boolean)])
  );
}

function buildDescription(titleParts, cities, sections) {
  const body = SECTION_RULES
    .map((section) => {
      const values = sections[section.key];
      if (!values.length) return "";
      return [section.label, ...values].join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
  const base = cities.length ? cities.join("、") : "base待定";
  const header = `${titleParts.title}｜${base}｜薪资open talk`;
  const companyIntro = sections.companyIntro?.length ? ["公司介绍：", ...sections.companyIntro].join("\n") : "";
  const parts = [header, companyIntro, body].filter(Boolean);

  return parts.join("\n\n");
}

function inferExperience(text) {
  const rangeMatch = text.match(/(\d+\s*[-~到至]\s*\d+)\s*年/);
  if (rangeMatch) return `${rangeMatch[1].replace(/\s/g, "").replace(/[到至~]/g, "-")}年`;

  const lowerBoundMatch = text.match(/(\d+)\s*年\s*(?:以上|及以上|\+)/);
  if (!lowerBoundMatch) return "";
  return mapLowerBoundExperience(Number(lowerBoundMatch[1]));
}

function mapLowerBoundExperience(years) {
  if (years < 1) return "1年以内";
  if (years < 3) return "1-3年";
  if (years < 5) return "3-5年";
  if (years < 10) return "5-10年";
  return "10年以上";
}

function inferEducation(text) {
  if (/博士/.test(text)) return "博士";
  if (/硕士|研究生/.test(text)) return "硕士及以上";
  if (/本科/.test(text)) return "本科及以上";
  if (/大专|专科/.test(text)) return "专科及以上";
  return "本科及以上";
}

function inferSalary(text) {
  const match = text.match(/(\d+(?:\.\d+)?)\s*[-~到至–—]\s*(\d+(?:\.\d+)?)\s*[kK千]/);

  return {
    salaryMinK: match ? normalizeNumber(match[1]) : "",
    salaryMaxK: match ? normalizeNumber(match[2]) : ""
  };
}

function normalizeNumber(value) {
  return String(Number(value));
}

function inferKeywords(text) {
  const lower = text.toLowerCase();
  const keywords = [];

  for (const [needle, label] of KEYWORD_RULES) {
    if (lower.includes(needle) && !keywords.includes(label)) {
      keywords.push(label);
    }
  }

  return keywords.slice(0, 8);
}
