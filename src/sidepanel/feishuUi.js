export function updateJobDraftField(draft, index, field, value) {
  return {
    ...draft,
    jobs: draft.jobs.map((job, jobIndex) => jobIndex === index ? { ...job, [field]: value } : job)
  };
}

export function formatFeishuWriteStatus(result) {
  if (result.ok) {
    const action = result.mode === "append-jobs" ? "新岗位已追加" : "新公司已更新";
    return `写入成功：${action} JD 区和岗位汇总区。`;
  }
  if (result.completed?.includes("jd")) return `部分完成：JD 区已写入。${result.error}`;
  return result.error || "飞书写入失败。";
}
