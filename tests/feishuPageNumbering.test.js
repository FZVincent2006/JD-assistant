import { describe, expect, it, vi } from "vitest";
import { createFeishuPageNumbering } from "../src/background/feishuPageNumbering.js";
import { PRODUCTION_FEISHU_DOC_URL } from "../src/lib/feishuConfig.js";

describe("Feishu page numbering transport", () => {
  it("sends one preparation message only to the active test-copy tab", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, state: "prepared" });
    const chromeApi = { tabs: {
      query: vi.fn().mockResolvedValue([{ id: 42, url: `${PRODUCTION_FEISHU_DOC_URL}?fromScene=spaceOverview` }]),
      sendMessage
    }};
    const service = createFeishuPageNumbering({ chromeApi });
    await expect(service.prepare("CoFANCY 可糖")).resolves.toEqual({ ok: true, state: "prepared" });
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith(42, {
      type: "FEISHU_PREPARE_HEADING_NUMBERING",
      companyName: "CoFANCY 可糖"
    });
  });

  it("rejects a non-test active tab before sending a message", async () => {
    const sendMessage = vi.fn();
    const executeScript = vi.fn();
    const service = createFeishuPageNumbering({ chromeApi: {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 7, url: "https://example.com" }]),
        sendMessage
      },
      scripting: { executeScript }
    }});
    await expect(service.prepare("CoFANCY 可糖")).rejects.toMatchObject({
      stage: "jd-numbering-page",
      reason: "wrong-document"
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("injects the packaged content script once and retries preparation once when the listener is missing", async () => {
    const sendMessage = vi.fn()
      .mockRejectedValueOnce(new Error("Receiving end does not exist"))
      .mockResolvedValueOnce({ ok: true, state: "prepared" });
    const executeScript = vi.fn().mockResolvedValue([{ result: undefined }]);
    const chromeApi = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 42, url: PRODUCTION_FEISHU_DOC_URL }]),
        sendMessage
      },
      scripting: { executeScript }
    };

    const service = createFeishuPageNumbering({ chromeApi });
    await expect(service.prepare("CoFANCY 可糖")).resolves.toEqual({ ok: true, state: "prepared" });

    const expectedMessage = {
      type: "FEISHU_PREPARE_HEADING_NUMBERING",
      companyName: "CoFANCY 可糖"
    };
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[0]).toEqual([42, expectedMessage]);
    expect(sendMessage.mock.calls[1]).toEqual([42, expectedMessage]);
    expect(executeScript).toHaveBeenCalledOnce();
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 42, allFrames: false },
      files: ["content.js"]
    });
  });

  it("reports a page failure when the packaged content script cannot be injected", async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error("Receiving end does not exist"));
    const executeScript = vi.fn().mockRejectedValue(new Error("Cannot access contents of the page"));
    const service = createFeishuPageNumbering({ chromeApi: {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 42, url: PRODUCTION_FEISHU_DOC_URL }]),
        sendMessage
      },
      scripting: { executeScript }
    }});

    await expect(service.prepare("CoFANCY 可糖")).rejects.toMatchObject({
      stage: "jd-numbering-page",
      reason: "page-unavailable"
    });
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(executeScript).toHaveBeenCalledOnce();
  });

  it("reports a page failure after only one retry when the injected listener still cannot answer", async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error("Receiving end does not exist"));
    const executeScript = vi.fn().mockResolvedValue([{ result: undefined }]);
    const service = createFeishuPageNumbering({ chromeApi: {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 42, url: PRODUCTION_FEISHU_DOC_URL }]),
        sendMessage
      },
      scripting: { executeScript }
    }});

    await expect(service.prepare("CoFANCY 可糖")).rejects.toMatchObject({
      stage: "jd-numbering-page",
      reason: "page-unavailable"
    });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(executeScript).toHaveBeenCalledOnce();
  });

  it("normalizes page failures without leaking DOM details", async () => {
    const service = createFeishuPageNumbering({ chromeApi: { tabs: {
      query: vi.fn().mockResolvedValue([{ id: 42, url: PRODUCTION_FEISHU_DOC_URL }]),
      sendMessage: vi.fn().mockResolvedValue({ ok: false, reason: "heading-duplicate", error: "safe" })
    }}});
    await expect(service.prepare("CoFANCY 可糖")).rejects.toMatchObject({
      stage: "jd-numbering-page",
      reason: "heading-duplicate",
      message: "safe"
    });
  });
});
