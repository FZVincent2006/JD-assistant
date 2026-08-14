import { describe, expect, it, vi } from "vitest";
import { createFeishuTenantAuth } from "../src/background/feishuTenantAuth.js";

function chromeFake() {
  const values = {};
  return {
    values,
    chromeApi: {
      runtime: {
        lastError: null,
        sendNativeMessage: vi.fn((_host, message, callback) => callback({
          ok: true,
          accessToken: "tenant-token",
          expiresIn: 7200,
          scope: ""
        }))
      },
      storage: {
        session: {
          get: vi.fn(async (key) => ({ [key]: values[key] })),
          set: vi.fn(async (items) => Object.assign(values, items)),
          remove: vi.fn(async (key) => delete values[key])
        }
      }
    }
  };
}

describe("Feishu tenant authorization", () => {
  it("gets an app token through the Keychain-backed native helper and caches it", async () => {
    const { chromeApi } = chromeFake();
    const auth = createFeishuTenantAuth({ chromeApi, now: () => 1_000 });

    await expect(auth.getAccessToken()).resolves.toBe("tenant-token");
    await expect(auth.getAccessToken()).resolves.toBe("tenant-token");

    expect(chromeApi.runtime.sendNativeMessage).toHaveBeenCalledTimes(1);
    expect(chromeApi.runtime.sendNativeMessage).toHaveBeenCalledWith(
      "cn.zhenfund.jd_assistant.feishu_auth",
      expect.objectContaining({ type: "GET_TENANT_TOKEN" }),
      expect.any(Function)
    );
  });

  it("returns a redacted error when the native helper cannot provide a token", async () => {
    const { chromeApi } = chromeFake();
    chromeApi.runtime.sendNativeMessage.mockImplementation((_host, _message, callback) => {
      callback({ ok: false, message: "Feishu App Secret is not configured", errorCode: 0 });
    });
    const auth = createFeishuTenantAuth({ chromeApi });

    await expect(auth.getAccessToken()).rejects.toMatchObject({
      stage: "feishu-tenant-token"
    });
  });

  it("does not reuse a cached token from a different Feishu app", async () => {
    const { chromeApi, values } = chromeFake();
    values.feishuTenantAuthSessionV1 = {
      appId: "cli_oldapp1234",
      accessToken: "old-token",
      expiresAt: 7_201_000
    };
    const auth = createFeishuTenantAuth({
      chromeApi,
      appId: "cli_aaf06e1e3c385d1c",
      now: () => 1_000
    });

    await expect(auth.getAccessToken()).resolves.toBe("tenant-token");
    expect(chromeApi.runtime.sendNativeMessage).toHaveBeenCalledTimes(1);
    expect(values.feishuTenantAuthSessionV1.appId).toBe("cli_aaf06e1e3c385d1c");
  });
});
