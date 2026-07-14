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
    const block = model.blocks.get(rootChildren[index]);
    if (block?.block_type === BLOCK.HEADING1 && textOfBlock(block) !== "开放岗位") {
      companyStarts.push(index);
    }
  }
  if (!companyStarts.length) throw new Error("No complete JD company template was found");

  const companies = companyStarts.map((start, companyIndex) => {
    const end = companyStarts[companyIndex + 1] ?? rootChildren.length;
    return inspectJdCompany(model, rootChildren, start, end);
  });
  const first = companies[0];
  const introHeadingCompany = companies.find((company) => company.introHeadingBlockId);
  const openHeadingCompany = companies.find((company) => company.openHeadingBlockId);
  const introTemplate = companies.map((company) => {
    const callout = model.blocks.get(company.introCalloutBlockId);
    const bulletId = (model.childrenByParent.get(callout?.block_id) ?? [])
      .find((id) => model.blocks.get(id)?.block_type === BLOCK.BULLET);
    return bulletId ? { callout, bulletId } : null;
  }).find(Boolean);
  if (!introTemplate) throw new Error("A required Feishu style template is missing");
  const quoteTemplateJob = companies.flatMap((company) => company.jobs)
    .find((job) => job.quoteBlockId);
  if (!introHeadingCompany || !openHeadingCompany || !quoteTemplateJob) {
    throw new Error("A required Feishu style template is missing");
  }
  const firstQuote = model.blocks.get(quoteTemplateJob.quoteBlockId);
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
      subheading: styleTemplate(model.blocks.get(introHeadingCompany.introHeadingBlockId)),
      openHeading: styleTemplate(model.blocks.get(openHeadingCompany.openHeadingBlockId)),
      callout: styleTemplate(introTemplate.callout),
      introBullet: styleTemplate(model.blocks.get(introTemplate.bulletId)),
      jobTitle: styleTemplate(model.blocks.get(quoteTemplateJob.blockId)),
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
  const companyName = textOfBlock(companyHeading);
  const introIndex = blocks.findIndex((block) => isExactHeading(block, BLOCK.HEADING2, "公司介绍"));
  const openHeadings = findExactHeadingsInSubtrees(
    model,
    blocks,
    [BLOCK.HEADING1, BLOCK.HEADING2],
    "开放岗位"
  );
  const openHeading = openHeadings.length === 1 ? openHeadings[0] : null;
  const openIndex = openHeading?.rootIndex ?? -1;
  const validIntroPosition = introIndex >= 1
    && blocks.slice(1, introIndex).every(isBlankTextBlock);
  const introCallouts = validIntroPosition && openIndex > introIndex
    ? findBlocksInSubtrees(
      model,
      blocks.slice(introIndex + 1, openIndex),
      BLOCK.CALLOUT
    )
    : [];
  const introCallout = introCallouts.length === 1 ? introCallouts[0] : null;
  const introTexts = introCallout
    ? findBlocksInSubtrees(model, [introCallout], BLOCK.BULLET).map(textOfBlock)
    : [];

  const jobs = [];
  for (let index = 1; index < blocks.length; index += 1) {
    const parsed = parseJobHeading(blocks[index]);
    if (!parsed) continue;
    const quoteIndex = nextNonBlankBlockIndex(blocks, index + 1);
    const quote = blocks[quoteIndex];
    const hasReusableQuote = validQuote(model, quote);
    const sections = hasReusableQuote ? quoteSections(model, quote) : emptyQuoteSections();
    jobs.push({
      ...parsed,
      ...sections,
      text: textOfBlock(blocks[index]),
      blockId: blocks[index].block_id,
      quoteBlockId: hasReusableQuote ? quote.block_id : "",
      index: start + index
    });
    if (hasReusableQuote) index = quoteIndex;
  }
  return {
    name: companyName,
    headingBlockId: companyHeading.block_id,
    blockType: companyHeading.block_type,
    headingSequence: companyHeading.heading1?.style?.sequence,
    parentBlockId: model.rootId,
    index: start,
    endIndex: end,
    introHeadingBlockId: validIntroPosition ? blocks[introIndex].block_id : "",
    introHeadingBlockType: validIntroPosition ? blocks[introIndex].block_type : undefined,
    introCalloutBlockId: introCallout?.block_id ?? "",
    introTexts,
    openHeadingBlockId: openHeading?.block.block_id ?? "",
    openHeadingBlockType: openHeading?.block.block_type,
    jobs
  };
}

