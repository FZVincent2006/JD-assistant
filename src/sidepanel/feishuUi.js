export function updateJobDraftField(draft, index, field, value) {
  return {
    ...draft,
    jobs: draft.jobs.map((job, jobIndex) => jobIndex === index ? { ...job, [field]: value } : job)
  };
}

export function formatFeishuWriteStatus(result) {
  const diagnostics = formatWriteDiagnostics(result);
  if (result?.ok || result?.status === "success") {
    if (result.mode === "resume-new-company") {
      return `恢复成功：未重复写入 JD，已完成 Portfolio 汇总。${diagnostics}`;
    }
    const action = result.mode === "append-jobs" ? "新岗位已追加" : "新公司已更新";
    return `写入成功：${action} JD 区和岗位汇总区。${diagnostics}`;
  }
  const detail = result?.repairHint || result?.error || "请检查正式招聘文档。";
  const jdConfirmed = (result?.completedStages ?? []).includes("jd");
  if (result?.status === "partial" || jdConfirmed) {
    const prefix = jdConfirmed
      ? "部分完成：岗位 JD 区已确认写入；Portfolio 区未完成。"
      : "部分完成：岗位 JD 内容已写入但尚未确认完成；Portfolio 区未写入。";
    return `${prefix}${detail}${diagnostics}`;
  }
  if (result?.status === "unknown") {
    return `结果未知（${phaseLabel(result.failedStage)}）：${detail}${diagnostics}`;
  }
  return `写入失败（${phaseLabel(result?.failedStage)}）：${detail}${diagnostics}`;
}

export function shouldOfferFeishuDocumentCheck(result) {
  return result?.status === "partial"
    || result?.status === "unknown"
    || result?.failedStage === "jd-verify"
    || result?.failedStage === "summary-verify";
}

function formatWriteDiagnostics(result = {}) {
  const diagnostics = [];
  const stage = phaseLabel(result.failedStage);
  if (result.failedStage && stage !== "飞书操作") diagnostics.push(stage);
  if (Number.isFinite(result.errorCode) && result.errorCode !== 0) {
    diagnostics.push(`错误码 ${result.errorCode}`);
  }
  if (Number.isFinite(result.httpStatus) && result.httpStatus !== 0) {
    diagnostics.push(`HTTP ${result.httpStatus}`);
  }
  if (typeof result.logId === "string" && result.logId) {
    diagnostics.push(`Log ID ${result.logId}`);
  }
  return diagnostics.length ? `\n诊断：${diagnostics.join("｜")}` : "";
}

export function formatFeishuOperationError(response, fallback = "飞书操作失败。") {
  if (!response) return fallback;
  const message = response.error || fallback;
  const diagnostics = [];
  const stage = operationStageLabel(response.stage);
  if (stage) diagnostics.push(stage);
  if (Number.isFinite(response.errorCode) && response.errorCode !== 0) {
    diagnostics.push(`错误码 ${response.errorCode}`);
  }
  if (Number.isFinite(response.status) && response.status !== 0) {
    diagnostics.push(`HTTP ${response.status}`);
  }
  if (typeof response.logId === "string" && response.logId) {
    diagnostics.push(`Log ID ${response.logId}`);
  }
  return diagnostics.length ? `${message}\n诊断：${diagnostics.join("｜")}` : message;
}

export function canWriteFeishu({ authStatus, inspection, plan, errors = [], writing = false }) {
  return authStatus === "authorized"
    && Boolean(inspection)
    && Boolean(plan?.ok)
    && Number.isInteger(inspection.revisionId)
    && plan.baseRevisionId === inspection.revisionId
    && errors.length === 0
    && !writing;
}

export function canRepairJobLinks({
  authStatus,
  plan,
  selectedJobCount = 0,
  repairing = false
}) {
  return authStatus === "authorized"
    && Boolean(plan?.ok)
    && Number.isInteger(plan.baseRevisionId)
    && Number.isInteger(plan.updateCount)
    && plan.updateCount > 0
    && Number.isInteger(selectedJobCount)
    && selectedJobCount > 0
    && !repairing;
}

