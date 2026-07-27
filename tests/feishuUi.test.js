import { describe, expect, it } from "vitest";
import {
  canRepairJobLinks,
  canWriteFeishu,
  describeJobLinkPlan,
  describeFeishuPlan,
  groupJobLinkUpdates,
  countSelectedJobLinks,
  formatFeishuOperationError,
  formatJobLinkRepairStatus,
  formatFeishuWriteStatus,
  shouldOfferFeishuDocumentCheck,
  updateJobDraftField
} from "../src/sidepanel/feishuUi.js";

describe("updateJobDraftField", () => {
  it("updates one nested job without mutating the other jobs", () => {
    const draft = { jobs: [{ title: "A" }, { title: "B" }] };
    const updated = updateJobDraftField(draft, 1, "title", "B2");
    expect(updated.jobs).toEqual([{ title: "A" }, { title: "B2" }]);
    expect(updated.jobs[0]).toBe(draft.jobs[0]);
    expect(updated.jobs[1]).not.toBe(draft.jobs[1]);
  });
});

describe("formatFeishuWriteStatus", () => {
  it("describes full, partial, failed, and unknown write outcomes without overclaiming", () => {
    expect(formatFeishuWriteStatus({ ok: true, status: "success", completedStages: ["jd", "summary"], mode: "new-company" }))
      .toBe("写入成功：新公司已更新 JD 区和岗位汇总区。");
    expect(formatFeishuWriteStatus({ ok: true, status: "success", completedStages: ["jd", "summary"], mode: "resume-new-company" }))
      .toBe("恢复成功：未重复写入 JD，已完成 Portfolio 汇总。");
    expect(formatFeishuWriteStatus({ ok: false, status: "partial", completedStages: ["jd"], failedStage: "summary-write", repairHint: "检查 Portfolio 区" }))
      .toBe("部分完成：岗位 JD 区已确认写入；Portfolio 区未完成。检查 Portfolio 区\n诊断：Portfolio 写入");
    expect(formatFeishuWriteStatus({ ok: false, status: "failed", failedStage: "jd-verify", repairHint: "检查岗位 JD 区" }))
      .toBe("写入失败（岗位 JD 校验）：检查岗位 JD 区\n诊断：岗位 JD 校验");
    const unknown = formatFeishuWriteStatus({ status: "unknown", failedStage: "jd-write", repairHint: "检查 JD 区" });
    expect(unknown).toContain("结果未知");
    expect(unknown).not.toContain("写入失败");
    expect(unknown).not.toContain("写入成功");
  });

  it("omits diagnostics when a partial result has no failed stage", () => {
    expect(formatFeishuWriteStatus({
      status: "partial",
      failedStage: null,
      repairHint: "检查文档",
      errorCode: 0,
      httpStatus: 0,
      logId: ""
    })).not.toContain("诊断：");
  });

  it("uses the production document in the safe fallback", () => {
    expect(formatFeishuWriteStatus({ status: "failed" }))
      .toContain("请检查正式招聘文档。");
  });
});

describe("manual Feishu document check", () => {
  it("offers the document only for partial, unknown, or verification failures", () => {
    expect(shouldOfferFeishuDocumentCheck({ status: "partial" })).toBe(true);
    expect(shouldOfferFeishuDocumentCheck({ status: "unknown" })).toBe(true);
    expect(shouldOfferFeishuDocumentCheck({ status: "failed", failedStage: "jd-verify" })).toBe(true);
    expect(shouldOfferFeishuDocumentCheck({ status: "failed", failedStage: "summary-verify" })).toBe(true);
    expect(shouldOfferFeishuDocumentCheck({ status: "success" })).toBe(false);
    expect(shouldOfferFeishuDocumentCheck({ status: "failed", failedStage: "preflight" })).toBe(false);
    expect(shouldOfferFeishuDocumentCheck(null)).toBe(false);
  });
});

