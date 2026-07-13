import {
  FEISHU_APP_ID,
  FEISHU_SCOPES,
  FEISHU_TOKEN_URL
} from "../lib/feishuConfig.js";
import {
  buildAuthorizeUrl,
  createOAuthState,
  createPkcePair,
  parseOAuthCallback
} from "../lib/feishuPkce.js";

const SESSION_KEY = "feishuAuthSession";
const EXPIRY_SAFETY_MS = 60_000;

export class FeishuAuthError extends Error {
  constructor(message, { status = 0, code = 0, logId = "" } = {}) {
    super(message);
    this.name = "FeishuAuthError";
    Object.assign(this, { status, code, logId });
  }
}

export function createFeishuAuth({
  chromeApi = chrome,
  fetchImpl = fetch,
  appId = FEISHU_APP_ID,
  cryptoApi = globalThis.crypto,
  stateFactory = () => createOAuthState(cryptoApi),
  now = Date.now
} = {}) {
  const session = chromeApi.storage.session;

  async function readValidSession() {
    const stored = (await session.get(SESSION_KEY))[SESSION_KEY];
    if (!stored?.accessToken || !Number.isFinite(stored.expiresAt)) return { state: "missing" };
    if (stored.expiresAt - now() <= EXPIRY_SAFETY_MS) {
      await session.remove(SESSION_KEY);
      return { state: "expired" };
    }
    return { state: "valid", value: stored };
  }

  return {
    async status() {
      const current = await readValidSession();
      if (current.state === "expired") return { status: "expired" };
      if (current.state !== "valid") return { status: "unauthorized" };
      return {
        status: "authorized",
        expiresAt: current.value.expiresAt,
        grantedScopes: [...(current.value.grantedScopes ?? [])]
      };
    },

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
      const expiresAt = now() + token.expires_in * 1000;
      const grantedScopes = String(token.scope ?? "").split(/\s+/).filter(Boolean);
      await session.set({
        [SESSION_KEY]: {
          accessToken: token.access_token,
          expiresAt,
          grantedScopes
        }
      });
      return { status: "authorized", expiresAt, grantedScopes };
    },

    async getAccessToken() {
      const current = await readValidSession();
      if (current.state !== "valid") throw new FeishuAuthError("Feishu authorization required");
      return current.value.accessToken;
    },

    async clear() {
      await session.remove(SESSION_KEY);
      return { status: "unauthorized" };
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
