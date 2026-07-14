import { FEISHU_NATIVE_HOST } from "./feishuNativeAuth.js";

export { FEISHU_NATIVE_HOST };

const KNOWN_REASONS = new Set([
  "accessibility-not-granted",
  "unsupported-front-app",
  "web-area-missing",
  "web-area-focus-failed",
  "native-event-failed"
]);

export class FeishuNativeNumberingError extends Error {
  constructor(message, reason = "native-result-unknown", ambiguous = true) {
    super(message);
    this.name = "FeishuNativeNumberingError";
    Object.assign(this, {
      stage: "jd-numbering-page",
      reason,
      ambiguous,
      status: 0,
      code: 0,
      logId: ""
    });
  }
}

export function createFeishuNativeNumbering({ chromeApi = chrome } = {}) {
  return {
    async apply() {
      const response = await sendFixedNativeRequest(chromeApi);
      if (response?.ok) return { ok: true };
      if (KNOWN_REASONS.has(response?.reason)) {
        throw new FeishuNativeNumberingError(
          String(response?.message || response.reason),
          response.reason,
          false
        );
      }
      throw unknownResult();
    }
  };
}

function sendFixedNativeRequest(chromeApi) {
  return new Promise((resolve, reject) => {
    try {
      chromeApi.runtime.sendNativeMessage(
        FEISHU_NATIVE_HOST,
        { type: "APPLY_HEADING_NUMBERING" },
        (response) => {
          const lastError = chromeApi.runtime.lastError;
          if (lastError || !response) {
            reject(unknownResult());
            return;
          }
          resolve(response);
        }
      );
    } catch {
      reject(unknownResult());
    }
  });
}

function unknownResult() {
  return new FeishuNativeNumberingError(
    "本机编号助手结果未知。",
    "native-result-unknown",
    true
  );
}
