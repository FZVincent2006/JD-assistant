export const TEST_FEISHU_DOC_URL = "https://zhenfund.feishu.cn/wiki/LlhrwSLIvilANZk1opwcQGlUnNv";
export const TEST_FEISHU_WIKI_TOKEN = "LlhrwSLIvilANZk1opwcQGlUnNv";
export const FEISHU_APP_ID = String(import.meta.env?.VITE_FEISHU_APP_ID ?? "").trim();
export const FEISHU_AUTH_MODE = String(import.meta.env?.VITE_FEISHU_AUTH_MODE ?? "pkce").trim() || "pkce";
export const FEISHU_TOKEN_URL = "https://open.feishu.cn/open-apis/authen/v2/oauth/token";
export const FEISHU_SCOPES = Object.freeze([
  "wiki:wiki:readonly",
  "docx:document:readonly",
  "docx:document:write_only"
]);

export function isTestFeishuDocument(url = "") {
  try {
    const candidate = new URL(url);
    const allowed = new URL(TEST_FEISHU_DOC_URL);
    return candidate.origin === allowed.origin && candidate.pathname === allowed.pathname;
  } catch {
    return false;
  }
}
