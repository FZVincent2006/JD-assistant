import { renderJdDescendants, renderSummaryDescendants } from "../lib/feishuBlockRenderer.js";
import { TEST_FEISHU_DOC_URL } from "../lib/feishuConfig.js";
import { buildFeishuOpenApiPlan, normalizeForMatch } from "../lib/feishuOpenApiPlan.js";
import { verifyJdWrite, verifySummaryWrite } from "../lib/feishuWriteVerifier.js";

export function createFeishuOpenApiWriter({ client, inspect, numberHeading, wait = defaultWait }) {
  if (typeof client?.request !== "function") throw new TypeError("A Feishu API client is required");
  if (typeof inspect !== "function") throw new TypeError("A Feishu inspect function is required");
  if (typeof numberHeading !== "function") throw new TypeError("A Feishu page numberer is required");
  if (typeof wait !== "function") throw new TypeError("A wait function is required");
  let writing = false;

  async function write(draft) {
    if (writing) {
      return makeResult({
        draft,
        status: "failed",
        failedStage: "preflight",
        repairHint: "已有一项飞书写入正在执行，请等待其完成。"
      });
    }
    writing = true;
    try {
      return await executeWrite({ client, inspect, numberHeading, wait, draft });
    } finally {
      writing = false;
    }
  }

  return { write };
}

async function executeWrite({ client, inspect, numberHeading, wait, draft }) {
  let initial;
  try {
    initial = await inspect();
  } catch {
    return makeResult({
      draft,
      status: "failed",
      failedStage: "preflight",
      repairHint: "无法读取测试副本文档，请检查授权和文档访问权限。"
    });
  }

  const plan = buildFeishuOpenApiPlan(initial, draft);
  if (!initial.documentId) plan.errors.push("无法确定测试副本的 Docx 文档 ID。");
  if (plan.errors.length) {
    plan.ok = false;
    return makeResult({
      draft,
      plan,
      status: "failed",
      failedStage: "preflight",
      repairHint: plan.errors.join("；")
    });
  }

  let jdRequest;
  let summaryRequest;
  try {
    jdRequest = renderJdDescendants(draft, plan, initial.templates.jd);
    summaryRequest = renderSummaryDescendants(draft, plan, initial.templates.portfolio);
  } catch {
    return makeResult({
      draft,
      plan,
      status: "failed",
      failedStage: "preflight",
      repairHint: "无法根据文档模板生成安全的飞书块，请重新检查预览内容。"
    });
  }

  const completedStages = [];
  let afterJd;
  let jdApiSucceeded = false;
  try {
    await createDescendants(client, initial.documentId, plan.jdTarget, plan.baseRevisionId, jdRequest, "jd-write");
    jdApiSucceeded = true;
    await wait(400);
    afterJd = await inspect();
  } catch (error) {
    if (jdApiSucceeded) {
      return makeResult({
        draft,
        plan,
        completedStages,
        status: "unknown",
        failedStage: "jd-verify",
        repairHint: "岗位 JD 写入已被 API 接受但无法回读；不要重复提交，请先人工检查测试副本。"
      });
    }
    if (!isAmbiguousNetworkError(error)) {
      return failedForError({ draft, plan, completedStages, stage: "jd-write", error });
    }
    await wait(400);
    try {
      afterJd = await inspect();
    } catch {
      return failedForError({
        draft,
        plan,
        completedStages,
        stage: "jd-write",
        error,
        status: "unknown",
        repairHint: "岗位 JD 写入请求状态未知且无法回读；不要重复提交，请先人工检查测试副本。"
      });
    }
    const timeoutVerification = verifyJdWrite(afterJd, plan, { requireNumbering: false });
    if (!timeoutVerification.ok) {
      return failedForError({
        draft,
        plan,
        completedStages,
        stage: "jd-write",
        error,
        repairHint: `回读未发现完整的岗位 JD 写入：${timeoutVerification.errors.join("；")}`
      });
    }
  }

  const jdContentVerification = verifyJdWrite(afterJd, plan, { requireNumbering: false });
  if (!jdContentVerification.ok) {
    return makeResult({
      draft,
      plan,
      completedStages,
      status: "failed",
      failedStage: "jd-verify",
      repairHint: `岗位 JD 区写入后结构校验失败：${jdContentVerification.errors.join("；")}`
    });
  }

  let numberingAttempted = false;
  if (plan.mode === "new-company" && !hasAutomaticHeadingNumbering(afterJd, plan.companyName)) {
    numberingAttempted = true;
    try {
      await numberHeading(plan.companyName);
    } catch (error) {
      return failedForError({
        draft,
        plan,
        completedStages,
        stage: "jd-numbering-page",
        error,
        status: "partial",
        repairHint: error?.message || "岗位 JD 内容已写入，但飞书页面自动编号失败；已停止 Portfolio 写入。"
      });
    }

    afterJd = await waitForNumberedJd({ inspect, wait, plan, attempts: 5 });
    if (!afterJd) {
      return makeResult({
        draft,
        plan,
        completedStages,
        status: "partial",
        failedStage: "jd-numbering-verify",
        repairHint: "飞书页面已执行编号操作，但 OpenAPI 未在限定时间内确认自动编号；已停止 Portfolio 写入。"
      });
    }
  }

  const jdVerification = verifyJdWrite(afterJd, plan);
  if (!jdVerification.ok) {
    return makeResult({
      draft,
      plan,
      completedStages,
      status: numberingAttempted ? "partial" : "failed",
      failedStage: numberingAttempted ? "jd-numbering-verify" : "jd-verify",
      repairHint: `岗位 JD 区写入后结构校验失败：${jdVerification.errors.join("；")}`
    });
  }
  completedStages.push("jd");

  let afterSummary;
  let summaryApiSucceeded = false;
  try {
    await createDescendants(
      client,
      initial.documentId,
      plan.summaryTarget,
      afterJd.revisionId,
      summaryRequest,
      "summary-write"
    );
    summaryApiSucceeded = true;
    await wait(400);
    afterSummary = await inspect();
  } catch (error) {
    if (summaryApiSucceeded) {
      return makeResult({
        draft,
        plan,
        completedStages,
        status: "unknown",
        failedStage: "summary-verify",
        repairHint: "岗位 JD 已校验完成；Portfolio 写入已被 API 接受但无法回读。不要重复提交，请先人工检查测试副本。"
      });
    }
    if (!isAmbiguousNetworkError(error)) {
      return failedForError({ draft, plan, completedStages, stage: "summary-write", error });
    }
    await wait(400);
    try {
      afterSummary = await inspect();
    } catch {
      return failedForError({
        draft,
        plan,
        completedStages,
        stage: "summary-write",
        error,
        status: "unknown",
        repairHint: "Portfolio 写入请求状态未知且无法回读；不要重复提交，请先人工检查测试副本。"
      });
    }
    const timeoutVerification = verifySummaryWrite(afterSummary, plan);
    if (!timeoutVerification.ok) {
      return failedForError({
        draft,
        plan,
        completedStages,
        stage: "summary-write",
        error,
        repairHint: `岗位 JD 已完成，但回读未发现完整的 Portfolio 写入：${timeoutVerification.errors.join("；")}`
      });
    }
  }

  const summaryVerification = verifySummaryWrite(afterSummary, plan);
  if (!summaryVerification.ok) {
    return makeResult({
      draft,
      plan,
      completedStages,
      status: "partial",
      failedStage: "summary-verify",
      repairHint: `岗位 JD 已完成，但 Portfolio 区写入后结构校验失败：${summaryVerification.errors.join("；")}`
    });
  }
  completedStages.push("summary");
  return makeResult({
    draft,
    plan,
    ok: true,
    status: "success",
    completedStages,
    failedStage: null,
    repairHint: ""
  });
}