describe("formatFeishuOperationError", () => {
  it("shows safe stage, error code, HTTP status, and log ID when present", () => {
    expect(formatFeishuOperationError({
      error: "飞书授权交换失败，请检查本机授权助手与飞书应用凭证。",
      stage: "native-exchange",
      errorCode: 20002,
      status: 400,
      logId: "safe-log"
    }, "飞书操作失败。"))
      .toBe("飞书授权交换失败，请检查本机授权助手与飞书应用凭证。\n诊断：本机授权交换｜错误码 20002｜HTTP 400｜Log ID safe-log");
  });

  it("omits empty diagnostics and never invents an error code", () => {
    expect(formatFeishuOperationError({ error: "请先授权。", stage: "authorization-required" }, "失败。"))
      .toBe("请先授权。\n诊断：尚未授权");
    expect(formatFeishuOperationError(null, "失败。"))
      .toBe("失败。");
  });

  it("labels local block and template inspection stages", () => {
    expect(formatFeishuOperationError({
      error: "块树异常。",
      stage: "block-model"
    }, "失败。"))
      .toBe("块树异常。\n诊断：构建文档块树");
    expect(formatFeishuOperationError({
      error: "模板异常。",
      stage: "template-inspection"
    }, "失败。"))
      .toBe("模板异常。\n诊断：识别招聘模板");
  });
});

describe("Feishu write readiness", () => {
  const ready = {
    authStatus: "authorized",
    inspection: { revisionId: 12 },
    plan: { ok: true, baseRevisionId: 12 },
    errors: [],
    writing: false
  };

  it("requires authorization, a current inspection, a valid matching plan, and no draft errors", () => {
    expect(canWriteFeishu(ready)).toBe(true);
    expect(canWriteFeishu({ ...ready, authStatus: "unauthorized" })).toBe(false);
    expect(canWriteFeishu({ ...ready, inspection: null })).toBe(false);
    expect(canWriteFeishu({ ...ready, plan: null })).toBe(false);
    expect(canWriteFeishu({ ...ready, plan: { ok: false, baseRevisionId: 12 } })).toBe(false);
    expect(canWriteFeishu({ ...ready, plan: { ok: true, baseRevisionId: 11 } })).toBe(false);
    expect(canWriteFeishu({ ...ready, errors: ["缺少岗位"] })).toBe(false);
    expect(canWriteFeishu({ ...ready, writing: true })).toBe(false);
  });

  it("describes new-company, append, and exact recovery plans in human terms", () => {
    expect(describeFeishuPlan({
      ok: true,
      mode: "new-company",
      jobs: [{ title: "品牌设计", location: "上海", employment: "社招", ordinal: 1 }]
    })).toEqual({
      title: "新公司置顶",
      position: "将公司插入 Portfolio 汇总首位，并在“岗位JD整理”下以根级一级标题置顶。",
      jobs: ["（1）品牌设计｜上海｜社招"]
    });
    expect(describeFeishuPlan({ ok: true, mode: "append-jobs", jobs: [] }).position)
      .toContain("原公司分组末尾");
    expect(describeFeishuPlan({
      ok: true,
      mode: "resume-new-company",
      jobs: [{ title: "品牌设计", location: "上海", employment: "社招", ordinal: 1 }]
    })).toEqual({
      title: "恢复未完成的新公司",
      position: "岗位 JD 已存在且与本次草稿完全一致；不会重复写 JD，将直接把公司插入 Portfolio 汇总首位。",
      jobs: ["（1）品牌设计｜上海｜社招"]
    });
  });
});

