import { describe, expect, it } from "vitest";
import { formatFeishuWriteStatus, updateJobDraftField } from "../src/sidepanel/feishuUi.js";

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
  it("describes full and partial write outcomes", () => {
    expect(formatFeishuWriteStatus({ ok: true, completed: ["jd", "summary"], mode: "new-company" }))
      .toBe("写入成功：新公司已更新 JD 区和岗位汇总区。");
    expect(formatFeishuWriteStatus({ ok: false, completed: ["jd"], error: "汇总校验失败" }))
      .toBe("部分完成：JD 区已写入。汇总校验失败");
  });
});
