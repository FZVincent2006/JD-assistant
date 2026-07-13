import { BLOCK, fieldForBlockType } from "./feishuBlockModel.js";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function renderJdDescendants(draft, plan, templates) {
  requirePlan(plan);
  requireTemplate(templates?.companyHeading, BLOCK.HEADING1, "company Heading 1");
  requireTemplate(templates?.subheading, BLOCK.HEADING2, "gray Heading 2");
  requireTemplate(templates?.callout, BLOCK.CALLOUT, "introduction Callout");
  requireTemplate(templates?.introBullet, BLOCK.BULLET, "introduction Bullet");
  requireTemplate(templates?.quote, BLOCK.QUOTE_CONTAINER, "job QuoteContainer");
  requireTemplate(templates?.quoteText, BLOCK.TEXT, "quote label Text");
  requireTemplate(templates?.quoteBullet, BLOCK.BULLET, "quote Bullet");
  if (![BLOCK.HEADING3, BLOCK.TEXT].includes(templates?.jobTitle?.block_type)) {
    throw new Error("A valid job-title template is required");
  }

  const childrenId = [];
  const descendants = [];
  if (plan.mode === "new-company") {
    addRoot(childrenId, descendants, textBlock(
      "jd-company-heading",
      templates.companyHeading,
      draft.companyName,
      draft.website
    ));
    addRoot(childrenId, descendants, textBlock("jd-intro-heading", templates.subheading, "公司介绍"));

    const introIds = (draft.companyIntro?.length ? draft.companyIntro : ["待补充"])
      .map((content, index) => `jd-intro-${index + 1}`);
    addRoot(childrenId, descendants, containerBlock("jd-intro-callout", templates.callout, introIds));
    introIds.forEach((id, index) => {
      descendants.push(textBlock(
        id,
        templates.introBullet,
        draft.companyIntro?.length ? draft.companyIntro[index] : "待补充"
      ));
    });
    addRoot(childrenId, descendants, textBlock("jd-open-heading", templates.subheading, "开放岗位"));
  }

  for (const [index, job] of plan.jobs.entries()) {
    const jobNumber = index + 1;
    const titleId = `jd-job-${jobNumber}-title`;
    const quoteId = `jd-job-${jobNumber}-quote`;
    addRoot(childrenId, descendants, textBlock(
      titleId,
      templates.jobTitle,
      `（${job.ordinal}）${job.title}｜${job.location}｜${job.employment}`
    ));
    const quoteChildren = renderQuoteChildren(job, jobNumber, templates);
    addRoot(childrenId, descendants, containerBlock(
      quoteId,
      templates.quote,
      quoteChildren.map((block) => block.block_id)
    ));
    descendants.push(...quoteChildren);
  }

  const request = { children_id: childrenId, descendants };
  validateDescendantGraph(request);
  return request;
}

export function renderSummaryDescendants(draft, plan, templates) {
  requirePlan(plan);
  requireTemplate(templates?.company, BLOCK.HEADING3, "Portfolio company Heading 3");
  requireTemplate(templates?.bullet, BLOCK.BULLET, "Portfolio job Bullet");
  const childrenId = [];
  const descendants = [];

  if (plan.mode === "new-company") {
    addRoot(childrenId, descendants, textBlock(
      "summary-company",
      templates.company,
      draft.companyName,
      draft.website
    ));
  }
  plan.jobs.forEach((job, index) => {
    addRoot(childrenId, descendants, textBlock(
      `summary-job-${index + 1}`,
      templates.bullet,
      `${job.title}｜${job.location}｜${job.employment}`
    ));
  });

  const request = { children_id: childrenId, descendants };
  validateDescendantGraph(request);
  return request;
}

export function makeTextRun(content, style = {}, link) {
  const safeContent = sanitizeText(content);
  const textElementStyle = structuredClone(style ?? {});
  delete textElementStyle.link;
  if (link) textElementStyle.link = { url: safeHttpUrl(link) };
  return { text_run: { content: safeContent, text_element_style: textElementStyle } };
}

function renderQuoteChildren(job, jobNumber, templates) {
  const blocks = [];
  addQuoteSection(blocks, jobNumber, "work", "工作内容：", job.responsibilities, templates);
  addQuoteSection(blocks, jobNumber, "requirements", "职位要求：", job.requirements, templates);
  if (job.bonuses?.length) {
    addQuoteSection(blocks, jobNumber, "bonuses", "加分项：", job.bonuses, templates);
  }
  return blocks;
}

function addQuoteSection(blocks, jobNumber, key, label, values, templates) {
  blocks.push(textBlock(`jd-job-${jobNumber}-${key}-label`, templates.quoteText, label));
  for (const [index, value] of (values ?? []).entries()) {
    blocks.push(textBlock(`jd-job-${jobNumber}-${key}-${index + 1}`, templates.quoteBullet, value));
  }
}

function addRoot(childrenId, descendants, block) {
  childrenId.push(block.block_id);
  descendants.push(block);
}

function textBlock(id, template, content, link) {
  const field = fieldForBlockType(template.block_type);
  const property = template[field] ?? {};
  const elementStyle = property.elements?.find((element) => element?.text_run)?.text_run?.text_element_style ?? {};
  return {
    block_id: id,
    block_type: template.block_type,
    [field]: {
      style: structuredClone(property.style ?? {}),
      elements: [makeTextRun(content, elementStyle, link)]
    },
    children: []
  };
}

function containerBlock(id, template, children) {
  const field = fieldForBlockType(template.block_type);
  return {
    block_id: id,
    block_type: template.block_type,
    [field]: structuredClone(template[field] ?? {}),
    children: [...children]
  };
}

function sanitizeText(value) {
  const text = String(value ?? "").normalize("NFC");
  if (CONTROL_CHARACTERS.test(text)) throw new Error("Feishu text cannot contain control characters");
  return text;
}

function safeHttpUrl(value) {
  const raw = String(value).trim();
  if (CONTROL_CHARACTERS.test(raw)) throw new Error("Feishu links cannot contain control characters");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Feishu company link must use http or https");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Feishu company link must use http or https");
  }
  return raw;
}

function requirePlan(plan) {
  if (!plan?.ok) throw new Error("Cannot render an invalid Feishu write plan");
  if (!["new-company", "append-jobs"].includes(plan.mode)) {
    throw new Error("Unknown Feishu write-plan mode");
  }
  if (!Array.isArray(plan.jobs) || !plan.jobs.length) {
    throw new Error("A Feishu write plan must contain at least one job");
  }
}

function requireTemplate(template, blockType, label) {
  if (template?.block_type !== blockType || !fieldForBlockType(blockType)) {
    throw new Error(`A valid ${label} template is required`);
  }
}

function validateDescendantGraph(request) {
  const blocks = new Map();
  for (const block of request.descendants) {
    if (!block.block_id || blocks.has(block.block_id)) {
      throw new Error("Feishu descendant IDs must be present and unique");
    }
    blocks.set(block.block_id, block);
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(blockId) {
    if (!blocks.has(blockId)) throw new Error(`Feishu descendant graph is missing ${blockId}`);
    if (visiting.has(blockId)) throw new Error("Feishu descendant graph contains a cycle");
    if (visited.has(blockId)) throw new Error("A Feishu descendant has more than one parent");
    visiting.add(blockId);
    for (const childId of blocks.get(blockId).children ?? []) visit(childId);
    visiting.delete(blockId);
    visited.add(blockId);
  }
  for (const rootId of request.children_id) visit(rootId);
  if (visited.size !== blocks.size) throw new Error("Feishu descendant graph contains orphan blocks");
}