export function groupJobLinkUpdates(plan = {}) {
  const groups = new Map();
  for (const update of plan?.updates ?? []) {
    const companyName = String(update.companyName ?? "").trim();
    const jobText = String(update.jobText ?? "").trim();
    if (!companyName || !jobText) continue;
    if (!groups.has(companyName)) {
      groups.set(companyName, { companyName, jobCount: 0, jobs: [] });
    }
    const group = groups.get(companyName);
    group.jobCount += 1;
    group.jobs.push(jobText);
  }
  return [...groups.values()];
}

export function countSelectedJobLinks(plan = {}, selectedCompanyNames = []) {
  const selected = new Set(selectedCompanyNames);
  return (plan?.updates ?? []).filter((update) => selected.has(update.companyName)).length;
}

export function describeJobLinkPlan(plan = {}) {
  if (!plan.ok) {
    return {
      title: "岗位链接计划不可执行",
      detail: (plan.errors ?? []).join("；") || "请检查正式招聘文档结构。",
      updates: []
    };
  }
  if (!plan.updateCount) {
    return {
      title: "全部岗位链接已正确",
      detail: `共检查 ${plan.totalJobs ?? 0} 个岗位，无需修改正式文档。`,
      updates: []
    };
  }
  return {
    title: `发现 ${plan.updateCount} 个岗位链接需要补全`,
    detail: `共检查 ${plan.totalJobs ?? 0} 个岗位，${plan.correctLinks ?? 0} 个已经正确。`,
    updates: (plan.updates ?? []).map((update) =>
      `${update.companyName}｜${update.jobText}`
    )
  };
}

export function formatJobLinkRepairStatus(result = {}) {
  const diagnostics = formatWriteDiagnostics(result);
  if (result.ok || result.status === "success") {
    return `岗位链接补全成功：已更新 ${result.updatedLinks ?? 0} 个，共检查 ${result.totalJobs ?? 0} 个岗位。${diagnostics}`;
  }
  const detail = result.repairHint || "请检查正式招聘文档。";
  if (result.status === "unknown") {
    return `岗位链接结果未知：${detail}${diagnostics}`;
  }
  return `岗位链接补全失败：${detail}${diagnostics}`;
}

export function describeFeishuPlan(plan) {
  if (!plan?.ok) {
    return {
      title: "计划不可执行",
      position: (plan?.errors ?? []).join("；") || "请先检查授权、文档与预览字段。",
      jobs: []
    };
  }
  const isAppend = plan.mode === "append-jobs";
  const isResume = plan.mode === "resume-new-company";
  return {
    title: isAppend ? "老公司追加岗位" : isResume ? "恢复未完成的新公司" : "新公司置顶",
    position: isResume
      ? "岗位 JD 已存在且与本次草稿完全一致；不会重复写 JD，将直接把公司插入 Portfolio 汇总首位。"
      : isAppend
      ? "将在 Portfolio 与岗位 JD 的原公司分组末尾追加，不创建第二个公司块。"
      : "将公司插入 Portfolio 汇总首位，并在“岗位JD整理”下以根级一级标题置顶。",
    jobs: (plan.jobs ?? []).map((job) =>
      `（${job.ordinal}）${job.title}｜${job.location}｜${job.employment}`
    )
  };
}

function phaseLabel(stage) {
  const labels = {
    preflight: "写入前检查",
    "jd-write": "岗位 JD 写入",
    "jd-verify": "岗位 JD 校验",
    "summary-write": "Portfolio 写入",
    "summary-verify": "Portfolio 校验",
    "job-link-preflight": "岗位链接检查",
    "job-link-write": "岗位链接写入",
    "job-link-verify": "岗位链接校验"
  };
  return labels[stage] ?? "飞书操作";
}

function operationStageLabel(stage) {
  const labels = {
    "authorization-required": "尚未授权",
    "oauth-launch": "打开授权窗口",
    "oauth-callback": "授权回调",
    "native-exchange": "本机授权交换",
    "auth-store": "保存授权状态",
    "wiki-resolve": "读取 Wiki 节点",
    "document-metadata": "读取文档信息",
    "document-blocks-read": "读取文档内容",
    "block-model": "构建文档块树",
    "template-inspection": "识别招聘模板"
  };
  return labels[stage] ?? (stage && stage !== "unknown" ? stage : "");
}
