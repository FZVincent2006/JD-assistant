import { BLOCK, fieldForBlockType, textOfBlock } from "./feishuBlockModel.js";

const PORTFOLIO_HEADING = "Portfolio开放岗位汇总";
const JD_HEADING = "岗位JD整理";

export function inspectRecruitingDocument(model) {
  const portfolioHeading = uniqueHeading(model, PORTFOLIO_HEADING);
  const jdHeading = uniqueHeading(model, JD_HEADING);
  if (portfolioHeading.parent_id !== model.rootId || jdHeading.parent_id !== model.rootId) {
    throw new Error("Target headings must be root-level siblings");
  }

  const rootChildren = model.childrenByParent.get(model.rootId) ?? [];
  const portfolioHeadingIndex = rootChildren.indexOf(portfolioHeading.block_id);
  const jdHeadingIndex = rootChildren.indexOf(jdHeading.block_id);
  if (portfolioHeadingIndex < 0 || jdHeadingIndex <= portfolioHeadingIndex) {
    throw new Error("Portfolio section must precede the JD section");
  }

  const portfolio = inspectPortfolio(model, rootChildren, portfolioHeadingIndex, jdHeadingIndex);
  const jd = inspectJd(model, rootChildren, jdHeadingIndex);
  const firstPortfolio = portfolio.companies[0];
  const firstJd = jd.companies[0];
  return {
    revisionId: model.revisionId,
    rootId: model.rootId,
    portfolio,
    jd,
    templates: {
      portfolio: {
        company: styleTemplate(model.blocks.get(firstPortfolio.headingBlockId)),
        bullet: styleTemplate(model.blocks.get(firstPortfolio.jobs[0].blockId)),
        callout: styleTemplate(model.blocks.get(portfolio.calloutBlockId))
      },
      jd: jd.templates
    },
    companies: {
      portfolio: portfolio.companies.map((company) => company.name),
      jd: jd.companies.map((company) => company.name)
    }
  };
}

function inspectPortfolio(model, rootChildren, headingIndex, jdHeadingIndex) {
  const sectionIds = rootChildren.slice(headingIndex + 1, jdHeadingIndex);
  const callouts = sectionIds
    .map((id) => model.blocks.get(id))
    .filter((block) => block?.block_type === BLOCK.CALLOUT);
  if (callouts.length !== 1) throw new Error("Portfolio section must contain exactly one Callout");
  const callout = callouts[0];
  const childIds = model.childrenByParent.get(callout.block_id) ?? [];
  const companies = [];

  for (let index = 0; index < childIds.length;) {
    const companyBlock = model.blocks.get(childIds[index]);
    if (!companyBlock || companyBlock.block_type === BLOCK.BULLET || !textOfBlock(companyBlock)) {
      throw new Error("Portfolio company template is incomplete");
    }
    const jobs = [];
    let cursor = index + 1;
    while (cursor < childIds.length) {
      const jobBlock = model.blocks.get(childIds[cursor]);
      if (jobBlock?.block_type !== BLOCK.BULLET) break;
      jobs.push({
        title: jobTitleFromSummary(textOfBlock(jobBlock)),
        text: textOfBlock(jobBlock),
        blockId: jobBlock.block_id,
        index: cursor
      });
      cursor += 1;
    }
    if (!jobs.length || jobs.some((job) => !job.title)) {
      throw new Error("Portfolio company template is incomplete");
    }
    companies.push({
      name: textOfBlock(companyBlock),
      headingBlockId: companyBlock.block_id,
      parentBlockId: callout.block_id,
      index,
      jobs
    });
    index = cursor;
  }
  if (!companies.length) throw new Error("No complete Portfolio company template was found");
  return {
    headingBlockId: rootChildren[headingIndex],
    headingIndex,
    calloutBlockId: callout.block_id,
    parentBlockId: callout.block_id,
    firstCompanyIndex: companies[0].index,
    companies
  };
}

function inspectJd(model, rootChildren, headingIndex) {
  const companyStarts = [];
  for (let index = headingIndex + 1; index < rootChildren.length; index += 1) {
    if (model.blocks.get(rootChildren[index])?.block_type === BLOCK.HEADING1) companyStarts.push(index);
  }
  if (!companyStarts.length) throw new Error("No complete JD company template was found");

  const companies = companyStarts.map((start, companyIndex) => {
    const end = companyStarts[companyIndex + 1] ?? rootChildren.length;
    return inspectJdCompany(model, rootChildren, start, end);
  });
  const first = companies[0];
  const introCallout = model.blocks.get(first.introCalloutBlockId);
  const introBulletId = (model.childrenByParent.get(introCallout.block_id) ?? [])[0];
  const firstQuote = model.blocks.get(first.jobs[0].quoteBlockId);
  const quoteChildIds = model.childrenByParent.get(firstQuote.block_id) ?? [];
  const quoteText = quoteChildIds.map((id) => model.blocks.get(id)).find((block) => block?.block_type === BLOCK.TEXT);
  const quoteBullet = quoteChildIds.map((id) => model.blocks.get(id)).find((block) => block?.block_type === BLOCK.BULLET);
  return {
    headingBlockId: rootChildren[headingIndex],
    headingIndex,
    parentBlockId: model.rootId,
    firstCompanyIndex: first.index,
    companies,
    templates: {
      companyHeading: styleTemplate(model.blocks.get(first.headingBlockId)),
      subheading: styleTemplate(model.blocks.get(first.introHeadingBlockId)),
      callout: styleTemplate(introCallout),
      introBullet: styleTemplate(model.blocks.get(introBulletId)),
      jobTitle: styleTemplate(model.blocks.get(first.jobs[0].blockId)),
      quote: styleTemplate(firstQuote),
      quoteText: styleTemplate(quoteText),
      quoteBullet: styleTemplate(quoteBullet)
    }
  };
}

