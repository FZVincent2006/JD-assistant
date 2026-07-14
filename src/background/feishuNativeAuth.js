import { FEISHU_APP_ID, FEISHU_SCOPES } from "../lib/feishuConfig.js";
import {
  buildAuthorizeUrl,
  createOAuthState,
  createPkcePair,
  parseOAuthCallback
} from "../lib/feishuPkce.js";
import { createFeishuAuthSession, FeishuAuthError } from "./feishuAuthSession.js";

export const FEISHU_NATIVE_HOST = "cn.zhenfund.jd_assistant.feishu_auth";

export function createFeishuNativeAuth({
  chromeApi = chrome,
  appId = FEISHU_APP_ID,
  cryptoApi = globalThis.crypto,
  stateFactory = () => createOAuthState(cryptoApi),
  now = Date.now
} = {}) {
  const authSession = createFeishuAuthSession({ chromeApi, now });

  return {
    status: authSession.status,
    getAccessToken: authSession.getAccessToken,
    clear: authSession.clear,

    async authorize() {
      if (!appId?.trim()) throw new FeishuAuthError("Feishu App ID is not configured");
      const redirectUri = chromeApi.identity.getRedirectURL("feishu");
      requireChromiumRedirect(redirectUri);
      const state = stateFactory();
      const { verifier, challenge } = await createPkcePair(cryptoApi);
      let callbackUrl;
      try {
        callbackUrl = await chromeApi.identity.launchWebAuthFlow({
          url: buildAuthorizeUrl({ appId, redirectUri, scopes: FEISHU_SCOPES, state, challenge }),
          interactive: true
        });
      } catch (error) {
        throw withAuthStage(error, "oauth-launch");
      }
      let code;
      try {
        ({ code } = parseOAuthCallback(callbackUrl, state));
      } catch (error) {
        throw withAuthStage(error, "oauth-callback");
      }
      let nativeResponse;
      try {
        nativeResponse = await exchangeThroughNativeHost(chromeApi, {
          type: "EXCHANGE_CODE",
          appId,
          code,
          redirectUri,
          codeVerifier: verifier
        });
      } catch (error) {
        throw withAuthStage(error, "native-exchange");
      }
      if (!nativeResponse?.ok) {
        throw new FeishuAuthError(knownNativeMessage(nativeResponse?.message), {
          code: Number(nativeResponse?.errorCode ?? 0),
          logId: String(nativeResponse?.logId ?? ""),
          stage: "native-exchange"
        });
      }
      try {
        return await authSession.store({
          accessToken: nativeResponse.accessToken,
          expiresIn: Number(nativeResponse.expiresIn),
          scope: nativeResponse.scope
        });
      } catch (error) {
        throw withAuthStage(error, "auth-store");
      }
    }
  };
}

function exchangeThroughNativeHost(chromeApi, message) {
  return new Promise((resolve, reject) => {
    try {
      chromeApi.runtime.sendNativeMessage(FEISHU_NATIVE_HOST, message, (response) => {
        const lastError = chromeApi.runtime.lastError;
        if (lastError) {
          const text = String(lastError.message ?? "");
          if (/native messaging host.*not found|specified native messaging host not found/i.test(text)) {
            reject(new FeishuAuthError("Feishu authorization helper is not installed"));
          } else {
            reject(new FeishuAuthError("Feishu authorization helper failed"));
          }
          return;
        }
        resolve(response);
      });
    } catch {
      reject(new FeishuAuthError("Feishu authorization helper failed"));
    }
  });
}

function requireChromiumRedirect(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && url.hostname.endsWith(".chromiumapp.org")) return;
  } catch {
    // Fall through to the sanitized public error.
  }
  throw new FeishuAuthError("Chrome identity redirect is unavailable");
}

function knownNativeMessage(message) {
  const known = new Set([
    "Feishu App Secret is not configured",
    "Feishu token exchange was rejected",
    "Feishu token response is incomplete"
  ]);
  return known.has(message) ? message : "Feishu authorization helper returned an invalid response";
}

function withAuthStage(error, stage) {
  return new FeishuAuthError(String(error?.message ?? "Feishu authorization failed"), {
    status: Number(error?.status ?? 0),
    code: Number(error?.code ?? 0),
    logId: String(error?.logId ?? ""),
    stage
  });
}
