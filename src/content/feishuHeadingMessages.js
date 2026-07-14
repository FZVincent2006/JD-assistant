import { applyFeishuHeadingNumbering } from "./feishuHeadingNumbering.js";

export async function handleFeishuHeadingNumberingMessage(message, options = {}) {
  if (message?.type !== "FEISHU_APPLY_HEADING_NUMBERING") return null;
  const apply = options.apply ?? applyFeishuHeadingNumbering;
  return apply({
    root: options.root ?? document,
    url: options.url ?? location.href,
    companyName: String(message.companyName ?? "").trim()
  });
}
