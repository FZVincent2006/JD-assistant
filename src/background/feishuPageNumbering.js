import { isProductionFeishuDocument } from "../lib/feishuConfig.js";

export class FeishuPageNumberingError extends Error {
  constructor(message, reason = "page-unavailable") {
    super(message);
    this.name = "FeishuPageNumberingError";
    Object.assign(this, { stage: "jd-numbering-page", reason, status: 0, code: 0, logId: "" });
  }
}

export function createFeishuPageNumbering({ chromeApi = chrome } = {}) {
  return {
    async prepare(companyName) {
      const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !isProductionFeishuDocument(tab.url)) {
        throw new FeishuPageNumberingError("当前活动标签页不是指定飞书测试副本。", "wrong-document");
      }
      const message = {
        type: "FEISHU_PREPARE_HEADING_NUMBERING",
        companyName
      };
      let response;
      try {
        response = await chromeApi.tabs.sendMessage(tab.id, message);
      } catch {
        try {
          await chromeApi.scripting.executeScript({
            target: { tabId: tab.id, allFrames: false },
            files: ["content.js"]
          });
          response = await chromeApi.tabs.sendMessage(tab.id, message);
        } catch {
          throw new FeishuPageNumberingError(
            "无法在飞书测试副本页面启动定位脚本，请重新加载扩展并刷新页面后重试。",
            "page-unavailable"
          );
        }
      }
      if (!response?.ok) {
        throw new FeishuPageNumberingError(response?.error || "飞书页面自动编号失败。", response?.reason);
      }
      return { ok: true, state: response.state === "already-numbered" ? "already-numbered" : "prepared" };
    }
  };
}
