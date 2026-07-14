import { isTestFeishuDocument } from "../lib/feishuConfig.js";

export class FeishuPageNumberingError extends Error {
  constructor(message, reason = "page-unavailable") {
    super(message);
    this.name = "FeishuPageNumberingError";
    Object.assign(this, { stage: "jd-numbering-page", reason, status: 0, code: 0, logId: "" });
  }
}

export function createFeishuPageNumbering({ chromeApi = chrome } = {}) {
  return {
    async apply(companyName) {
      const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !isTestFeishuDocument(tab.url)) {
        throw new FeishuPageNumberingError("当前活动标签页不是指定飞书测试副本。", "wrong-document");
      }
      let response;
      try {
        response = await chromeApi.tabs.sendMessage(tab.id, {
          type: "FEISHU_APPLY_HEADING_NUMBERING",
          companyName
        });
      } catch {
        throw new FeishuPageNumberingError("无法连接飞书测试副本页面，请刷新页面后重试。", "page-unavailable");
      }
      if (!response?.ok) {
        throw new FeishuPageNumberingError(response?.error || "飞书页面自动编号失败。", response?.reason);
      }
      return { ok: true };
    }
  };
}
