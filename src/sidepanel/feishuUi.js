export function updateJobDraftField(draft, index, field, value) {
  return {
    ...draft,
    jobs: draft.jobs.map((job, jobIndex) => jobIndex === index ? { ...job, [field]: value } : job)
  };
}

export function formatFeishuWriteStatus(result) {
  if (result?.ok || result?.status === "success") {
    const action = result.mode === "append-jobs" ? "新岗位已追加" : "新公司已更新";
    return `写入成功：${action} JD 区和岗位汇总区。`;
  }
  const detail = result?.repairHint || result?.error || "请检查测试副本文档。";
  if (result?.status === "partial" || (result?.completedStages ?? result?.completed)?.includes("jd")) {
    return `部分完成：岗位 JD 区已确认写入；Portfolio 区未完成。${detail}`;
  }
  if (result?.status === "unknown") {
    return `结果未知（${phaseLabel(result.failedStage)}）：${detail}`;
  }
  return `写入失败（${phaseLabel(result?.failedStage)}）：${detail}`;
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

export function describeFeishuPlan(plan) {
  if (!plan?.ok) {
    return {
      title: "计划不可执行",
      position: (plan?.errors ?? []).join("；") || "请先检查授权、文档与预览字段。",
      jobs: []
    };
  }
  const isAppend = plan.mode === "append-jobs";
  return {
    title: isAppend ? "老公司追加岗位" : "新公司置顶",
    position: isAppend
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
    "summary-verify": "Portfolio 校验"
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
    "document-blocks-read": "读取文档内容"
  };
  return labels[stage] ?? (stage && stage !== "unknown" ? stage : "");
}
