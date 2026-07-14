import { describe, expect, it, vi } from "vitest";
import {
  FEISHU_NATIVE_HOST,
  createFeishuNativeNumbering
} from "../src/background/feishuNativeNumbering.js";

function makeChromeApi({ response, nativeError } = {}) {
  const chromeApi = {
    runtime: {
      lastError: null,
      sendNativeMessage: vi.fn((_host, _message, callback) => {
        chromeApi.runtime.lastError = nativeError ? { message: nativeError } : null;
        callback(response);
        chromeApi.runtime.lastError = null;
      })
    }
  };
  return chromeApi;
}

describe("Feishu native heading numbering", () => {
  it("sends one fixed native request without executable payload", async () => {
    const chromeApi = makeChromeApi({ response: { ok: true } });
    const service = createFeishuNativeNumbering({ chromeApi });

    await expect(service.apply()).resolves.toEqual({ ok: true });
    expect(chromeApi.runtime.sendNativeMessage).toHaveBeenCalledOnce();
    expect(chromeApi.runtime.sendNativeMessage).toHaveBeenCalledWith(
      FEISHU_NATIVE_HOST,
      { type: "APPLY_HEADING_NUMBERING" },
      expect.any(Function)
    );
  });

  it("preserves a known deterministic helper reason", async () => {
    const service = createFeishuNativeNumbering({
      chromeApi: makeChromeApi({
        response: { ok: false, reason: "accessibility-not-granted", message: "safe" }
      })
    });
    await expect(service.apply()).rejects.toMatchObject({
      reason: "accessibility-not-granted",
      ambiguous: false,
      message: "safe"
    });
  });

  it("marks a missing callback response as ambiguous", async () => {
    const service = createFeishuNativeNumbering({
      chromeApi: makeChromeApi({ nativeError: "host exited" })
    });
    await expect(service.apply()).rejects.toMatchObject({
      reason: "native-result-unknown",
      ambiguous: true
    });
  });
});
