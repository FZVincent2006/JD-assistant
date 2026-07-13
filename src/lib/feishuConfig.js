export const TEST_FEISHU_DOC_URL = "https://zhenfund.feishu.cn/wiki/LlhrwSLIvilANZk1opwcQGlUnNv";

export function isTestFeishuDocument(url = "") {
  try {
    const candidate = new URL(url);
    const allowed = new URL(TEST_FEISHU_DOC_URL);
    return candidate.origin === allowed.origin && candidate.pathname === allowed.pathname;
  } catch {
    return false;
  }
}