describe("historical Portfolio job-link maintenance", () => {
  const currentPlan = {
    ok: true,
    baseRevisionId: 48,
    totalJobs: 12,
    correctLinks: 9,
    updateCount: 3,
    manualIssueCount: 2,
    updates: [
      { companyName: "CoFANCY 可糖", jobText: "品牌设计｜上海｜社招" }
    ],
    issues: ["人工项 A", "人工项 B"],
    errors: []
  };

  it("treats the initial null plan as an empty link plan", () => {
    expect(countSelectedJobLinks(null, [])).toBe(0);
    expect(groupJobLinkUpdates(null)).toEqual([]);
  });

  it("enables repair only for an authorized, current, non-empty safe plan", () => {
    expect(canRepairJobLinks({
      authStatus: "authorized",
      plan: currentPlan,
      selectedJobCount: 1,
      repairing: false
    })).toBe(true);
    expect(canRepairJobLinks({
      authStatus: "unauthorized",
      plan: currentPlan,
      selectedJobCount: 1,
      repairing: false
    })).toBe(false);
    expect(canRepairJobLinks({
      authStatus: "authorized",
      plan: { ...currentPlan, ok: false },
      selectedJobCount: 1,
      repairing: false
    })).toBe(false);
    expect(canRepairJobLinks({
      authStatus: "authorized",
      plan: { ...currentPlan, updateCount: 0 },
      selectedJobCount: 0,
      repairing: false
    })).toBe(false);
    expect(canRepairJobLinks({
      authStatus: "authorized",
      plan: { ...currentPlan, baseRevisionId: undefined },
      selectedJobCount: 1,
      repairing: false
    })).toBe(false);
    expect(canRepairJobLinks({
      authStatus: "authorized",
      plan: currentPlan,
      selectedJobCount: 1,
      repairing: true
    })).toBe(false);
    expect(canRepairJobLinks({
      authStatus: "authorized",
      plan: currentPlan,
      selectedJobCount: 0,
      repairing: false
    })).toBe(false);
  });

  it("groups pending updates by company and counts only the selected companies", () => {
    const plan = {
      ...currentPlan,
      updateCount: 3,
      updates: [
        { companyName: "CoFANCY 可糖", jobText: "品牌设计｜上海｜社招" },
        { companyName: "CoFANCY 可糖", jobText: "销售主管｜深圳｜社招" },
        { companyName: "闪念贝壳", jobText: "Agent 架构工程师｜深圳｜社招" }
      ]
    };

    expect(groupJobLinkUpdates(plan)).toEqual([
      {
        companyName: "CoFANCY 可糖",
        jobCount: 2,
        jobs: ["品牌设计｜上海｜社招", "销售主管｜深圳｜社招"]
      },
      {
        companyName: "闪念贝壳",
        jobCount: 1,
        jobs: ["Agent 架构工程师｜深圳｜社招"]
      }
    ]);
    expect(countSelectedJobLinks(plan, ["CoFANCY 可糖"])).toBe(2);
    expect(countSelectedJobLinks(plan, ["不存在"])).toBe(0);
  });

  it("describes pending, complete, and invalid scans without exposing targets", () => {
    expect(describeJobLinkPlan(currentPlan)).toEqual({
      title: "可安全补全 3 个岗位链接",
      detail: "共检查 12 个岗位，9 个已经正确，2 个需人工检查。",
      updates: ["CoFANCY 可糖｜品牌设计｜上海｜社招"],
      manualIssueCount: 2,
      issues: ["人工项 A", "人工项 B"]
    });
    expect(describeJobLinkPlan({
      ...currentPlan,
      updateCount: 0,
      updates: [],
      manualIssueCount: 3,
      issues: ["人工项 A", "人工项 B", "人工项 C"]
    })).toEqual({
      title: "没有可安全自动补全的岗位",
      detail: "共检查 12 个岗位，9 个已经正确，3 个需人工检查。",
      updates: [],
      manualIssueCount: 3,
      issues: ["人工项 A", "人工项 B", "人工项 C"]
    });
    expect(describeJobLinkPlan({
      ...currentPlan,
      correctLinks: 12,
      updateCount: 0,
      updates: [],
      manualIssueCount: 0,
      issues: []
    }))
      .toEqual({
        title: "全部岗位链接已正确",
        detail: "共检查 12 个岗位，无需修改正式文档。",
        updates: [],
        manualIssueCount: 0,
        issues: []
      });
    expect(describeJobLinkPlan({ ...currentPlan, ok: false, errors: ["岗位不唯一"] }))
      .toEqual({
        title: "岗位链接计划不可执行",
        detail: "岗位不唯一",
        updates: [],
        manualIssueCount: 0,
        issues: []
      });
  });

  it("formats successful, failed, and unknown repair outcomes without overclaiming", () => {
    expect(formatJobLinkRepairStatus({
      ok: true,
      status: "success",
      updatedLinks: 3,
      totalJobs: 12
    })).toBe("岗位链接补全成功：已更新 3 个，共检查 12 个岗位。");
    expect(formatJobLinkRepairStatus({
      status: "failed",
      failedStage: "job-link-write",
      repairHint: "权限不足",
      errorCode: 99991672
    })).toBe("岗位链接补全失败：权限不足\n诊断：岗位链接写入｜错误码 99991672");
    expect(formatJobLinkRepairStatus({
      status: "unknown",
      failedStage: "job-link-verify",
      repairHint: "不要重复提交"
    })).toBe("岗位链接结果未知：不要重复提交\n诊断：岗位链接校验");
  });
});
