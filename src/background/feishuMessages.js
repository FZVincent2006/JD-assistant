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
  return {
    ok: false,
    error: "飞书操作失败，请根据错误码检查授权、权限或文档状态。",
    errorCode: Number.isFinite(error?.code) ? error.code : 0,
    status: Number.isFinite(error?.status) ? error.status : 0,
    logId: typeof error?.logId === "string" ? error.logId : "",
    stage: typeof error?.stage === "string" ? error.stage : "unknown"
  };
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
