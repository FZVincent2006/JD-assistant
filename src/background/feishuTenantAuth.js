import { FEISHU_APP_ID } from "../lib/feishuConfig.js";
import { FEISHU_NATIVE_HOST } from "./feishuNativeAuth.js";

const SESSION_KEY = "feishuTenantAuthSessionV1";
const EXPIRY_SAFETY_MS = 5 * 60 * 1000;

export class FeishuTenantAuthError extends Error {
  constructor(message, { code = 0, stage = "feishu-tenant-token" } = {}) {
    super(message);
    this.name = "FeishuTenantAuthError";
    Object.assign(this, { code, stage });
  }
}

export function createFeishuTenantAuth({
  chromeApi = chrome,
  appId = FEISHU_APP_ID,
  now = Date.now
} = {}) {
  async function getAccessToken() {
    const stored = (await chromeApi.storage.session.get(SESSION_KEY))?.[SESSION_KEY];
    if (stored?.accessToken && stored.expiresAt - now() > EXPIRY_SAFETY_MS) {
      return stored.accessToken;
    }
    const result = await requestNativeToken();
    if (!result?.ok || !result.accessToken || !Number.isFinite(Number(result.expiresIn))) {
      throw new FeishuTenantAuthError("Feishu application token is unavailable", {
        code: Number(result?.errorCode || 0)
      });
    }
    const next = {
      accessToken: result.accessToken,
      expiresAt: now() + Number(result.expiresIn) * 1000
    };
    await chromeApi.storage.session.set({ [SESSION_KEY]: next });
    return next.accessToken;
  }

  async function clear() {
    await chromeApi.storage.session.remove(SESSION_KEY);
  }

  function requestNativeToken() {
    return new Promise((resolve, reject) => {
      try {
        chromeApi.runtime.sendNativeMessage(
          FEISHU_NATIVE_HOST,
          { type: "GET_TENANT_TOKEN", appId },
          (response) => {
            if (chromeApi.runtime.lastError) {
              reject(new FeishuTenantAuthError("Feishu authorization helper is unavailable"));
              return;
            }
            resolve(response);
          }
        );
      } catch {
        reject(new FeishuTenantAuthError("Feishu authorization helper is unavailable"));
      }
    });
  }

  return { getAccessToken, clear };
}
