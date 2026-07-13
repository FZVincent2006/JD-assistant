import { findFeishuInsertionTarget } from "./feishuDocument.js";

export function mergeFeishuSlices(slices = []) {
  const portfolioHeadingIds = new Set();
  const jdHeadingIds = new Set();
  const portfolio = companyAccumulator();
  const jd = companyAccumulator();
  let editable = false;

  for (const slice of slices) {
    editable ||= Boolean(slice.editable);
    for (const id of slice.portfolioHeadingIds ?? []) portfolioHeadingIds.add(id);
    for (const id of slice.jdHeadingIds ?? []) jdHeadingIds.add(id);
    mergeTokens(portfolio, slice.portfolioTokens ?? []);
    mergeTokens(jd, slice.jdTokens ?? []);
  }

  return {
    editable,
    portfolioHeadingCount: portfolioHeadingIds.size,
    jdHeadingCount: jdHeadingIds.size,
    portfolioCompanies: portfolio.companies.map(publicCompany),
    jdCompanies: jd.companies.map(publicCompany)
  };
}

export async function scanFeishuDocument(root = document, options = {}) {
  const scroll = findScrollContainer(root);
  if (!scroll) return mergeFeishuSlices([captureFeishuSlice(root, {})]);
  const originalTop = scroll.scrollTop;
  const settleMs = options.settleMs ?? 120;
  const state = {};
  const slices = [];
  let position = 0;
  let steps = 0;
  const maxSteps = options.maxSteps ?? 160;

  while (steps < maxSteps) {
    scroll.scrollTop = position;
    scroll.dispatchEvent(new (root.defaultView?.Event ?? Event)("scroll", { bubbles: true }));
    await delay(settleMs);
    slices.push(captureFeishuSlice(root, state));
    steps += 1;
    const maxTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    if (position >= maxTop) break;
    const stepSize = Math.max(300, Math.floor(scroll.clientHeight * 0.72));
    position = Math.min(maxTop, position + stepSize);
  }

  scroll.scrollTop = originalTop;
  scroll.dispatchEvent(new (root.defaultView?.Event ?? Event)("scroll", { bubbles: true }));
  await delay(settleMs);
  return mergeFeishuSlices(slices);
}

export async function findFeishuInsertionTargetFully(root, plan, area, snapshot, options = {}) {
  const scroll = findScrollContainer(root);
  if (!scroll) return findFeishuInsertionTarget(root, plan, area);
  const settleMs = options.settleMs ?? 120;
  const companies = area === "jd" ? snapshot.jdCompanies : snapshot.portfolioCompanies;
  const companyIndex = companies.findIndex((entry) => normalized(entry.name) === normalized(plan.companyName));
  const nextCompanyName = plan.mode === "append-jobs" && companyIndex >= 0 ? companies[companyIndex + 1]?.name : "";
  const maxTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight);

  if (plan.mode === "append-jobs" && companyIndex === companies.length - 1) {
    await moveScroll(root, scroll, maxTop, settleMs);
    const lastEditableBlock = Array.from(root.querySelectorAll('[data-block-id] [contenteditable="true"]')).at(-1);
    const block = lastEditableBlock?.closest("[data-block-id]");
    return lastEditableBlock && block
      ? { element: lastEditableBlock, blockId: block.getAttribute("data-block-id"), position: "end" }
      : null;
  }

  let position = 0;
  let steps = 0;
  const maxSteps = options.maxSteps ?? 160;
  while (steps < maxSteps) {
    await moveScroll(root, scroll, position, settleMs);
    if (nextCompanyName) {
      const target = findVisibleCompany(root, area, nextCompanyName);
      if (target) return target;
    } else {
      const target = findFeishuInsertionTarget(root, plan, area);
      if (target) return target;
    }
    if (position >= maxTop) break;
    position = Math.min(maxTop, position + Math.max(300, Math.floor(scroll.clientHeight * 0.72)));
    steps += 1;
  }
  return null;
}

