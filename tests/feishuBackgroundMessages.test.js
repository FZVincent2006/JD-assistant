import { describe, expect, it, vi } from "vitest";
import {
  classifyFeishuInspectionFailure,
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

  it("gives safe stage-specific guidance without forwarding private error text", () => {
    const nativeFailure = Object.assign(new Error("private native detail"), {
      code: 20002,
      logId: "safe-log-id",
      stage: "native-exchange"
    });

    expect(toPublicFeishuError(nativeFailure)).toEqual({
      ok: false,
      error: "飞书授权交换失败，请检查本机授权助手与飞书应用凭证。",
      errorCode: 20002,
      status: 0,
      logId: "safe-log-id",
      stage: "native-exchange"
    });
    expect(JSON.stringify(toPublicFeishuError(nativeFailure))).not.toContain("private native detail");

    expect(toPublicFeishuError(Object.assign(new Error("private token"), {
      stage: "authorization-required"
    })).error).toBe("尚未完成飞书授权，请先点击“授权飞书”。");
  });

  it("translates only whitelisted native authorization reasons", () => {
    expect(toPublicFeishuError(Object.assign(
      new Error("Feishu authorization helper is not installed"),
      { stage: "native-exchange" }
    )).error).toContain("Edge 未找到本机授权助手");

    expect(toPublicFeishuError(Object.assign(
      new Error("Feishu token exchange was rejected"),
      { stage: "native-exchange", code: 20002 }
    )).error).toContain("飞书拒绝了授权令牌交换");

    expect(toPublicFeishuError(Object.assign(
      new Error("untrusted helper output containing a secret"),
      { stage: "native-exchange" }
    )).error).toBe("飞书授权交换失败，请检查本机授权助手与飞书应用凭证。");
  });

  it("classifies document inspection failures without exposing document content", () => {
    expect(classifyFeishuInspectionFailure(
      new Error("Feishu block tree contains orphan blocks"),
      "block-model"
    )).toBe("block-tree-invalid");
    expect(classifyFeishuInspectionFailure(
      new Error("“岗位JD整理” must appear exactly once"),
      "template-inspection"
    )).toBe("jd-heading-count");
    expect(classifyFeishuInspectionFailure(
      new Error("Portfolio section must contain exactly one Callout"),
      "template-inspection"
    )).toBe("portfolio-callout");
    expect(classifyFeishuInspectionFailure(
      new Error("No complete JD company template was found"),
      "template-inspection"
    )).toBe("jd-template");
    expect(classifyFeishuInspectionFailure(
      new Error("private document text"),
      "template-inspection"
    )).toBe("template-unknown");
  });

  it("returns safe structural guidance for classified inspection failures", () => {
    const response = toPublicFeishuError(Object.assign(new Error("private document text"), {
      stage: "template-inspection",
      reasonCode: "jd-template"
    }));

    expect(response.error).toBe("岗位 JD 区至少有一个公司块不符合固定模板。文档不会被修改。");
    expect(response.stage).toBe("template-inspection");
    expect(JSON.stringify(response)).not.toContain("private document text");
  });

  it("reports a safe company and job when a JD quote relationship is invalid", () => {
    const response = toPublicFeishuError(Object.assign(new Error("private block detail"), {
      stage: "template-inspection",
      reasonCode: "jd-job-quote",
      companyName: "3. 示例公司",
      jobTitle: "机械工程师"
    }));

    expect(response.error).toBe("公司“3. 示例公司”的岗位“机械工程师”标题后未找到有效引用块。文档不会被修改。");
    expect(JSON.stringify(response)).not.toContain("private block detail");
  });
});
