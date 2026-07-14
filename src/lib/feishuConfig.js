export const PRODUCTION_FEISHU_DOC_URL = "https://zhenfund.feishu.cn/wiki/RTWjwVZjri4uCUk0J8wcn2K3n6d";
export const PRODUCTION_FEISHU_WIKI_TOKEN = "RTWjwVZjri4uCUk0J8wcn2K3n6d";
export const FEISHU_APP_ID = String(import.meta.env?.VITE_FEISHU_APP_ID ?? "").trim();
export const FEISHU_AUTH_MODE = String(import.meta.env?.VITE_FEISHU_AUTH_MODE ?? "pkce").trim() || "pkce";
export const FEISHU_TOKEN_URL = "https://open.feishu.cn/open-apis/authen/v2/oauth/token";
export const FEISHU_SCOPES = Object.freeze([
  "wiki:wiki:readonly",
  "docx:document:readonly",
  "docx:document:write_only"
]);

export function isProductionFeishuDocument(url = "") {
  try {
    const candidate = new URL(url);
    const allowed = new URL(PRODUCTION_FEISHU_DOC_URL);
    return candidate.origin === allowed.origin && candidate.pathname === allowed.pathname;
  } catch {
    return false;
  }
}
