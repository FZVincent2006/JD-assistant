import { describe, expect, it, vi } from "vitest";
import {
  FeishuApiError,
  createFeishuApiClient
} from "../src/background/feishuApiClient.js";

function jsonResponse(payload, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

describe("Feishu OpenAPI client", () => {
  it("paginates all document blocks in API order", async () => {
    const getAccessToken = vi.fn(async () => "u-token");
    const fetchImpl = vi.fn(async (url, options) => {
      const parsed = new URL(url);
      expect(options.headers.Authorization).toBe("Bearer u-token");
      if (!parsed.searchParams.has("page_token")) {
        return jsonResponse({
          code: 0,
          data: { items: [{ block_id: "a" }], has_more: true, page_token: "page-2" }
        });
      }
      expect(parsed.searchParams.get("page_token")).toBe("page-2");
      return jsonResponse({
        code: 0,
        data: { items: [{ block_id: "b" }], has_more: false }
      });
    });
    const client = createFeishuApiClient({ fetchImpl, getAccessToken });

    await expect(client.listAllBlocks("doc-1")).resolves.toEqual([
      { block_id: "a" },
      { block_id: "b" }
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(getAccessToken).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[0][0])).toContain("/open-apis/docx/v1/documents/doc-1/blocks");
  });

  it.each([
    [401, 99991663, "unauthorized"],
    [403, 99991672, "forbidden"],
    [429, 99991400, "rate-limited"],
    [500, 0, "server-error"]
  ])("normalizes HTTP %i without exposing the response body", async (status, code, stage) => {
    const fetchImpl = vi.fn(async () => jsonResponse(
      { code, msg: "private-response-body" },
      { status, headers: { "x-tt-logid": "log-safe" } }
    ));
    const client = createFeishuApiClient({ fetchImpl, getAccessToken: async () => "u-token" });

    let error;
    try {
      await client.request("/open-apis/test", { stage });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(FeishuApiError);
    expect(error).toMatchObject({ status, code, logId: "log-safe", stage });
    expect(error.message).not.toContain("private-response-body");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("normalizes a network failure and never retries it", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("network-private-detail"); });
    const client = createFeishuApiClient({ fetchImpl, getAccessToken: async () => "u-token" });

    await expect(client.request("/open-apis/test", { stage: "inspect" }))
      .rejects.toMatchObject({ status: 0, code: 0, logId: "", stage: "inspect" });
    await expect(client.request("/open-apis/test", { stage: "inspect" }))
      .rejects.not.toThrow("network-private-detail");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("serializes JSON request bodies without adding undefined query values", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ code: 0, data: { ok: true } }));
    const client = createFeishuApiClient({ fetchImpl, getAccessToken: async () => "u-token" });

    await client.request("/open-apis/test", {
      method: "POST",
      query: { revision: 7, absent: undefined },
      body: { value: "safe" },
      stage: "write"
    });

    const [url, options] = fetchImpl.mock.calls[0];
    expect(new URL(url).search).toBe("?revision=7");
    expect(options.body).toBe('{"value":"safe"}');
    expect(options.headers["Content-Type"]).toBe("application/json; charset=utf-8");
  });
});
