import { describe, expect, it, vi } from "vitest";
import { createFeishuPageNumbering } from "../src/background/feishuPageNumbering.js";
import { TEST_FEISHU_DOC_URL } from "../src/lib/feishuConfig.js";

describe("Feishu page numbering transport", () => {
  it("sends one numbering message only to the active test-copy tab", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    const chromeApi = { tabs: {
      query: vi.fn().mockResolvedValue([{ id: 42, url: `${TEST_FEISHU_DOC_URL}?fromScene=spaceOverview` }]),
      sendMessage
    }};
    const service = createFeishuPageNumbering({ chromeApi });
    await expect(service.apply("CoFANCY 可糖")).resolves.toEqual({ ok: true });
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith(42, {
      type: "FEISHU_APPLY_HEADING_NUMBERING",
      companyName: "CoFANCY 可糖"
    });
  });

  it("rejects a non-test active tab before sending a message", async () => {
    const sendMessage = vi.fn();
    const service = createFeishuPageNumbering({ chromeApi: { tabs: {
      query: vi.fn().mockResolvedValue([{ id: 7, url: "https://example.com" }]),
      sendMessage
    }}});
    await expect(service.apply("CoFANCY 可糖")).rejects.toMatchObject({
      stage: "jd-numbering-page",
      reason: "wrong-document"
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("normalizes page failures without leaking DOM details", async () => {
    const service = createFeishuPageNumbering({ chromeApi: { tabs: {
      query: vi.fn().mockResolvedValue([{ id: 42, url: TEST_FEISHU_DOC_URL }]),
      sendMessage: vi.fn().mockResolvedValue({ ok: false, reason: "heading-duplicate", error: "safe" })
    }}});
    await expect(service.apply("CoFANCY 可糖")).rejects.toMatchObject({
      stage: "jd-numbering-page",
      reason: "heading-duplicate",
      message: "safe"
    });
  });
});
