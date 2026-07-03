import { describe, expect, it, vi } from "vitest";
import { sendFillRequest } from "../src/sidepanel/fillPage.js";

describe("sendFillRequest", () => {
  it("injects the content script and retries when no receiver exists", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("Could not establish connection. Receiving end does not exist."))
      .mockResolvedValueOnce({ ok: true, filled: ["title"], missing: [] });
    const executeScript = vi.fn().mockResolvedValue([]);
    const chromeApi = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 42, url: "https://maimai.cn/job/publish" }]),
        sendMessage
      },
      scripting: { executeScript }
    };

    const result = await sendFillRequest(
      { title: "Agent工程师" },
      "maimai",
      chromeApi
    );

    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 42 }, files: ["content.js"] });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenLastCalledWith(42, {
      type: "RECRUITING_ASSISTANT_FILL",
      platform: "maimai",
      payload: { title: "Agent工程师" }
    });
    expect(result).toEqual({ ok: true, filled: ["title"], missing: [] });
  });

  it("returns a readable error when the current tab cannot receive scripts", async () => {
    const chromeApi = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 9, url: "edge://extensions" }]),
        sendMessage: vi.fn()
      },
      scripting: { executeScript: vi.fn() }
    };

    const result = await sendFillRequest({}, "maimai", chromeApi);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("请先切到脉脉或 Boss 发布职位页面");
  });
});
