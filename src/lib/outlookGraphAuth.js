import { createOAuthState, createPkcePair } from "./feishuPkce.js";

export const OUTLOOK_GRAPH_AUTH_STORAGE_KEY = "outlookGraphAuthV1";

const CHINA_AUTHORITY = "https://login.chinacloudapi.cn";
const GRAPH_SCOPES = Object.freeze([
  "openid",
  "offline_access",
  "Mail.Read",
  "Mail.Read.Shared"
]);
const EXPIRY_SAFETY_MS = 5 * 60 * 1000;

export class OutlookGraphAuthError extends Error {
  constructor(message, { status = 0, code = "", stage = "outlook-graph-auth" } = {}) {
    super(message);
    this.name = "OutlookGraphAuthError";
    Object.assign(this, { status, code, stage });
  }
}

export function createOutlookGraphAuth({
  chromeApi = chrome,
  fetchImpl = fetch,
  cryptoApi = globalThis.crypto,
  now = Date.now,
  stateFactory = () => createOAuthState(cryptoApi),
  pkceFactory = () => createPkcePair(cryptoApi)
} = {}) {
  async function authorize(config) {
    const normalized = normalizeConfig(config);
    const redirectUri = chromeApi.identity.getRedirectURL("outlook");
    const state = stateFactory();
    const { verifier, challenge } = await pkceFactory();
    const url = authorizationUrl(normalized, { redirectUri, state, challenge });
    let callbackUrl;
    try {
      callbackUrl = await chromeApi.identity.launchWebAuthFlow({ url, interactive: true });
    } catch {
      throw new OutlookGraphAuthError("Outlook authorization was cancelled", {
        stage: "outlook-graph-authorize"
      });
    }
    const code = parseCallback(callbackUrl, state);
    const token = await exchangeToken(normalized, {
      grant_type: "authorization_code",
      client_id: normalized.clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      scope: GRAPH_SCOPES.join(" ")
    });
    return storeToken(normalized, token);
  }

  async function getAccessToken(config) {
    const normalized = normalizeConfig(config);
    const stored = await readStored();
    if (!sameRegistration(stored, normalized) || !stored?.refreshToken) {
      throw new OutlookGraphAuthError("Outlook authorization required", {
        stage: "outlook-graph-authorization-required"
      });
    }
    if (stored.accessToken && stored.expiresAt - now() > EXPIRY_SAFETY_MS) {
      return stored.accessToken;
    }
    const token = await exchangeToken(normalized, {
      grant_type: "refresh_token",
      client_id: normalized.clientId,
      refresh_token: stored.refreshToken,
      scope: GRAPH_SCOPES.join(" ")
    });
    const status = await storeToken(normalized, {
      ...token,
      refresh_token: token.refresh_token || stored.refreshToken
    });
    return status.accessToken;
  }

  async function status(config) {
    let normalized;
    try {
      normalized = normalizeConfig(config);
    } catch {
      return { status: "unconfigured" };
    }
    const stored = await readStored();
    if (!sameRegistration(stored, normalized) || !stored?.refreshToken) {
      return { status: "unauthorized" };
    }
    return {
      status: "authorized",
      expiresAt: Number(stored.expiresAt || 0),
      grantedScopes: [...(stored.grantedScopes || [])]
    };
  }

  async function clear() {
    await chromeApi.storage.local.remove(OUTLOOK_GRAPH_AUTH_STORAGE_KEY);
    return { status: "unauthorized" };
  }

  async function exchangeToken(config, form) {
    let response;
    try {
      response = await fetchImpl(tokenEndpoint(config.tenantId), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(form).toString()
      });
    } catch {
      throw new OutlookGraphAuthError("Outlook token request failed", {
        stage: "outlook-graph-token"
      });
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) {
      throw new OutlookGraphAuthError("Outlook token request was rejected", {
        status: response.status,
        code: String(payload.error || ""),
        stage: "outlook-graph-token"
      });
    }
    return payload;
  }

  async function storeToken(config, token) {
    const expiresIn = Number(token.expires_in || 0);
    if (!token.access_token || !token.refresh_token || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new OutlookGraphAuthError("Outlook token response is incomplete", {
        stage: "outlook-graph-token"
      });
    }
    const stored = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: now() + expiresIn * 1000,
      clientId: config.clientId,
      tenantId: config.tenantId,
      grantedScopes: String(token.scope || "").split(/\s+/).filter(Boolean)
    };
    await chromeApi.storage.local.set({ [OUTLOOK_GRAPH_AUTH_STORAGE_KEY]: stored });
    return {
      status: "authorized",
      expiresAt: stored.expiresAt,
      grantedScopes: stored.grantedScopes,
      accessToken: stored.accessToken
    };
  }

  async function readStored() {
    return (await chromeApi.storage.local.get(OUTLOOK_GRAPH_AUTH_STORAGE_KEY))
      ?.[OUTLOOK_GRAPH_AUTH_STORAGE_KEY];
  }

  return { authorize, getAccessToken, status, clear };
}

export function normalizeOutlookGraphConfig(config) {
  return normalizeConfig(config);
}

function normalizeConfig(config) {
  const clientId = String(config?.outlookClientId || config?.clientId || "").trim();
  const tenantId = String(config?.outlookTenantId || config?.tenantId || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId)) {
    throw new OutlookGraphAuthError("Invalid Outlook application client ID", {
      stage: "outlook-graph-config"
    });
  }
  if (!/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-z0-9][a-z0-9.-]{1,98}[a-z0-9])$/i.test(tenantId)) {
    throw new OutlookGraphAuthError("Invalid Outlook tenant ID", {
      stage: "outlook-graph-config"
    });
  }
  return { clientId, tenantId };
}

function authorizationUrl(config, { redirectUri, state, challenge }) {
  const url = new URL(`${CHINA_AUTHORITY}/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", GRAPH_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

function tokenEndpoint(tenantId) {
  return `${CHINA_AUTHORITY}/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
}

function parseCallback(callbackUrl, expectedState) {
  const url = new URL(callbackUrl);
  if (url.searchParams.get("state") !== expectedState) {
    throw new OutlookGraphAuthError("Outlook OAuth state mismatch", {
      stage: "outlook-graph-callback"
    });
  }
  if (url.searchParams.get("error")) {
    throw new OutlookGraphAuthError("Outlook authorization was cancelled", {
      stage: "outlook-graph-callback"
    });
  }
  const code = url.searchParams.get("code");
  if (!code) {
    throw new OutlookGraphAuthError("Outlook authorization code is missing", {
      stage: "outlook-graph-callback"
    });
  }
  return code;
}

function sameRegistration(stored, config) {
  return stored?.clientId === config.clientId && stored?.tenantId === config.tenantId;
}
