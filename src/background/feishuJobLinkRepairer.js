import { buildJobLinkRepairPlan } from "../lib/feishuJobLinks.js";

export function createFeishuJobLinkRepairer({ client, inspect, wait = defaultWait }) {
  if (typeof client?.request !== "function") throw new TypeError("A Feishu API client is required");
  if (typeof inspect !== "function") throw new TypeError("A Feishu inspect function is required");
  if (typeof wait !== "function") throw new TypeError("A wait function is required");
  let writing = false;

  async function plan() {
    return buildJobLinkRepairPlan(await inspect());
  }

  async function write(preview = {}) {
    if (writing) {
      return makeResult({
        status: "failed",
        failedStage: "job-link-preflight",
        repairHint: "已有一项岗位链接补全正在执行，请等待其完成。"
      });
    }
    writing = true;
    try {
      return await executeWrite({ client, inspect, wait, preview });
    } finally {
      writing = false;
    }
  }

  return { plan, write };
}

async function executeWrite({ client, inspect, wait, preview }) {
  let initial;
  try {
    initial = await inspect();
  } catch {
    return makeResult({
      status: "failed",
      failedStage: "job-link-preflight",
      repairHint: "无法读取正式招聘文档，请检查授权和文档访问权限。"
    });
  }

  const plan = buildJobLinkRepairPlan(initial);
  if (preview.baseRevisionId !== plan.baseRevisionId) {
    return makeResult({
      plan,
      status: "failed",
      failedStage: "job-link-preflight",
      repairHint: "正式招聘文档版本已变化，请重新检查岗位链接后再确认。"
    });
  }
  if (!plan.ok) {
    return makeResult({
      plan,
      status: "failed",
      failedStage: "job-link-preflight",
      repairHint: plan.errors.join("；")
    });
  }
  const selection = selectUpdates(plan, preview.companyNames);
  if (!selection.ok) {
    return makeResult({
      plan,
      status: "failed",
      failedStage: "job-link-preflight",
      repairHint: "所选公司已不在当前补链计划中，请重新检查岗位链接后再确认。"
    });
  }
  if (!initial.documentId) {
    return makeResult({
      plan,
      status: "failed",
      failedStage: "job-link-preflight",
      repairHint: "无法确定正式招聘文档的 Docx 文档 ID。"
    });
  }
  if (!selection.updates.length) {
    return makeResult({
      plan,
      ok: true,
      status: "success",
      failedStage: null,
      updatedLinks: 0
    });
  }

  let apiSucceeded = false;
  let requestError;
  try {
    await client.request(
      `/open-apis/docx/v1/documents/${encodeURIComponent(initial.documentId)}/blocks/batch_update`,
      {
        method: "PATCH",
        query: { document_revision_id: plan.baseRevisionId },
        body: {
          requests: selection.updates.map(({ blockId, elements }) => ({
            block_id: blockId,
            update_text_elements: { elements }
          }))
        },
        stage: "job-link-write"
      }
    );
    apiSucceeded = true;
  } catch (error) {
    requestError = error;
    if (!isAmbiguousNetworkError(error)) {
      return makeResult({
        plan,
        status: "failed",
        failedStage: "job-link-write",
        error,
        repairHint: "岗位链接补全被飞书拒绝；请根据错误码检查权限、版本冲突或调用频率。"
      });
    }
  }

  await wait(400);
  let after;
  try {
    after = await inspect();
  } catch {
    return makeResult({
      plan,
      status: "unknown",
      failedStage: "job-link-verify",
      error: requestError,
      repairHint: apiSucceeded
        ? "岗位链接更新已被 API 接受但无法回读；不要重复提交，请先人工检查正式招聘文档。"
        : "岗位链接更新请求状态未知且无法回读；不要重复提交，请先人工检查正式招聘文档。"
    });
  }

  const verification = buildJobLinkRepairPlan(after);
  const remaining = selectUpdates(verification, selection.companyNames, { requireAvailable: false });
  if (!verification.ok
    || !remaining.ok
    || remaining.updates.length
    || verification.totalJobs !== plan.totalJobs) {
    return makeResult({
      plan,
      status: "failed",
      failedStage: "job-link-verify",
      error: requestError,
      repairHint: "岗位链接写入后校验未通过；请人工检查计划中的 Portfolio 岗位。"
    });
  }

  return makeResult({
    plan,
    ok: true,
    status: "success",
    failedStage: null,
    updatedLinks: selection.updates.length
  });
}

function selectUpdates(plan, requestedCompanyNames, { requireAvailable = true } = {}) {
  if (requestedCompanyNames === undefined) {
    return {
      ok: true,
      companyNames: [...new Set((plan.updates ?? []).map((update) => update.companyName))],
      updates: [...(plan.updates ?? [])]
    };
  }
  if (!Array.isArray(requestedCompanyNames)
    || requestedCompanyNames.length < 1
    || requestedCompanyNames.length > 50) {
    return { ok: false, companyNames: [], updates: [] };
  }
  const companyNames = [...new Set(requestedCompanyNames.map((value) => String(value ?? "").trim()))];
  if (companyNames.length !== requestedCompanyNames.length
    || companyNames.some((value) => !value || value.length > 80)) {
    return { ok: false, companyNames: [], updates: [] };
  }
  const available = new Set((plan.updates ?? []).map((update) => update.companyName));
  if (requireAvailable && companyNames.some((name) => !available.has(name))) {
    return { ok: false, companyNames: [], updates: [] };
  }
  const selected = new Set(companyNames);
  return {
    ok: true,
    companyNames,
    updates: (plan.updates ?? []).filter((update) => selected.has(update.companyName))
  };
}

function makeResult({
  plan = {},
  ok = false,
  status,
  failedStage,
  updatedLinks = 0,
  error,
  repairHint = ""
}) {
  return {
    ok,
    status,
    failedStage,
    baseRevisionId: plan.baseRevisionId,
    totalJobs: Number.isInteger(plan.totalJobs) ? plan.totalJobs : 0,
    updatedLinks,
    errorCode: Number.isFinite(error?.code) ? error.code : 0,
    httpStatus: Number.isFinite(error?.status) ? error.status : 0,
    logId: typeof error?.logId === "string" ? error.logId : "",
    repairHint
  };
}

function isAmbiguousNetworkError(error) {
  return error?.status === 0 && error?.code === 0;
}

function defaultWait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