function inspectJdCompany(model, rootChildren, start, end) {
  const ids = rootChildren.slice(start, end);
  const blocks = ids.map((id) => model.blocks.get(id));
  const companyHeading = blocks[0];
  const introIndex = blocks.findIndex((block) => isExactHeading(block, BLOCK.HEADING2, "公司介绍"));
  const openIndex = blocks.findIndex((block) => isExactHeading(block, BLOCK.HEADING2, "开放岗位"));
  const introCalloutIndex = blocks.findIndex((block, index) =>
    index > introIndex && index < openIndex && block?.block_type === BLOCK.CALLOUT
  );
  if (introIndex !== 1 || introCalloutIndex < 0 || openIndex <= introCalloutIndex) {
    throw new Error("No complete JD company template was found");
  }
  const introCallout = blocks[introCalloutIndex];
  const introChildren = model.childrenByParent.get(introCallout.block_id) ?? [];
  if (!introChildren.some((id) => model.blocks.get(id)?.block_type === BLOCK.BULLET)) {
    throw new Error("No complete JD company template was found");
  }

  const jobs = [];
  for (let index = openIndex + 1; index < blocks.length; index += 1) {
    const parsed = parseJobHeading(blocks[index]);
    if (!parsed) continue;
    const quote = blocks[index + 1];
    if (!validQuote(model, quote)) throw new Error("No complete JD company template was found");
    jobs.push({
      ...parsed,
      text: textOfBlock(blocks[index]),
      blockId: blocks[index].block_id,
      quoteBlockId: quote.block_id,
      index: start + index
    });
    index += 1;
  }
  if (!jobs.length) throw new Error("No complete JD company template was found");
  return {
    name: textOfBlock(companyHeading),
    headingBlockId: companyHeading.block_id,
    parentBlockId: model.rootId,
    index: start,
    endIndex: end,
    introHeadingBlockId: blocks[introIndex].block_id,
    introCalloutBlockId: introCallout.block_id,
    openHeadingBlockId: blocks[openIndex].block_id,
    jobs
  };
}

function validQuote(model, block) {
  if (block?.block_type !== BLOCK.QUOTE_CONTAINER) return false;
  const children = (model.childrenByParent.get(block.block_id) ?? []).map((id) => model.blocks.get(id));
  const labels = children.filter((child) => child?.block_type === BLOCK.TEXT).map(textOfBlock);
  const bullets = children.filter((child) => child?.block_type === BLOCK.BULLET);
  return labels.some((text) => text === "工作内容：")
    && labels.some((text) => text === "职位要求：")
    && bullets.length >= 2;
}

function parseJobHeading(block) {
  if (!block || ![BLOCK.HEADING3, BLOCK.TEXT].includes(block.block_type)) return null;
  const match = textOfBlock(block).match(/^[（(](\d+)[）)]\s*([^｜|]+)\s*[｜|]/);
  if (!match) return null;
  return { ordinal: Number(match[1]), title: match[2].trim() };
}

function jobTitleFromSummary(value) {
  return String(value).split(/[｜|]/)[0].trim();
}

function uniqueHeading(model, needle) {
  const matches = model.preorder
    .map((id) => model.blocks.get(id))
    .filter((block) => block?.block_type === BLOCK.HEADING1 && textOfBlock(block).includes(needle));
  if (matches.length !== 1) throw new Error(`“${needle}” must appear exactly once`);
  return matches[0];
}

function isExactHeading(block, blockType, text) {
  return block?.block_type === blockType && textOfBlock(block) === text;
}

function styleTemplate(block) {
  if (!block) throw new Error("A required Feishu style template is missing");
  const field = fieldForBlockType(block.block_type);
  if (!field) throw new Error("Unsupported Feishu template block type");
  if ([BLOCK.CALLOUT, BLOCK.QUOTE_CONTAINER].includes(block.block_type)) {
    return { block_type: block.block_type, [field]: structuredClone(block[field] ?? {}) };
  }
  const firstTextRun = (block[field]?.elements ?? []).find((element) => element?.text_run)?.text_run;
  const textElementStyle = structuredClone(firstTextRun?.text_element_style ?? {});
  delete textElementStyle.link;
  return {
    block_type: block.block_type,
    [field]: {
      style: structuredClone(block[field]?.style ?? {}),
      elements: [{
        text_run: Object.keys(textElementStyle).length ? { text_element_style: textElementStyle } : {}
      }]
    }
  };
}
