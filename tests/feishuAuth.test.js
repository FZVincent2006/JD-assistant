import { describe, expect, it, vi } from "vitest";
import { createFeishuAuth } from "../src/background/feishuAuth.js";

function makeChromeApi({ callbackUrl, stored } = {}) {
  let session = stored;
  return {
    identity: {
      getRedirectURL: vi.fn(() => "https://extension.chromiumapp.org/feishu"),
      launchWebAuthFlow: vi.fn(async () => callbackUrl)
    },
    storage: {
      session: {
        get: vi.fn(async () => ({ feishuAuthSession: session })),
        set: vi.fn(async (value) => { session = value.feishuAuthSession; }),
        remove: vi.fn(async () => { session = undefined; })
      }
    }
  };
}

describe("Feishu auth", () => {
  it("exchanges a code with PKCE and never sends a client secret", async () => {
    const chromeApi = makeChromeApi({
      callbackUrl: "https://extension.chromiumapp.org/feishu?code=auth-code&state=fixed-state"
    });
    const fetchImpl = vi.fn(async (_url, options) => ({
      ok: true,
      headers: new Headers(),
      json: async () => ({
        code: 0,
        access_token: "u-secret-token",
        expires_in: 7200,
        scope: "wiki:wiki:readonly docx:document:readonly docx:document:write_only"
      })
    }));
    const auth = createFeishuAuth({
      chromeApi,
      fetchImpl,
      authMode: "pkce",
      appId: "cli_public",
      cryptoApi: globalThis.crypto,
      stateFactory: () => "fixed-state",
      now: () => 1_000
    });

    await expect(auth.authorize()).resolves.toMatchObject({ status: "authorized", expiresAt: 7_201_000 });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body).toMatchObject({
      grant_type: "authorization_code",
      client_id: "cli_public",
      code: "auth-code",
      redirect_uri: "https://extension.chromiumapp.org/feishu"
    });
    expect(body.code_verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(body).not.toHaveProperty("client_secret");
    expect(chromeApi.storage.session.set).toHaveBeenCalledWith({
      feishuAuthSession: {
        accessToken: "u-secret-token",
        expiresAt: 7_201_000,
        grantedScopes: ["wiki:wiki:readonly", "docx:document:readonly", "docx:document:write_only"]
      }
    });
  });

  it("returns public status without returning the token", async () => {
    const chromeApi = makeChromeApi({
      stored: { accessToken: "u-private", expiresAt: 80_000, grantedScopes: ["wiki:wiki:readonly"] }
    });
    const auth = createFeishuAuth({ chromeApi, fetchImpl: vi.fn(), appId: "cli_public", authMode: "pkce", now: () => 10_000 });

    const status = await auth.status();

    expect(status).toEqual({ status: "authorized", expiresAt: 80_000, grantedScopes: ["wiki:wiki:readonly"] });
    expect(JSON.stringify(status)).not.toContain("u-private");
    await expect(auth.getAccessToken()).resolves.toBe("u-private");
  });

  it("clears an expired session and requires authorization", async () => {
    const chromeApi = makeChromeApi({
      stored: { accessToken: "u-expired", expiresAt: 10_500, grantedScopes: [] }
    });
    const auth = createFeishuAuth({ chromeApi, fetchImpl: vi.fn(), appId: "cli_public", authMode: "pkce", now: () => 10_000 });

    await expect(auth.status()).resolves.toEqual({ status: "expired" });
    expect(chromeApi.storage.session.remove).toHaveBeenCalledWith("feishuAuthSession");
    await expect(auth.getAccessToken()).rejects.toThrow("Feishu authorization required");
  });

  it("normalizes token endpoint errors without including its response body", async () => {
    const chromeApi = makeChromeApi({
      callbackUrl: "https://extension.chromiumapp.org/feishu?code=auth-code&state=fixed-state"
    });
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      headers: new Headers({ "x-tt-logid": "log-1" }),
      json: async () => ({ code: 20002, error: "invalid_client", error_description: "contains-private-body" })
    }));
    const auth = createFeishuAuth({
      chromeApi,
      fetchImpl,
      authMode: "pkce",
      appId: "cli_public",
      stateFactory: () => "fixed-state"
    });

    await expect(auth.authorize()).rejects.toMatchObject({ code: 20002, status: 400, logId: "log-1" });
    await expect(auth.authorize()).rejects.not.toThrow("contains-private-body");
  });
});