async function createDescendants(client, documentId, target, revisionId, request, stage) {
  return client.request(
    `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(target.parentBlockId)}/descendant`,
    {
      method: "POST",
      query: { document_revision_id: revisionId },
      body: { index: target.index, ...request },
      stage
    }
  );
}

async function waitForNumberedJd({ inspect, wait, plan, attempts }) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await wait(400);
    let snapshot;
    try {
      snapshot = await inspect();
    } catch {
      return null;
    }
    if (verifyJdWrite(snapshot, plan).ok) return snapshot;
  }
  return null;
}

function findJdCompany(snapshot, companyName) {
  const normalizedName = normalizeForMatch(companyName);
  return (snapshot.jd?.companies ?? []).find(
    (company) => normalizeForMatch(company.name) === normalizedName
  );
}

function hasAutomaticHeadingNumbering(snapshot, companyName) {
  return findJdCompany(snapshot, companyName)?.headingSequence === "auto";
}

function failedForError({
  draft,
  plan,
  completedStages,
  stage,
  error,
  status = completedStages.length ? "partial" : "failed",
  repairHint
}) {
  const section = stage.startsWith("summary") ? "Portfolio" : "岗位 JD";
  return makeResult({
    draft,
    plan,
    completedStages,
    status,
    failedStage: stage,
    error,
    repairHint: repairHint ?? `${section} 区写入失败；请根据错误码检查权限、版本冲突或调用频率。`
  });
}

function makeResult({
  draft = {},
  plan,
  ok = false,
  status,
  completedStages = [],
  failedStage,
  error,
  repairHint
}) {
  return {
    ok,
    status,
    mode: plan?.mode ?? null,
    completedStages: [...completedStages],
    failedStage,
    documentUrl: TEST_FEISHU_DOC_URL,
    companyName: plan?.companyName ?? String(draft.companyName ?? "").trim(),
    jobTitles: plan?.jobs?.map((job) => job.title) ?? (draft.jobs ?? []).map((job) => job.title),
    errorCode: Number.isFinite(error?.code) ? error.code : 0,
    logId: typeof error?.logId === "string" ? error.logId : "",
    repairHint
  };
}

function isAmbiguousNetworkError(error) {
  return error?.status === 0 && error?.code === 0;
}

function defaultWait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