export function captureFeishuSlice(root = document, state = {}) {
  const blocks = Array.from(root.querySelectorAll("[data-block-id]")).filter((block) => !block.classList.contains("docx-page-block"));
  const portfolioHeadings = blocks.filter((block) => headingIncludes(block, "heading1", "Portfolio开放岗位汇总"));
  const jdHeadings = blocks.filter((block) => headingIncludes(block, "heading1", "岗位JD整理"));

  if (!state.summaryCalloutId && portfolioHeadings.length) {
    const index = blocks.indexOf(portfolioHeadings[0]);
    state.summaryCalloutId = blocks.slice(index + 1).find((block) => block.classList.contains("docx-callout-block"))?.getAttribute("data-block-id") ?? "";
  }

  const portfolioTokens = [];
  const callout = state.summaryCalloutId ? root.querySelector(`[data-block-id="${cssEscape(state.summaryCalloutId)}"]`) : null;
  for (const block of callout?.querySelectorAll("[data-block-id].callout-render-unit") ?? []) {
    if (isSummaryCompany(block)) portfolioTokens.push({ type: "company", id: blockId(block), name: editableText(block) });
    if (block.classList.contains("docx-bullet-block")) portfolioTokens.push({ type: "job", title: jobName(editableText(block)) });
  }

  const jdTokens = [];
  let jdBlocks = [];
  if (jdHeadings.length) {
    state.inJd = true;
    jdBlocks = blocks.slice(blocks.indexOf(jdHeadings[0]) + 1);
  } else if (state.inJd) {
    jdBlocks = blocks;
  }
  for (const block of jdBlocks) {
    if (isOrderedCompany(block)) jdTokens.push({ type: "company", id: blockId(block), name: editableText(block) });
    if (block.classList.contains("docx-heading3-block") && /^（?\d+[）.)、]?\s*/.test(editableText(block))) {
      jdTokens.push({ type: "job", title: jobName(editableText(block)) });
    }
  }

  return {
    editable: hasEditAccess(root),
    portfolioHeadingIds: portfolioHeadings.map(blockId),
    jdHeadingIds: jdHeadings.map(blockId),
    portfolioTokens,
    jdTokens
  };
}

function companyAccumulator() {
  return { companies: [], byKey: new Map(), current: null };
}

function mergeTokens(accumulator, tokens) {
  for (const token of tokens) {
    if (token.type === "company") {
      const key = token.id ? `id:${token.id}` : `name:${normalized(token.name)}`;
      let company = accumulator.byKey.get(key);
      if (!company) {
        company = { name: token.name, jobs: [], jobNames: new Set() };
        accumulator.byKey.set(key, company);
        accumulator.companies.push(company);
      }
      accumulator.current = company;
    } else if (token.type === "job" && accumulator.current) {
      const key = normalized(token.title);
      if (!accumulator.current.jobNames.has(key)) {
        accumulator.current.jobNames.add(key);
        accumulator.current.jobs.push(token.title);
      }
    }
  }
}

function publicCompany(company) {
  return { name: company.name, jobs: company.jobs };
}

function findVisibleCompany(root, area, name) {
  const blocks = Array.from(root.querySelectorAll("[data-block-id]"));
  const block = blocks.find((candidate) => {
    if (area === "summary" && !isSummaryCompany(candidate)) return false;
    if (area === "jd" && !isOrderedCompany(candidate)) return false;
    return normalized(editableText(candidate)) === normalized(name);
  });
  const element = block?.querySelector('[contenteditable="true"]');
  return element ? { element, blockId: block.getAttribute("data-block-id"), position: "start" } : null;
}

function findScrollContainer(root) {
  return Array.from(root.querySelectorAll("*"))
    .find((element) => String(element.className ?? "").includes("bear-web-x-container") && element.scrollHeight > element.clientHeight);
}

async function moveScroll(root, scroll, top, settleMs) {
  scroll.scrollTop = top;
  scroll.dispatchEvent(new (root.defaultView?.Event ?? Event)("scroll", { bubbles: true }));
  await delay(settleMs);
}

function headingIncludes(block, level, text) {
  return block.classList.contains(`docx-${level}-block`) && normalized(editableText(block)).includes(normalized(text));
}

function isSummaryCompany(block) {
  return block.classList.contains("callout-render-unit") &&
    (block.classList.contains("docx-heading2-block") || block.classList.contains("docx-heading3-block"));
}

function isOrderedCompany(block) {
  return block.classList.contains("docx-heading1-block") && Boolean(block.querySelector(".heading-order"));
}

function hasEditAccess(root) {
  return Array.from(root.querySelectorAll("button")).some((button) => normalized(button.textContent) === "编辑") ||
    Boolean(root.querySelector('[contenteditable="true"]'));
}

function editableText(block) {
  return cleanText(block.querySelector('[contenteditable="true"]')?.textContent ?? block.textContent ?? "");
}

function jobName(value) {
  return cleanText(value).replace(/^（?\d+[）.)、]?\s*/, "").split(/[｜|]/)[0].trim();
}

function blockId(block) {
  return block.getAttribute("data-block-id") ?? "";
}

function cleanText(value) {
  return String(value).replace(/[\u200b\ufeff]/g, "").replace(/^[•·●▪◦]\s*/, "").trim();
}

function normalized(value = "") {
  return cleanText(value).replace(/\s+/g, " ").toLocaleLowerCase();
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? globalThis.CSS.escape(value) : value.replace(/"/g, '\\"');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
