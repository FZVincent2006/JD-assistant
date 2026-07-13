import { describe, expect, it, vi } from "vitest";
import { createFeishuAuth } from "../src/background/feishuAuth.js";
import {
  FEISHU_NATIVE_HOST,
  createFeishuNativeAuth
} from "../src/background/feishuNativeAuth.js";

function makeChromeApi({ callbackUrl, nativeResponse, nativeError } = {}) {
  let session;
  const chromeApi = {
    identity: {
      getRedirectURL: vi.fn(() => "https://extensionid.chromiumapp.org/feishu"),
      launchWebAuthFlow: vi.fn(async () => callbackUrl)
    },
    runtime: {
      lastError: null,
      sendNativeMessage: vi.fn((_host, _message, callback) => {
        chromeApi.runtime.lastError = nativeError ? { message: nativeError } : null;
        callback(nativeResponse);
        chromeApi.runtime.lastError = null;
      })
    },
    storage: {
      session: {
        get: vi.fn(async () => ({ feishuAuthSession: session })),
        set: vi.fn(async (value) => { session = value.feishuAuthSession; }),
        remove: vi.fn(async () => { session = undefined; })
      }
    }
  };
  return chromeApi;
}

describe("Feishu native authorization", () => {
  it("sends only OAuth exchange fields to the one-shot native host", async () => {
    const chromeApi = makeChromeApi({
      callbackUrl: "https://extensionid.chromiumapp.org/feishu?code=auth-code&state=fixed-state",
      nativeResponse: {
        ok: true,
        accessToken: "short-lived-token",
        expiresIn: 7200,
        scope: "wiki:wiki:readonly docx:document:readonly docx:document:write_only"
      }
    });
    const auth = createFeishuNativeAuth({
      chromeApi,
      appId: "cli_public1234",
      stateFactory: () => "fixed-state",
      now: () => 1_000
    });

    await expect(auth.authorize()).resolves.toMatchObject({ status: "authorized", expiresAt: 7_201_000 });
    expect(chromeApi.runtime.sendNativeMessage).toHaveBeenCalledTimes(1);
    const [host, message] = chromeApi.runtime.sendNativeMessage.mock.calls[0];
    expect(host).toBe(FEISHU_NATIVE_HOST);
    expect(message).toEqual({
      type: "EXCHANGE_CODE",
      appId: "cli_public1234",
      code: "auth-code",
      redirectUri: "https://extensionid.chromiumapp.org/feishu",
      codeVerifier: expect.stringMatching(/^[A-Za-z0-9_-]{43,128}$/)
    });
    expect(JSON.stringify(message)).not.toMatch(/secret|公司介绍|岗位/i);
    expect(chromeApi.storage.session.set).toHaveBeenCalledWith({
      feishuAuthSession: {
        accessToken: "short-lived-token",
        expiresAt: 7_201_000,
        grantedScopes: ["wiki:wiki:readonly", "docx:document:readonly", "docx:document:write_only"]
      }
    });
  });

  it("maps a missing native host to an installation instruction", async () => {
    const chromeApi = makeChromeApi({
      callbackUrl: "https://extensionid.chromiumapp.org/feishu?code=auth-code&state=fixed-state",
      nativeError: "Specified native messaging host not found."
    });
    const auth = createFeishuNativeAuth({
      chromeApi,
      appId: "cli_public1234",
      stateFactory: () => "fixed-state"
    });

    await expect(auth.authorize()).rejects.toThrow("authorization helper is not installed");
  });

  it("rejects a malformed helper response without storing it", async () => {
    const chromeApi = makeChromeApi({
      callbackUrl: "https://extensionid.chromiumapp.org/feishu?code=auth-code&state=fixed-state",
      nativeResponse: { ok: true, accessToken: "", expiresIn: 0 }
    });
    const auth = createFeishuNativeAuth({
      chromeApi,
      appId: "cli_public1234",
      stateFactory: () => "fixed-state"
    });

    await expect(auth.authorize()).rejects.toThrow("incomplete");
    expect(chromeApi.storage.session.set).not.toHaveBeenCalled();
  });

  it("stops before native messaging when OAuth state mismatches", async () => {
    const chromeApi = makeChromeApi({
      callbackUrl: "https://extensionid.chromiumapp.org/feishu?code=auth-code&state=wrong"
    });
    const auth = createFeishuNativeAuth({
      chromeApi,
      appId: "cli_public1234",
      stateFactory: () => "fixed-state"
    });

    await expect(auth.authorize()).rejects.toThrow("OAuth state mismatch");
    expect(chromeApi.runtime.sendNativeMessage).not.toHaveBeenCalled();
  });

  it("selects the native adapter through the existing auth factory", async () => {
    const chromeApi = makeChromeApi();
    const auth = createFeishuAuth({ chromeApi, appId: "cli_public1234", authMode: "native" });

    await expect(auth.status()).resolves.toEqual({ status: "unauthorized" });
    expect(chromeApi.runtime.sendNativeMessage).not.toHaveBeenCalled();
  });
});
