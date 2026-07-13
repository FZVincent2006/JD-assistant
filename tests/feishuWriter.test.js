// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { executeFeishuWrite, pasteFeishuFragment } from "../src/content/feishuWriter.js";
import { TEST_FEISHU_DOC_URL } from "../src/content/feishuDocument.js";

const draft = {
  companyName: "Codex 测试公司",
  website: "",
  companyIntro: ["用于副本文档验收。"],
  jobs: [{
    title: "Agent 测试工程师",
    location: "上海",
    employment: "社招",
    responsibilities: ["验证自动填写。"],
    requirements: ["细心。"],
    bonuses: []
  }]
};

const emptySnapshot = {
  editable: true,
  portfolioHeadingCount: 1,
  jdHeadingCount: 1,
  portfolioCompanies: [],
  jdCompanies: []
};

function snapshotWithCompany(areas = ["jd", "summary"]) {
  const company = [{ name: draft.companyName, jobs: [draft.jobs[0].title] }];
  return {
    ...emptySnapshot,
    jdCompanies: areas.includes("jd") ? company : [],
    portfolioCompanies: areas.includes("summary") ? company : []
  };
}

describe("executeFeishuWrite", () => {
  it("writes and verifies JD before writing and verifying the summary", async () => {
    const events = [];
    const result = await executeFeishuWrite(
      { url: TEST_FEISHU_DOC_URL, draft, root: document },
      {
        inspect: vi.fn()
          .mockResolvedValueOnce(emptySnapshot)
          .mockResolvedValueOnce(snapshotWithCompany(["jd"]))
          .mockResolvedValueOnce(snapshotWithCompany(["jd", "summary"])),
        locate: (_root, _plan, area) => ({ area, element: document.body, position: "start" }),
        paste: async (target) => events.push(`paste:${target.area}`)
      }
    );

    expect(result).toMatchObject({ ok: true, completed: ["jd", "summary"], mode: "new-company" });
    expect(events).toEqual(["paste:jd", "paste:summary"]);
  });

  it("keeps a verified JD write and reports a summary verification failure without retrying", async () => {
    const paste = vi.fn().mockResolvedValue(true);
    const result = await executeFeishuWrite(
      { url: TEST_FEISHU_DOC_URL, draft, root: document },
      {
        inspect: vi.fn()
          .mockResolvedValueOnce(emptySnapshot)
          .mockResolvedValueOnce(snapshotWithCompany(["jd"]))
          .mockResolvedValueOnce(snapshotWithCompany(["jd"])),
        locate: (_root, _plan, area) => ({ area, element: document.body, position: "start" }),
        paste
      }
    );

    expect(result).toEqual({
      ok: false,
      stage: "summary",
      completed: ["jd"],
      error: "岗位汇总区写入后校验失败；JD 区已成功写入，请人工检查汇总区。"
    });
    expect(paste).toHaveBeenCalledTimes(2);
  });

  it("rejects every document except the configured test copy", async () => {
    const inspect = vi.fn();
    const result = await executeFeishuWrite(
      { url: "https://zhenfund.feishu.cn/wiki/RTWjwVZjri4uCUk0J8wcn2K3n6d", draft, root: document },
      { inspect }
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("仅允许写入指定测试副本");
    expect(inspect).not.toHaveBeenCalled();
  });
});

describe("pasteFeishuFragment", () => {
  it("writes the clipboard before placing the caret and invoking paste", async () => {
    document.body.innerHTML = '<div contenteditable="true">Existing</div>';
    const element = document.querySelector("div");
    const events = [];
    const result = await pasteFeishuFragment(
      { element, position: "start" },
      { html: "<p>New</p>", text: "New" },
      {
        root: document,
        writeClipboard: async () => events.push("clipboard"),
        execCommand: (command) => { events.push(command); return true; }
      }
    );
    expect(result).toBe(true);
    expect(events).toEqual(["clipboard", "paste"]);
  });
});
