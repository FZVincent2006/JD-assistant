export const BLOCK = Object.freeze({
  PAGE: 1,
  TEXT: 2,
  HEADING1: 3,
  HEADING2: 4,
  HEADING3: 5,
  BULLET: 12,
  CALLOUT: 19,
  QUOTE_CONTAINER: 34
});

const BLOCK_FIELD = Object.freeze({
  [BLOCK.PAGE]: "page",
  [BLOCK.TEXT]: "text",
  [BLOCK.HEADING1]: "heading1",
  [BLOCK.HEADING2]: "heading2",
  [BLOCK.HEADING3]: "heading3",
  [BLOCK.BULLET]: "bullet",
  [BLOCK.CALLOUT]: "callout",
  [BLOCK.QUOTE_CONTAINER]: "quote_container"
});

export function buildBlockModel(items, revisionId) {
  if (!Array.isArray(items) || !items.length) throw new Error("Feishu block list is empty");
  const blocks = new Map();
  for (const block of items) {
    if (!block?.block_id) throw new Error("Feishu block is missing an ID");
    if (blocks.has(block.block_id)) throw new Error(`Duplicate Feishu block ID: ${block.block_id}`);
    blocks.set(block.block_id, block);
  }

  const pages = items.filter((block) => block.block_type === BLOCK.PAGE);
  if (pages.length !== 1) throw new Error("Feishu document must contain exactly one Page block");
  const rootId = pages[0].block_id;
  const childrenByParent = new Map();
  for (const block of items) {
    const children = Array.isArray(block.children) ? [...block.children] : [];
    for (const childId of children) {
      if (!blocks.has(childId)) throw new Error(`Feishu block has a missing child: ${childId}`);
    }
    childrenByParent.set(block.block_id, children);
  }

  const preorder = [];
  const visited = new Set();
  const visiting = new Set();
  function visit(blockId) {
    if (visiting.has(blockId)) throw new Error(`Feishu block tree contains a cycle at ${blockId}`);
    if (visited.has(blockId)) throw new Error(`Feishu block appears more than once: ${blockId}`);
    visiting.add(blockId);
    preorder.push(blockId);
    for (const childId of childrenByParent.get(blockId) ?? []) visit(childId);
    visiting.delete(blockId);
    visited.add(blockId);
  }
  visit(rootId);

  if (visited.size !== blocks.size) throw new Error("Feishu block tree contains orphan blocks");
  for (const [parentId, childIds] of childrenByParent) {
    for (const childId of childIds) {
      const declaredParent = blocks.get(childId)?.parent_id;
      if (declaredParent && declaredParent !== parentId) {
        throw new Error(`Feishu block parent mismatch: ${childId}`);
      }
    }
  }
  return { revisionId, rootId, blocks, childrenByParent, preorder };
}

export function textOfBlock(block) {
  const field = BLOCK_FIELD[block?.block_type];
  const elements = field ? block?.[field]?.elements : undefined;
  if (!Array.isArray(elements)) return "";
  return elements
    .map((element) => element?.text_run?.content ?? "")
    .join("")
    .replace(/[\u200b\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function fieldForBlockType(blockType) {
  return BLOCK_FIELD[blockType];
}

export function sanitizeStructuralFixture(items) {
  if (!Array.isArray(items)) throw new TypeError("Feishu fixture items must be an array");
  const idMap = new Map(items.map((block, index) => [block.block_id, `b-${String(index + 1).padStart(3, "0")}`]));
  return items.map((block) => {
    const sanitized = {
      block_id: idMap.get(block.block_id),
      block_type: block.block_type,
      children: (block.children ?? []).map((id) => idMap.get(id)).filter(Boolean)
    };
    if (block.parent_id && idMap.has(block.parent_id)) sanitized.parent_id = idMap.get(block.parent_id);
    const field = BLOCK_FIELD[block.block_type];
    if (field && block[field]) sanitized[field] = sanitizeBlockProperty(block[field], field);
    return sanitized;
  });
}

function sanitizeBlockProperty(property, field) {
  if (field === "callout" || field === "quote_container") return structuredClone(property);
  const result = { style: structuredClone(property.style ?? {}), elements: [] };
  for (const element of property.elements ?? []) {
    const content = String(element?.text_run?.content ?? "");
    const textElementStyle = structuredClone(element?.text_run?.text_element_style ?? {});
    if (textElementStyle.link) textElementStyle.link = { url: "https://example.com/" };
    result.elements.push({
      text_run: {
        content: preserveStructuralText(content) ? content : "示例正文",
        ...(Object.keys(textElementStyle).length ? { text_element_style: textElementStyle } : {})
      }
    });
  }
  return result;
}

function preserveStructuralText(value) {
  const text = value.trim();
  return [
    "Portfolio开放岗位汇总",
    "岗位JD整理",
    "公司介绍",
    "开放岗位",
    "工作内容：",
    "职位要求：",
    "加分项："
  ].includes(text)
    || /^示例公司[甲乙丙丁]/.test(text)
    || /^（\d+）示例岗位/.test(text)
    || /^示例岗位[^｜|]*[｜|]/.test(text);
}
