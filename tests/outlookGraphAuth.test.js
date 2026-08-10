import { webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  OUTLOOK_GRAPH_AUTH_STORAGE_KEY,
  createOutlookGraphAuth
} from "../src/lib/outlookGraphAuth.js";

function chromeFake() {
  const values = {};
  return {
    values,
    chromeApi: {
      identity: {
        getRedirectURL: vi.fn(() => "https://extension-id.chromiumapp.org/outlook"),
        launchWebAuthFlow: vi.fn()
      },
      storage: {
        local: {
          get: vi.fn(async (key) => ({ [key]: values[key] })),
          set: vi.fn(async (items) => Object.assign(values, items)),
          remove: vi.fn(async (key) => delete values[key])
        }
      }
    }
  };
}

const config = {
  outlookClientId: "11111111-2222-4333-8444-555555555555",
  outlookTenantId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
};

describe("Outlook Graph authorization", () => {
  it("uses the China cloud authority, PKCE, and delegated mail scopes", async () => {
    const { chromeApi, values } = chromeFake();
    chromeApi.identity.launchWebAuthFlow.mockImplementation(async ({ url }) => {
      const request = new URL(url);
      expect(request.origin).toBe("https://login.chinacloudapi.cn");
      expect(request.pathname).toContain(config.outlookTenantId);
      expect(request.searchParams.get("scope")).toContain("Mail.Read");
      expect(request.searchParams.get("scope")).toContain("Mail.Read.Shared");
      expect(request.searchParams.get("scope")).toContain("offline_access");
      return `https://extension-id.chromiumapp.org/outlook?code=one-time&state=${request.searchParams.get("state")}`;
    });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        access_token: "graph-access",
        refresh_token: "graph-refresh",
        expires_in: 3600,
        scope: "Mail.Read Mail.Read.Shared offline_access"
      })
    });
    const auth = createOutlookGraphAuth({
      chromeApi,
      fetchImpl,
      cryptoApi: webcrypto,
      now: () => 1_000
    });

    const result = await auth.authorize(config);

    expect(result.status).toBe("authorized");
    expect(values[OUTLOOK_GRAPH_AUTH_STORAGE_KEY]).toMatchObject({
      accessToken: "graph-access",
      refreshToken: "graph-refresh",
      clientId: config.outlookClientId,
      tenantId: config.outlookTenantId
    });
    const tokenRequest = fetchImpl.mock.calls[0];
    expect(String(tokenRequest[0])).toContain("login.chinacloudapi.cn");
    expect(tokenRequest[1].body).toContain("code_verifier=");
    expect(tokenRequest[1].body).not.toContain("client_secret");
  });

  it("refreshes an expired access token without another interactive prompt", async () => {
    const { chromeApi, values } = chromeFake();
    values[OUTLOOK_GRAPH_AUTH_STORAGE_KEY] = {
      accessToken: "expired",
      refreshToken: "refresh-me",
      expiresAt: 1_000,
      clientId: config.outlookClientId,
      tenantId: config.outlookTenantId,
      grantedScopes: ["Mail.Read", "offline_access"]
    };
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        access_token: "fresh-access",
        refresh_token: "fresh-refresh",
        expires_in: 3600,
        scope: "Mail.Read offline_access"
      })
    });
    const auth = createOutlookGraphAuth({
      chromeApi,
      fetchImpl,
      cryptoApi: webcrypto,
      now: () => 2_000
    });

    await expect(auth.getAccessToken(config)).resolves.toBe("fresh-access");
    expect(chromeApi.identity.launchWebAuthFlow).not.toHaveBeenCalled();
    expect(fetchImpl.mock.calls[0][1].body).toContain("grant_type=refresh_token");
  });

  it("rejects invalid tenant and client identifiers before opening authorization", async () => {
    const { chromeApi } = chromeFake();
    const auth = createOutlookGraphAuth({ chromeApi, cryptoApi: webcrypto });

    await expect(auth.authorize({
      outlookClientId: "not-a-client-id",
      outlookTenantId: "../common"
    })).rejects.toMatchObject({ stage: "outlook-graph-config" });
    expect(chromeApi.identity.launchWebAuthFlow).not.toHaveBeenCalled();
  });
});