function isBlankTextBlock(block) {
  return block?.block_type === BLOCK.TEXT && !textOfBlock(block);
}

function nextNonBlankBlockIndex(blocks, start) {
  let index = start;
  while (index < blocks.length && isBlankTextBlock(blocks[index])) index += 1;
  return index;
}

function jdTemplateError(reasonCode, companyName, jobTitle = "") {
  return Object.assign(new Error("No complete JD company template was found"), {
    reasonCode,
    companyName,
    ...(jobTitle ? { jobTitle } : {})
  });
}

function findBlocksInSubtrees(model, roots, blockType) {
  const matches = [];
  const visit = (block) => {
    if (!block) return;
    if (block.block_type === blockType) matches.push(block);
    for (const childId of model.childrenByParent.get(block.block_id) ?? []) {
      visit(model.blocks.get(childId));
    }
  };
  roots.forEach(visit);
  return matches;
}

function findExactHeadingsInSubtrees(model, roots, blockTypes, text) {
  const allowedTypes = Array.isArray(blockTypes) ? blockTypes : [blockTypes];
  const matches = [];
  roots.forEach((root, rootIndex) => {
    const visit = (block) => {
      if (!block) return;
      if (allowedTypes.some((blockType) => isExactHeading(block, blockType, text))) {
        matches.push({ block, rootIndex });
      }
      for (const childId of model.childrenByParent.get(block.block_id) ?? []) {
        visit(model.blocks.get(childId));
      }
    };
    visit(root);
  });
  return matches;
}

function validQuote(model, block) {
  if (block?.block_type !== BLOCK.QUOTE_CONTAINER) return false;
  const children = (model.childrenByParent.get(block.block_id) ?? []).map((id) => model.blocks.get(id));
  const labels = children.filter((child) => child?.block_type === BLOCK.TEXT);
  const bullets = children.filter((child) => child?.block_type === BLOCK.BULLET);
  return labels.length >= 1 && bullets.length >= 1;
}

function parseJobHeading(block) {
  if (!block || ![BLOCK.HEADING3, BLOCK.TEXT].includes(block.block_type)) return null;
  const match = textOfBlock(block).match(/^[（(](\d+)[）)]\s*([^｜|]+)\s*[｜|]\s*([^｜|]+)\s*[｜|]\s*(.+)$/);
  if (!match) return null;
  return {
    ordinal: Number(match[1]),
    title: match[2].trim(),
    location: match[3].trim(),
    employment: match[4].trim()
  };
}

function quoteSections(model, quote) {
  const sections = emptyQuoteSections();
  let active = "";
  for (const childId of model.childrenByParent.get(quote.block_id) ?? []) {
    const child = model.blocks.get(childId);
    if (child?.block_type === BLOCK.TEXT) {
      active = quoteSectionKey(textOfBlock(child));
      continue;
    }
    if (child?.block_type === BLOCK.BULLET && active) {
      sections[active].push(textOfBlock(child));
    }
  }
  return sections;
}

function emptyQuoteSections() {
  return { responsibilities: [], requirements: [], bonuses: [] };
}

function quoteSectionKey(value) {
  const label = String(value ?? "")
    .normalize("NFKC")
    .replace(/[：:]\s*$/, "")
    .replace(/\s+/g, "")
    .trim();
  if (["工作内容", "岗位职责"].includes(label)) return "responsibilities";
  if (["职位要求", "任职要求"].includes(label)) return "requirements";
  if (["加分项", "你可获得"].includes(label)) return "bonuses";
  return "";
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
