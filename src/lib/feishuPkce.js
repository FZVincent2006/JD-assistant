const AUTHORIZE_URL = "https://accounts.feishu.cn/open-apis/authen/v1/authorize";

export async function createPkcePair(cryptoApi = globalThis.crypto) {
  requireCrypto(cryptoApi);
  const verifier = randomBase64Url(cryptoApi, 64);
  const digest = await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

export function createOAuthState(cryptoApi = globalThis.crypto) {
  requireCrypto(cryptoApi);
  return randomBase64Url(cryptoApi, 32);
}

export function buildAuthorizeUrl({ appId, redirectUri, scopes, state, challenge }) {
  if (!appId?.trim()) throw new Error("Feishu App ID is required");
  if (!redirectUri?.trim()) throw new Error("Feishu OAuth redirect URI is required");
  if (!state?.trim()) throw new Error("Feishu OAuth state is required");
  if (!challenge?.trim()) throw new Error("Feishu PKCE challenge is required");

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", [...new Set(scopes ?? [])].join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

export function parseOAuthCallback(callbackUrl, expectedState) {
  const url = new URL(callbackUrl);
  const actualState = url.searchParams.get("state");
  if (!actualState || actualState !== expectedState) throw new Error("OAuth state mismatch");
  if (url.searchParams.get("error")) throw new Error("Feishu authorization was cancelled");
  const code = url.searchParams.get("code");
  if (!code) throw new Error("Feishu authorization code is missing");
  return { code };
}

function randomBase64Url(cryptoApi, byteLength) {
  const bytes = new Uint8Array(byteLength);
  cryptoApi.getRandomValues(bytes);
  return base64Url(bytes);
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function requireCrypto(cryptoApi) {
  if (!cryptoApi?.getRandomValues || !cryptoApi?.subtle?.digest) {
    throw new Error("Web Crypto with SHA-256 is required");
  }
}
