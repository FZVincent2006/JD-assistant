import { isTestFeishuDocument, TEST_FEISHU_DOC_URL } from "../lib/feishuConfig.js";

export { TEST_FEISHU_DOC_URL };

export function isAllowedFeishuDocument(url = "") {
  return isTestFeishuDocument(url);
}

export function inspectFeishuDocument(root = document) {
  const blocks = allBlocks(root);
  const portfolioHeadings = blocks.filter((block) => isHeading(block, "heading1", "Portfolio开放岗位汇总"));
  const jdHeadings = blocks.filter((block) => isHeading(block, "heading1", "岗位JD整理"));

  return {
    editable: hasEditAccess(root),
    portfolioHeadingCount: portfolioHeadings.length,
    jdHeadingCount: jdHeadings.length,
    portfolioCompanies: portfolioHeadings.length === 1 ? readPortfolioCompanies(blocks, portfolioHeadings[0]) : [],
    jdCompanies: jdHeadings.length === 1 ? readJdCompanies(blocks, jdHeadings[0]) : []
  };
}

export function findFeishuInsertionTarget(root, plan, area) {
  if (area === "summary") return findSummaryTarget(root, plan);
  if (area === "jd") return findJdTarget(root, plan);
  return null;
}

function readPortfolioCompanies(blocks, heading) {
  const headingIndex = blocks.indexOf(heading);
  const callout = blocks.slice(headingIndex + 1).find((block) => block.classList.contains("docx-callout-block"));
  if (!callout) return [];

  const units = Array.from(callout.querySelectorAll("[data-block-id].callout-render-unit"));
  const companies = [];
  let current = null;
  for (const block of units) {
    if (isCompanyHeading(block)) {
      current = { name: editableText(block), jobs: [] };
      companies.push(current);
    } else if (current && block.classList.contains("docx-bullet-block")) {
      current.jobs.push(jobName(editableText(block)));
    }
  }
  return companies;
}

function readJdCompanies(blocks, heading) {
  const companies = [];
  let current = null;
  for (const block of blocks.slice(blocks.indexOf(heading) + 1)) {
    if (isOrderedCompanyHeading(block)) {
      current = { name: editableText(block), jobs: [] };
      companies.push(current);
    } else if (current && block.classList.contains("docx-heading3-block")) {
      const text = editableText(block);
      if (/^（?\d+[）.)、]?\s*/.test(text)) current.jobs.push(jobName(text));
    }
  }
  return companies;
}

function findSummaryTarget(root, plan) {
  const blocks = allBlocks(root);
  const heading = blocks.find((block) => isHeading(block, "heading1", "Portfolio开放岗位汇总"));
  const callout = heading && blocks.slice(blocks.indexOf(heading) + 1).find((block) => block.classList.contains("docx-callout-block"));
  if (!callout) return null;
  const units = Array.from(callout.querySelectorAll("[data-block-id].callout-render-unit"));
  const companies = units.filter(isCompanyHeading);
  if (!companies.length) return null;
  if (plan.mode === "new-company") return target(companies[0], "start");

  const companyIndex = companies.findIndex((block) => normalized(editableText(block)) === normalized(plan.companyName));
  if (companyIndex < 0) return null;
  if (companyIndex + 1 < companies.length) return target(companies[companyIndex + 1], "start");

  const startIndex = units.indexOf(companies[companyIndex]);
  return target(units[units.length - 1] ?? units[startIndex], "end");
}

function findJdTarget(root, plan) {
  const blocks = allBlocks(root);
  const heading = blocks.find((block) => isHeading(block, "heading1", "岗位JD整理"));
  if (!heading) return null;
  const afterHeading = blocks.slice(blocks.indexOf(heading) + 1);
  const companies = afterHeading.filter(isOrderedCompanyHeading);
  if (!companies.length) return null;
  if (plan.mode === "new-company") return target(companies[0], "start");

  const companyIndex = companies.findIndex((block) => normalized(editableText(block)) === normalized(plan.companyName));
  if (companyIndex < 0) return null;
  if (companyIndex + 1 < companies.length) return target(companies[companyIndex + 1], "start");

  const companyBlockIndex = afterHeading.indexOf(companies[companyIndex]);
  return target(afterHeading[afterHeading.length - 1] ?? afterHeading[companyBlockIndex], "end");
}

function target(block, position) {
  const element = block.querySelector('[contenteditable="true"]');
  if (!element) return null;
  return { element, blockId: block.getAttribute("data-block-id"), position };
}

function allBlocks(root) {
  return Array.from(root.querySelectorAll("[data-block-id]")).filter((block) => !block.classList.contains("docx-page-block"));
}

function hasEditAccess(root) {
  const buttons = Array.from(root.querySelectorAll("button"));
  return buttons.some((button) => normalized(button.textContent) === "编辑") || Boolean(root.querySelector('[contenteditable="true"]'));
}

function isHeading(block, level, needle) {
  return block.classList.contains(`docx-${level}-block`) && normalized(editableText(block)).includes(normalized(needle));
}

function isCompanyHeading(block) {
  return block.classList.contains("callout-render-unit") &&
    (block.classList.contains("docx-heading2-block") || block.classList.contains("docx-heading3-block"));
}

function isOrderedCompanyHeading(block) {
  return block.classList.contains("docx-heading1-block") && Boolean(block.querySelector(".heading-order"));
}

function editableText(block) {
  const editor = block.querySelector('[contenteditable="true"]');
  return cleanText(editor?.textContent ?? block.textContent ?? "");
}

function jobName(value) {
  return cleanText(value).replace(/^（?\d+[）.)、]?\s*/, "").split(/[｜|]/)[0].trim();
}

function cleanText(value) {
  return String(value).replace(/[\u200b\ufeff]/g, "").replace(/^[•·●▪◦]\s*/, "").trim();
}

function normalized(value) {
  return cleanText(value).replace(/\s+/g, " ").toLocaleLowerCase();
}
