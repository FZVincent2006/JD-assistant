import { describe, expect, it, vi } from "vitest";
import {
  handleFeishuBackgroundMessage,
  registerFeishuBackgroundMessages,
  toPublicFeishuError
} from "../src/background/feishuMessages.js";
import { initialSnapshot } from "./helpers/feishuWriteScenario.js";

function services(overrides = {}) {
  const snapshot = initialSnapshot();
  Object.assign(snapshot, {
    documentId: "private-document-id",
    title: "测试副本",
    blocks: [{ block_id: "must-not-leak" }]
  });
  return {
    auth: {
      status: vi.fn().mockResolvedValue({ status: "authorized", expiresAt: 123, grantedScopes: ["docx"] }),
      authorize: vi.fn().mockResolvedValue({ status: "authorized", expiresAt: 456, grantedScopes: ["docx"] }),
      clear: vi.fn().mockResolvedValue({ status: "unauthorized" })
    },
    inspect: vi.fn().mockResolvedValue(snapshot),
    writer: { write: vi.fn().mockResolvedValue({ ok: true, status: "success", completedStages: ["jd", "summary"] }) },
    ...overrides
  };
}

describe("Feishu service-worker messages", () => {
  it("routes auth lifecycle messages without returning an access token", async () => {
    const current = services();

    await expect(handleFeishuBackgroundMessage({ type: "FEISHU_AUTH_STATUS" }, current))
      .resolves.toMatchObject({ ok: true, auth: { status: "authorized", expiresAt: 123 } });
    await expect(handleFeishuBackgroundMessage({ type: "FEISHU_AUTHORIZE" }, current))
      .resolves.toMatchObject({ ok: true, auth: { status: "authorized", expiresAt: 456 } });
    await expect(handleFeishuBackgroundMessage({ type: "FEISHU_CLEAR_AUTH" }, current))
      .resolves.toEqual({ ok: true, auth: { status: "unauthorized" } });
    expect(JSON.stringify(await handleFeishuBackgroundMessage({ type: "FEISHU_AUTH_STATUS" }, current)))
      .not.toContain("accessToken");
  });

  it("returns a public inspection without raw blocks, document IDs, templates, or target block IDs", async () => {
    const response = await handleFeishuBackgroundMessage({ type: "FEISHU_INSPECT" }, services());
    const serialized = JSON.stringify(response);

    expect(response).toMatchObject({
      ok: true,
      inspection: {
        revisionId: 7,
        title: "测试副本",
        portfolioCompanies: ["示例公司甲", "示例公司乙"],
        jdCompanies: ["示例公司甲", "示例公司乙"]
      }
    });
    expect(serialized).not.toContain("private-document-id");
    expect(serialized).not.toContain("must-not-leak");
    expect(serialized).not.toContain("templates");
    expect(serialized).not.toContain("BlockId");
  });

  it("builds a public plan internally and delegates writes without exposing mutation targets", async () => {
    const current = services();
    const draft = {
      companyName: "新公司",
      website: "",
      companyIntro: ["介绍。"],
      jobs: [{
        title: "新岗位",
        location: "上海",
        employment: "社招",
        responsibilities: ["工作。"],
        requirements: ["要求。"],
        bonuses: []
      }]
    };

    const planned = await handleFeishuBackgroundMessage({ type: "FEISHU_PLAN", payload: draft }, current);
    const written = await handleFeishuBackgroundMessage({ type: "FEISHU_WRITE", payload: draft }, current);

    expect(planned).toMatchObject({
      ok: true,
      plan: { mode: "new-company", companyName: "新公司", jobs: [{ title: "新岗位", ordinal: 1 }] },
      inspection: { revisionId: 7, title: "测试副本" }
    });
    expect(planned.plan).not.toHaveProperty("jdTarget");
    expect(planned.plan).not.toHaveProperty("summaryTarget");
    expect(current.writer.write).toHaveBeenCalledWith(draft);
    expect(written).toMatchObject({ ok: true, status: "success" });
  });

  it("registers one async listener only for FEISHU messages and sanitizes failures", async () => {
    let listener;
    const chromeApi = { runtime: { onMessage: { addListener: vi.fn((value) => { listener = value; }) } } };
    const current = services({ inspect: vi.fn().mockRejectedValue(Object.assign(new Error("private body"), {
      code: 999,
      status: 403,
      logId: "safe-log",
      stage: "inspect"
    })) });
    registerFeishuBackgroundMessages(chromeApi, current);

    expect(listener({ type: "RECRUITING_ASSISTANT_FILL" }, {}, vi.fn())).toBe(false);
    const sendResponse = vi.fn();
    expect(listener({ type: "FEISHU_INSPECT" }, {}, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      error: "飞书操作失败，请根据错误码检查授权、权限或文档状态。",
      errorCode: 999,
      status: 403,
      logId: "safe-log",
      stage: "inspect"
    });
    expect(JSON.stringify(sendResponse.mock.calls)).not.toContain("private body");
  });

  it("sanitizes arbitrary errors without forwarding their messages", () => {
    expect(toPublicFeishuError(new Error("secret detail"))).toEqual({
      ok: false,
      error: "飞书操作失败，请根据错误码检查授权、权限或文档状态。",
      errorCode: 0,
      status: 0,
      logId: "",
      stage: "unknown"
    });
  });
});
