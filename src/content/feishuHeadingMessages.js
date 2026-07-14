import { prepareFeishuHeadingNumbering } from "./feishuHeadingNumbering.js";

export async function handleFeishuHeadingNumberingMessage(message, options = {}) {
  if (message?.type !== "FEISHU_PREPARE_HEADING_NUMBERING") return null;
  const prepare = options.prepare ?? prepareFeishuHeadingNumbering;
  return prepare({
    root: options.root ?? document,
    url: options.url ?? location.href,
    companyName: String(message.companyName ?? "").trim()
  });
}
