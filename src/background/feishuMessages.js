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
    let model;
    try {
      model = buildBlockModel(document.blocks, document.revisionId);
    } catch (error) {
      throw wrapFeishuInspectionFailure(error, "block-model");
    }
    let snapshot;
    try {
      snapshot = inspectRecruitingDocument(model);
    } catch (error) {
      throw wrapFeishuInspectionFailure(error, "template-inspection");
    }
    return {
      ...snapshot,
      documentId: document.documentId,
      title: document.title
    };
  };
  const writer = createFeishuOpenApiWriter({
    client,
    inspect
  });
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
    error: publicErrorMessage(stage, error?.message, error?.reasonCode, error),
    errorCode: Number.isFinite(error?.code) ? error.code : 0,
    status: Number.isFinite(error?.status) ? error.status : 0,
    logId: typeof error?.logId === "string" ? error.logId : "",
    stage
  };
}

function publicErrorMessage(stage, internalMessage, reasonCode, context = {}) {
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
  const inspectionReasons = {
    "block-list-empty": "飞书返回的文档块列表为空。文档不会被修改。",
    "page-root-invalid": "飞书文档根块结构异常。文档不会被修改。",
    "block-tree-invalid": "飞书返回的文档块树不完整或不一致。文档不会被修改。",
    "portfolio-heading-count": "未能唯一识别“Portfolio开放岗位汇总”标题。文档不会被修改。",
    "jd-heading-count": "未能唯一识别“岗位JD整理”标题。文档不会被修改。",
    "target-layout": "两个目标标题不是预期的根级顺序。文档不会被修改。",
    "portfolio-callout": "Portfolio 区未能唯一识别岗位汇总高亮块。文档不会被修改。",
    "portfolio-template": "Portfolio 区至少有一个公司块不符合固定模板。文档不会被修改。",
    "jd-template": "岗位 JD 区至少有一个公司块不符合固定模板。文档不会被修改。",
    "style-template": "测试副本缺少生成新内容所需的样式模板。文档不会被修改。",
    "template-unknown": "无法识别测试副本的招聘模板结构。文档不会被修改。"
  };
  if (inspectionReasons[reasonCode]) return inspectionReasons[reasonCode];
  const companyName = safePublicLabel(context.companyName, "未知公司");
  const jobTitle = safePublicLabel(context.jobTitle, "未知岗位");
  const jdReasons = {
    "jd-intro-heading": `公司“${companyName}”的“公司介绍”二级标题位置不符合模板。文档不会被修改。`,
    "jd-intro-callout": `公司“${companyName}”的公司介绍下未找到高亮块。文档不会被修改。`,
    "jd-open-heading": `公司“${companyName}”的“开放岗位”未识别为唯一的 Heading 1/2 分区标题。文档不会被修改。`,
    "jd-intro-bullet": `公司“${companyName}”的介绍高亮块中未找到项目符号内容。文档不会被修改。`,
    "jd-job-quote": `公司“${companyName}”的岗位“${jobTitle}”标题后未找到有效引用块。文档不会被修改。`,
    "jd-jobs-empty": `公司“${companyName}”下未识别到有效岗位标题。文档不会被修改。`
  };
  if (jdReasons[reasonCode]) return jdReasons[reasonCode];
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

export function classifyFeishuInspectionFailure(error, stage) {
  const message = String(error?.message ?? "");
  if (stage === "block-model") {
    if (message === "Feishu block list is empty") return "block-list-empty";
    if (message === "Feishu document must contain exactly one Page block") return "page-root-invalid";
    if (/block (?:is missing an ID|has a missing child|tree contains|appears more than once|parent mismatch)|Duplicate Feishu block ID/.test(message)) {
      return "block-tree-invalid";
    }
    return "block-tree-invalid";
  }
  if (message.includes("Portfolio开放岗位汇总") && message.includes("must appear exactly once")) {
    return "portfolio-heading-count";
  }
  if (message.includes("岗位JD整理") && message.includes("must appear exactly once")) {
    return "jd-heading-count";
  }
  if (/Target headings must be root-level siblings|Portfolio section must precede the JD section/.test(message)) {
    return "target-layout";
  }
  if (message === "Portfolio section must contain exactly one Callout") return "portfolio-callout";
  if (/Portfolio company template is incomplete|No complete Portfolio company template was found/.test(message)) {
    return "portfolio-template";
  }
  if (message === "No complete JD company template was found") return "jd-template";
  if (/required Feishu style template|Unsupported Feishu template block type/.test(message)) {
    return "style-template";
  }
  return "template-unknown";
}

function wrapFeishuInspectionFailure(error, stage) {
  const wrapped = new Error("Feishu document structure inspection failed");
  wrapped.stage = stage;
  wrapped.reasonCode = typeof error?.reasonCode === "string"
    ? error.reasonCode
    : classifyFeishuInspectionFailure(error, stage);
  if (typeof error?.companyName === "string") wrapped.companyName = safePublicLabel(error.companyName);
  if (typeof error?.jobTitle === "string") wrapped.jobTitle = safePublicLabel(error.jobTitle);
  return wrapped;
}

function safePublicLabel(value, fallback = "") {
  const safe = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return safe || fallback;
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
