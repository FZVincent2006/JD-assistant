import { isTestFeishuDocument } from "../lib/feishuConfig.js";

const REASONS = {
  "wrong-document": "当前活动标签页不是指定飞书测试副本。",
  "not-editable": "飞书测试副本当前不可编辑。",
  "heading-missing": "未找到待编号的新公司 Heading 1。",
  "heading-duplicate": "找到多个同名 Heading 1，已停止编号。",
  "already-numbered": "目标公司 Heading 1 已经存在编号，未再次执行快捷键。",
  "shortcut-rejected": "飞书编辑器未接受自动编号快捷键。"
};

export async function applyFeishuHeadingNumbering({
  root = document,
  url = location.href,
  companyName,
  settle = defaultSettle,
  maxSteps = 160
}) {
  if (!isTestFeishuDocument(url)) return failure("wrong-document");
  if (!root.querySelector('[contenteditable="true"]') && root.querySelector(".block.docx-heading1-block[data-block-id]")) {
    return failure("not-editable");
  }

  const candidates = await collectCandidates(root, companyName, settle, maxSteps);
  if (!candidates.length) return failure("heading-missing");
  if (candidates.length !== 1) return failure("heading-duplicate");

  const block = await revealCandidate(root, candidates[0], settle, maxSteps);
  const editor = block?.querySelector('[contenteditable="true"]');
  if (!block || !editor) return failure("heading-missing");
  if (block.querySelector(".heading-order")) return failure("already-numbered");

  placeCaret(editor, root);
  const KeyboardEventClass = root.defaultView?.KeyboardEvent ?? KeyboardEvent;
  const event = { key: "7", code: "Digit7", metaKey: true, shiftKey: true, bubbles: true, cancelable: true };
  editor.dispatchEvent(new KeyboardEventClass("keydown", event));
  editor.dispatchEvent(new KeyboardEventClass("keyup", event));
  await settle(300);
  return block.querySelector(".heading-order") ? { ok: true } : failure("shortcut-rejected");
}

function failure(reason) {
  return { ok: false, reason, error: REASONS[reason] };
}

async function collectCandidates(root, companyName, settle, maxSteps) {
  const scroll = findScrollContainer(root);
  const originalTop = scroll?.scrollTop ?? 0;
  const matches = new Set();
  for (const top of scrollPositions(scroll, maxSteps)) {
    await moveScroll(root, scroll, top, settle);
    for (const block of matchingBlocks(root, companyName)) {
      const id = block.getAttribute("data-block-id");
      if (id) matches.add(id);
    }
  }
  await moveScroll(root, scroll, originalTop, settle);
  return [...matches];
}

async function revealCandidate(root, blockId, settle, maxSteps) {
  const scroll = findScrollContainer(root);
  for (const top of scrollPositions(scroll, maxSteps)) {
    await moveScroll(root, scroll, top, settle);
    const block = Array.from(root.querySelectorAll(".block.docx-heading1-block[data-block-id]"))
      .find((candidate) => candidate.getAttribute("data-block-id") === blockId);
    if (block) {
      block.scrollIntoView?.({ block: "center" });
      return block;
    }
  }
  return null;
}

function matchingBlocks(root, companyName) {
  const expected = normalized(companyName);
  return Array.from(root.querySelectorAll(".block.docx-heading1-block[data-block-id]")).filter((block) => {
    if (block.closest(".docx-callout-block, .docx-quote_container-block, .docx-quote-block")) return false;
    const editor = block.querySelector('[contenteditable="true"]');
    return editor && normalized(editor.textContent) === expected;
  });
}

function findScrollContainer(root) {
  return Array.from(root.querySelectorAll("*"))
    .find((element) => String(element.className ?? "").includes("bear-web-x-container") && element.scrollHeight > element.clientHeight);
}

function scrollPositions(scroll, maxSteps) {
  if (!scroll) return [0];
  const maxTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
  const stepSize = Math.max(300, Math.floor(scroll.clientHeight * 0.72));
  const positions = [];
  for (let top = 0, steps = 0; steps < maxSteps; steps += 1) {
    positions.push(top);
    if (top >= maxTop) break;
    top = Math.min(maxTop, top + stepSize);
  }
  return positions;
}

async function moveScroll(root, scroll, top, settle) {
  if (!scroll) return;
  scroll.scrollTop = top;
  const EventClass = root.defaultView?.Event ?? Event;
  scroll.dispatchEvent(new EventClass("scroll", { bubbles: true }));
  await settle(120);
}

function placeCaret(editor, root) {
  editor.focus();
  const selection = root.defaultView?.getSelection?.();
  if (!selection) return;
  const range = root.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function normalized(value) {
  return String(value ?? "")
    .replace(/[\u200b\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function defaultSettle(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
