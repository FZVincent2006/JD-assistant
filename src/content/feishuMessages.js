import { isProductionFeishuDocument } from "../lib/feishuConfig.js";
import { executeFeishuWrite } from "./feishuWriter.js";
import { findFeishuInsertionTargetFully, scanFeishuDocument } from "./feishuScanner.js";

export async function handleFeishuMessage(message, options = {}) {
  const root = options.root ?? document;
  const url = options.url ?? location.href;
  if (!isProductionFeishuDocument(url)) {
    return { ok: false, error: "仅允许操作指定正式招聘文档。" };
  }

  if (message?.type === "FEISHU_INSPECT") {
    const scan = options.scan ?? scanFeishuDocument;
    const snapshot = await scan(root);
    return { ok: true, snapshot };
  }

  if (message?.type === "FEISHU_WRITE") {
    const write = options.write ?? executeFeishuWrite;
    return write(
      { root, url, draft: message.payload },
      {
        inspect: (targetRoot) => scanFeishuDocument(targetRoot, { settleMs: 160 }),
        locate: (targetRoot, plan, area, snapshot) =>
          findFeishuInsertionTargetFully(targetRoot, plan, area, snapshot, { settleMs: 160 }),
        settle: () => new Promise((resolve) => setTimeout(resolve, 900))
      }
    );
  }

  return null;
}
