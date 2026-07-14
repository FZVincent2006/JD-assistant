import {
  FEISHU_APP_ID,
  FEISHU_AUTH_MODE,
  FEISHU_SCOPES,
  FEISHU_TOKEN_URL
} from "../lib/feishuConfig.js";
import {
  buildAuthorizeUrl,
  createOAuthState,
  createPkcePair,
  parseOAuthCallback
} from "../lib/feishuPkce.js";
import { createFeishuAuthSession, FeishuAuthError } from "./feishuAuthSession.js";
import { createFeishuNativeAuth } from "./feishuNativeAuth.js";

export { FeishuAuthError } from "./feishuAuthSession.js";

export function createFeishuAuth(options = {}) {
  const authMode = options.authMode ?? FEISHU_AUTH_MODE;
  if (authMode === "native") return createFeishuNativeAuth(options);
  if (authMode !== "pkce") throw new FeishuAuthError(`Unsupported Feishu auth mode: ${authMode}`);
  return createSecretlessFeishuAuth(options);
}

export function createSecretlessFeishuAuth({
  chromeApi = chrome,
  fetchImpl = fetch,
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
      const state = stateFactory();
      const { verifier, challenge } = await createPkcePair(cryptoApi);
      const callbackUrl = await chromeApi.identity.launchWebAuthFlow({
        url: buildAuthorizeUrl({ appId, redirectUri, scopes: FEISHU_SCOPES, state, challenge }),
        interactive: true
      });
      const { code } = parseOAuthCallback(callbackUrl, state);
      const token = await exchangeCode({ fetchImpl, appId, code, verifier, redirectUri });
      return authSession.store({
        accessToken: token.access_token,
        expiresIn: token.expires_in,
        scope: token.scope
      });
    }
  };
}

export async function exchangeCode({ fetchImpl, appId, code, verifier, redirectUri }) {
  let response;
  try {
    response = await fetchImpl(FEISHU_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: appId,
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri
      })
    });
  } catch {
    throw new FeishuAuthError("Feishu token request failed");
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code) {
    throw new FeishuAuthError("Feishu token exchange was rejected", {
      status: response.status,
      code: Number(payload.code ?? 0),
      logId: response.headers?.get?.("x-tt-logid") ?? ""
    });
  }
  if (!payload.access_token || !Number.isFinite(payload.expires_in)) {
    throw new FeishuAuthError("Feishu token response is incomplete", { status: response.status });
  }
  return payload;
}
