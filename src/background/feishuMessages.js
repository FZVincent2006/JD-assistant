import { buildBlockModel } from "../lib/feishuBlockModel.js";
import { buildFeishuOpenApiPlan } from "../lib/feishuOpenApiPlan.js";
import { inspectRecruitingDocument } from "../lib/feishuTemplateReader.js";
import { createFeishuApiClient } from "./feishuApiClient.js";
import { createFeishuAuth } from "./feishuAuth.js";
import { createFeishuOpenApiWriter } from "./feishuOpenApiWriter.js";
import { resolveFixedTestDocument } from "./feishuWikiResolver.js";

const FEISHU_MESSAGE_TYPES = new Set([
  "FEISHU_AUTH_STATUS",
  "FEISHU_AUTHORIZE",
  "FEISHU_INSPECT",
  "FEISHU_PLAN",
  "FEISHU_WRITE",
  "FEISHU_CLEAR_AUTH"
]);

export function createFeishuBackgroundServices({ chromeApi = chrome, fetchImpl = fetch } = {}) {
  const auth = createFeishuAuth({ chromeApi, fetchImpl });
  const client = createFeishuApiClient({ fetchImpl, getAccessToken: auth.getAccessToken });
  const inspect = async () => {
    const document = await resolveFixedTestDocument(client);
    const snapshot = inspectRecruitingDocument(buildBlockModel(document.blocks, document.revisionId));
    return {
      ...snapshot,
      documentId: document.documentId,
      title: document.title
    };
  };
  const writer = createFeishuOpenApiWriter({ client, inspect });
  return { auth, client, inspect, writer };
}

export async function handleFeishuBackgroundMessage(message, services) {
  if (!FEISHU_MESSAGE_TYPES.has(message?.type)) throw new Error("Unsupported Feishu message");
  if (!services?.auth || typeof services.inspect !== "function" || !services.writer) {
    throw new Error("Feishu background services are unavailable");
  }

  switch (message.type) {
    case "FEISHU_AUTH_STATUS":
      return { ok: true, auth: publicAuthStatus(await services.auth.status()) };
    case "FEISHU_AUTHORIZE":
      return { ok: true, auth: publicAuthStatus(await services.auth.authorize()) };
    case "FEISHU_CLEAR_AUTH":
      return { ok: true, auth: publicAuthStatus(await services.auth.clear()) };
    case "FEISHU_INSPECT":
      return { ok: true, inspection: publicInspection(await services.inspect()) };
    case "FEISHU_PLAN": {
      const snapshot = await services.inspect();
      return {
        ok: true,
        inspection: publicInspection(snapshot),
        plan: publicPlan(buildFeishuOpenApiPlan(snapshot, message.payload ?? {}))
      };
    }
    case "FEISHU_WRITE":
      return services.writer.write(message.payload ?? {});
    default:
      throw new Error("Unsupported Feishu message");
  }
}

export function registerFeishuBackgroundMessages(chromeApi, services) {
  chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message?.type?.startsWith("FEISHU_")) return false;
    handleFeishuBackgroundMessage(message, services, { sender })
      .then(sendResponse)
      .catch((error) => sendResponse(toPublicFeishuError(error)));
    return true;
  });
}

export function toPublicFeishuError(error) {
  const stage = typeof error?.stage === "string" ? error.stage : "unknown";
  return {
    ok: false,
    error: publicErrorMessage(stage, error?.message),
    errorCode: Number.isFinite(error?.code) ? error.code : 0,
    status: Number.isFinite(error?.status) ? error.status : 0,
    logId: typeof error?.logId === "string" ? error.logId : "",
    stage
  };
}

function publicErrorMessage(stage, internalMessage) {
  const knownReasons = {
    "Feishu authorization helper is not installed": "Edge 未找到本机授权助手。请完全退出并重新打开 Edge；若仍失败，请重新运行安装助手。",
    "Feishu authorization helper failed": "Edge 启动本机授权助手失败，请完全退出并重新打开 Edge 后重试。",
    "Feishu App Secret is not configured": "本机授权助手尚未配置飞书 App Secret，请重新运行安装助手。",
    "Feishu token exchange was rejected": "飞书拒绝了授权令牌交换，请根据错误码检查 App Secret 与回调地址。",
    "Feishu token response is incomplete": "飞书授权响应不完整，请根据错误码与 Log ID 检查应用配置。",
    "OAuth state mismatch": "飞书授权回调校验失败，请关闭授权窗口后重新授权。",
    "Feishu authorization was cancelled": "飞书授权已取消，请重新点击“授权飞书”并完成确认。"
  };
  if (knownReasons[internalMessage]) return knownReasons[internalMessage];
  const messages = {
    "authorization-required": "尚未完成飞书授权，请先点击“授权飞书”。",
    "oauth-launch": "未能打开飞书授权窗口，请检查浏览器身份授权设置。",
    "oauth-callback": "飞书授权回调无效或已取消，请重新授权。",
    "native-exchange": "飞书授权交换失败，请检查本机授权助手与飞书应用凭证。",
    "auth-store": "飞书授权已完成，但临时授权状态保存失败。",
    "wiki-resolve": "无法读取飞书知识库节点，请检查应用权限与文档访问权限。",
    "document-metadata": "无法读取飞书文档信息，请检查应用权限与文档状态。",
    "document-blocks-read": "无法读取飞书文档内容，请检查应用权限与文档状态。"
  };
  return messages[stage] ?? "飞书操作失败，请根据错误码检查授权、权限或文档状态。";
}

function publicAuthStatus(value = {}) {
  return {
    status: ["authorized", "unauthorized", "expired"].includes(value.status)
      ? value.status
      : "unauthorized",
    ...(Number.isFinite(value.expiresAt) ? { expiresAt: value.expiresAt } : {}),
    ...(Array.isArray(value.grantedScopes) ? { grantedScopes: [...value.grantedScopes] } : {})
  };
}

function publicInspection(snapshot) {
  return {
    revisionId: snapshot.revisionId,
    title: snapshot.title,
    portfolioCompanies: [...(snapshot.companies?.portfolio ?? [])],
    jdCompanies: [...(snapshot.companies?.jd ?? [])],
    portfolioCompanyCount: snapshot.portfolio?.companies?.length ?? 0,
    jdCompanyCount: snapshot.jd?.companies?.length ?? 0
  };
}

function publicPlan(plan) {
  return {
    ok: plan.ok,
    mode: plan.mode,
    baseRevisionId: plan.baseRevisionId,
    companyName: plan.companyName,
    jobs: plan.jobs.map((job) => ({
      title: job.title,
      location: job.location,
      employment: job.employment,
      ordinal: job.ordinal
    })),
    expected: structuredClone(plan.expected),
    errors: [...plan.errors]
  };
}
