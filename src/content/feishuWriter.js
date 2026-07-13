import { buildFeishuWritePlan } from "../lib/feishuPlan.js";
import { renderJdFragment, renderPortfolioFragment } from "../lib/feishuRichText.js";
import { findFeishuInsertionTarget, inspectFeishuDocument, isAllowedFeishuDocument } from "./feishuDocument.js";

export async function executeFeishuWrite({ url, draft, root = document }, dependencies = {}) {
  if (!isAllowedFeishuDocument(url)) {
    return { ok: false, stage: "preflight", completed: [], error: "仅允许写入指定测试副本，正式文档保持只读。" };
  }

  const inspect = dependencies.inspect ?? ((targetRoot) => inspectFeishuDocument(targetRoot));
  const locate = dependencies.locate ?? findFeishuInsertionTarget;
  const paste = dependencies.paste ?? pasteFeishuFragment;
  const settle = dependencies.settle ?? (() => delay(50));
  const before = await inspect(root);
  const plan = buildFeishuWritePlan(before, draft);
  if (!plan.ok) {
    return { ok: false, stage: "preflight", completed: [], error: plan.errors.join(" ") };
  }

  const fragments = {
    jd: renderJdFragment(draft, plan),
    summary: renderPortfolioFragment(draft, plan)
  };
  const completed = [];

  for (const area of ["jd", "summary"]) {
    try {
      const target = await locate(root, plan, area, before);
      if (!target) {
        return {
          ok: false,
          stage: area,
          completed,
          error: insertionError(area, completed)
        };
      }

      await paste(target, fragments[area], { root });
      await settle(area);
      const after = await inspect(root);
      if (!areaContainsDraft(after, draft, area)) {
        return {
          ok: false,
          stage: area,
          completed,
          error: verificationError(area, completed)
        };
      }
      completed.push(area);
    } catch (error) {
      return {
        ok: false,
        stage: area,
        completed,
        error: operationError(area, completed, error)
      };
    }
  }

  return { ok: true, completed, mode: plan.mode, plan };
}

export async function pasteFeishuFragment(target, fragment, dependencies = {}) {
  const root = dependencies.root ?? document;
  const writeClipboard = dependencies.writeClipboard ?? ((value) => writeRichClipboard(value, root));
  const dispatchPaste = dependencies.dispatchPaste ?? ((element, value) => dispatchRichPaste(element, value, root));
  const execCommand = dependencies.execCommand ?? ((command, showUi, value) => root.execCommand(command, showUi, value));
  let clipboardError = null;
  try {
    await writeClipboard(fragment);
  } catch (error) {
    clipboardError = error;
  }
  target.element.focus();
  placeCaret(root, target.element, target.position);
  if (dispatchPaste(target.element, fragment)) return true;
  if (execCommand("insertHTML", false, fragment.html)) return true;
  if (clipboardError) {
    const detail = clipboardError instanceof Error ? clipboardError.message : String(clipboardError);
    throw new Error(`浏览器拒绝写入系统剪贴板：${detail}`);
  }
  const pasted = execCommand("paste");
  if (!pasted) throw new Error("浏览器拒绝执行粘贴，请检查扩展剪贴板权限。");
  return true;
}

function dispatchRichPaste(element, fragment, root) {
  const view = root.defaultView ?? globalThis;
  const clipboardData = createClipboardData(view);
  clipboardData.setData("text/html", fragment.html);
  clipboardData.setData("text/plain", fragment.text);
  const EventType = view.ClipboardEvent ?? view.Event ?? Event;
  const event = new EventType("paste", { bubbles: true, cancelable: true, clipboardData });
  if (event.clipboardData !== clipboardData) {
    Object.defineProperty(event, "clipboardData", { value: clipboardData });
  }
  return element.dispatchEvent(event) === false || event.defaultPrevented;
}

function createClipboardData(view) {
  if (typeof view.DataTransfer === "function") return new view.DataTransfer();
  const values = new Map();
  return {
    getData: (type) => values.get(type) ?? "",
    setData: (type, value) => { values.set(type, String(value)); },
    get types() { return Array.from(values.keys()); }
  };
}

async function writeRichClipboard(fragment, root) {
  const clipboard = root.defaultView?.navigator?.clipboard ?? globalThis.navigator?.clipboard;
  const ClipboardItemType = root.defaultView?.ClipboardItem ?? globalThis.ClipboardItem;
  const BlobType = root.defaultView?.Blob ?? globalThis.Blob;
  if (clipboard?.write && ClipboardItemType && BlobType) {
    const item = new ClipboardItemType({
      "text/html": new BlobType([fragment.html], { type: "text/html" }),
      "text/plain": new BlobType([fragment.text], { type: "text/plain" })
    });
    await clipboard.write([item]);
    return;
  }

  const holder = root.createElement("div");
  holder.contentEditable = "true";
  holder.innerHTML = fragment.html;
  holder.style.cssText = "position:fixed;left:-9999px;top:0";
  root.body.appendChild(holder);
  const selection = root.getSelection();
  const range = root.createRange();
  range.selectNodeContents(holder);
  selection.removeAllRanges();
  selection.addRange(range);
  const copied = root.execCommand("copy");
  holder.remove();
  selection.removeAllRanges();
  if (!copied) throw new Error("浏览器拒绝写入剪贴板，请检查扩展权限。");
}

function placeCaret(root, element, position) {
  const selection = root.getSelection();
  const range = root.createRange();
  range.selectNodeContents(element);
  range.collapse(position !== "end");
  selection.removeAllRanges();
  selection.addRange(range);
}

function areaContainsDraft(snapshot, draft, area) {
  const companies = area === "jd" ? snapshot.jdCompanies : snapshot.portfolioCompanies;
  const company = companies.find((entry) => normalized(entry.name) === normalized(draft.companyName));
  if (!company) return false;
  const existing = new Set(company.jobs.map(normalized));
  return draft.jobs.every((job) => existing.has(normalized(job.title)));
}

function insertionError(area, completed) {
  const label = area === "jd" ? "JD 区" : "岗位汇总区";
  const suffix = completed.length ? "；JD 区已成功写入，请人工检查汇总区。" : "。";
  return `${label}没有找到唯一插入位置${suffix}`;
}

function verificationError(area, completed) {
  if (area === "summary" && completed.includes("jd")) {
    return "岗位汇总区写入后校验失败；JD 区已成功写入，请人工检查汇总区。";
  }
  return "JD 区写入后校验失败，已停止后续写入。";
}

function operationError(area, completed, error) {
  const detail = error instanceof Error ? error.message : String(error ?? "未知错误");
  if (area === "summary" && completed.includes("jd")) {
    return `岗位汇总区写入失败：${detail}；JD 区已成功写入，请人工检查汇总区。`;
  }
  return `JD 区写入失败：${detail}；已停止后续写入，请人工检查 JD 区。`;
}

function normalized(value = "") {
  return String(value).replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
