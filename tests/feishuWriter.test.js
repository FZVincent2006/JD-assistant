// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { executeFeishuWrite, pasteFeishuFragment } from "../src/content/feishuWriter.js";
import { PRODUCTION_FEISHU_DOC_URL } from "../src/content/feishuDocument.js";

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
      { url: PRODUCTION_FEISHU_DOC_URL, draft, root: document },
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
      { url: PRODUCTION_FEISHU_DOC_URL, draft, root: document },
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

  it("preserves partial-success details when the summary paste throws", async () => {
    const paste = vi.fn()
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("浏览器拒绝执行粘贴"));
    const result = await executeFeishuWrite(
      { url: PRODUCTION_FEISHU_DOC_URL, draft, root: document },
      {
        inspect: vi.fn()
          .mockResolvedValueOnce(emptySnapshot)
          .mockResolvedValueOnce(snapshotWithCompany(["jd"])),
        locate: (_root, _plan, area) => ({ area, element: document.body, position: "start" }),
        paste
      }
    );

    expect(result).toEqual({
      ok: false,
      stage: "summary",
      completed: ["jd"],
      error: "岗位汇总区写入失败：浏览器拒绝执行粘贴；JD 区已成功写入，请人工检查汇总区。"
    });
    expect(paste).toHaveBeenCalledTimes(2);
  });

  it("rejects every document except the configured production document", async () => {
    const inspect = vi.fn();
    const result = await executeFeishuWrite(
      { url: "https://zhenfund.feishu.cn/wiki/LlhrwSLIvilANZk1opwcQGlUnNv", draft, root: document },
      { inspect }
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("仅允许写入指定正式招聘文档");
    expect(inspect).not.toHaveBeenCalled();
  });
});

describe("pasteFeishuFragment", () => {
  it("lets the editor handle a rich paste event without relying on execCommand paste", async () => {
    document.body.innerHTML = '<div contenteditable="true">Existing</div>';
    const element = document.querySelector("div");
    const execCommand = vi.fn(() => false);
    const pastedPayloads = [];
    element.addEventListener("paste", (event) => {
      pastedPayloads.push({
        html: event.clipboardData.getData("text/html"),
        text: event.clipboardData.getData("text/plain")
      });
      event.preventDefault();
    });

    const result = await pasteFeishuFragment(
      { element, position: "start" },
      { html: "<p>New</p>", text: "New" },
      {
        root: document,
        writeClipboard: vi.fn().mockResolvedValue(undefined),
        execCommand
      }
    );

    expect(result).toBe(true);
    expect(pastedPayloads).toEqual([{ html: "<p>New</p>", text: "New" }]);
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("still dispatches the editor paste when the page clipboard write is denied", async () => {
    document.body.innerHTML = '<div contenteditable="true">Existing</div>';
    const element = document.querySelector("div");
    const pastedPayloads = [];
    element.addEventListener("paste", (event) => {
      pastedPayloads.push(event.clipboardData.getData("text/plain"));
      event.preventDefault();
    });

    const result = await pasteFeishuFragment(
      { element, position: "start" },
      { html: "<p>New</p>", text: "New" },
      {
        root: document,
        writeClipboard: vi.fn().mockRejectedValue(new DOMException("Document is not focused", "NotAllowedError")),
        execCommand: vi.fn(() => false)
      }
    );

    expect(result).toBe(true);
    expect(pastedPayloads).toEqual(["New"]);
  });

  it("inserts rich HTML directly when clipboard and synthetic paste are both unavailable", async () => {
    document.body.innerHTML = '<div contenteditable="true">Existing</div>';
    const element = document.querySelector("div");
    const execCommand = vi.fn((command) => command === "insertHTML");

    const result = await pasteFeishuFragment(
      { element, position: "start" },
      { html: "<p>New</p>", text: "New" },
      {
        root: document,
        writeClipboard: vi.fn().mockRejectedValue(new DOMException("Document is not focused", "NotAllowedError")),
        dispatchPaste: vi.fn(() => false),
        execCommand
      }
    );

    expect(result).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("insertHTML", false, "<p>New</p>");
  });

  it("reports the editor rejection separately when every insertion method fails", async () => {
    document.body.innerHTML = '<div contenteditable="true">Existing</div>';
    const element = document.querySelector("div");

    await expect(pasteFeishuFragment(
      { element, position: "start" },
      { html: "<p>New</p>", text: "New" },
      {
        root: document,
        writeClipboard: vi.fn().mockRejectedValue(new DOMException("Document is not focused", "NotAllowedError")),
        dispatchPaste: vi.fn(() => false),
        execCommand: vi.fn(() => false)
      }
    )).rejects.toThrow("飞书编辑器拒绝直接插入富文本；系统剪贴板也不可用：Document is not focused");
  });

  it("writes the clipboard before placing the caret and inserting rich HTML", async () => {
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
    expect(events).toEqual(["clipboard", "insertHTML"]);
  });
});
