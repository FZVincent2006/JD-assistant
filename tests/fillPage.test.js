import { describe, expect, it, vi } from "vitest";
import {
  collectClickRecording,
  sendFeishuInspectRequest,
  sendFeishuWriteRequest,
  sendDiagnosticRequest,
  sendFillRequest,
  startClickRecording
} from "../src/sidepanel/fillPage.js";

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

  it("uses the active Boss tab URL to choose Boss platform even if the side panel is still on Maimai", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, filled: ["title"], missing: [] });
    const chromeApi = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 7, url: "https://www.zhipin.com/web/boss/job/edit" }]),
        sendMessage
      },
      scripting: { executeScript: vi.fn() },
      webNavigation: { getAllFrames: vi.fn().mockResolvedValue([]) }
    };

    await sendFillRequest({ title: "Agent工程师" }, "maimai", chromeApi);

    expect(sendMessage).toHaveBeenCalledWith(7, {
      type: "RECRUITING_ASSISTANT_FILL",
      platform: "boss",
      payload: { title: "Agent工程师" }
    });
  });

  it("tries child frames without reinjecting content scripts that already respond", async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        platform: "boss",
        filled: [],
        missing: ["recruitmentType", "title", "description"]
      })
      .mockResolvedValueOnce({
        ok: true,
        platform: "boss",
        filled: ["title", "description"],
        missing: []
      });
    const chromeApi = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 11, url: "https://www.zhipin.com/web/boss/job/edit" }]),
        sendMessage
      },
      scripting: { executeScript: vi.fn().mockResolvedValue([]) },
      webNavigation: {
        getAllFrames: vi.fn().mockResolvedValue([
          { frameId: 0, url: "https://www.zhipin.com/web/boss/job/edit" },
          { frameId: 3, url: "https://www.zhipin.com/web/boss/job/form" }
        ])
      }
    };

    const result = await sendFillRequest({ title: "Agent工程师" }, "boss", chromeApi);

    expect(chromeApi.scripting.executeScript).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenLastCalledWith(
      11,
      { type: "RECRUITING_ASSISTANT_FILL", platform: "boss", payload: { title: "Agent工程师" } },
      { frameId: 3 }
    );
    expect(result).toEqual({ ok: true, platform: "boss", filled: ["title", "description"], missing: [] });
  });

  it("injects only the child frame that is missing a receiver", async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        platform: "boss",
        filled: [],
        missing: ["recruitmentType", "title", "description"]
      })
      .mockRejectedValueOnce(new Error("Could not establish connection. Receiving end does not exist."))
      .mockResolvedValueOnce({
        ok: true,
        platform: "boss",
        filled: ["title", "description"],
        missing: []
      });
    const chromeApi = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 11, url: "https://www.zhipin.com/web/boss/job/edit" }]),
        sendMessage
      },
      scripting: { executeScript: vi.fn().mockResolvedValue([]) },
      webNavigation: {
        getAllFrames: vi.fn().mockResolvedValue([
          { frameId: 0, url: "https://www.zhipin.com/web/boss/job/edit" },
          { frameId: 3, url: "https://www.zhipin.com/web/boss/job/form" }
        ])
      }
    };

    const result = await sendFillRequest({ title: "Agent工程师" }, "boss", chromeApi);

    expect(chromeApi.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 11, frameIds: [3] },
      files: ["content.js"]
    });
    expect(sendMessage).toHaveBeenLastCalledWith(
      11,
      { type: "RECRUITING_ASSISTANT_FILL", platform: "boss", payload: { title: "Agent工程师" } },
      { frameId: 3 }
    );
    expect(result).toEqual({ ok: true, platform: "boss", filled: ["title", "description"], missing: [] });
  });

  it("collects diagnostics from supported top and child frames", async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, diagnostics: { url: "https://www.zhipin.com/top" } })
      .mockResolvedValueOnce({ ok: true, diagnostics: { url: "https://www.zhipin.com/frame" } });
    const chromeApi = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 12, url: "https://www.zhipin.com/web/boss/job/edit" }]),
        sendMessage
      },
      scripting: { executeScript: vi.fn().mockResolvedValue([]) },
      webNavigation: {
        getAllFrames: vi.fn().mockResolvedValue([
          { frameId: 0, url: "https://www.zhipin.com/web/boss/job/edit" },
          { frameId: 5, url: "https://www.zhipin.com/web/boss/job/form" },
          { frameId: 8, url: "https://example.com/ignored" }
        ])
      }
    };

    const result = await sendDiagnosticRequest(chromeApi);

    expect(result).toEqual({
      ok: true,
      diagnostics: [
        { frameId: 0, url: "https://www.zhipin.com/top" },
        { frameId: 5, url: "https://www.zhipin.com/frame" }
      ]
    });
    expect(sendMessage).toHaveBeenLastCalledWith(12, { type: "RECRUITING_ASSISTANT_DIAGNOSE" }, { frameId: 5 });
    expect(chromeApi.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("starts click recording by injecting a recorder into every frame", async () => {
    const executeScript = vi.fn().mockResolvedValue([
      { frameId: 0, result: { startedAt: 100, durationMs: 45000 } },
      { frameId: 395, result: { startedAt: 100, durationMs: 45000 } }
    ]);
    const chromeApi = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 12, url: "https://www.zhipin.com/web/boss/job/edit" }])
      },
      scripting: { executeScript }
    };

    const result = await startClickRecording(chromeApi);

    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 12, allFrames: true },
      world: "MAIN",
      func: expect.any(Function),
      args: [45000]
    });
    expect(result).toEqual({
      ok: true,
      responses: [
        { frameId: 0, recording: { startedAt: 100, durationMs: 45000 } },
        { frameId: 395, recording: { startedAt: 100, durationMs: 45000 } }
      ]
    });
  });

  it("collects click recording from every frame with scripting injection", async () => {
    const executeScript = vi.fn().mockResolvedValue([
      { frameId: 0, result: { url: "https://www.zhipin.com/top", logs: [] } },
      { frameId: 395, result: { url: "https://www.zhipin.com/frame", logs: [{ type: "mousedown" }] } }
    ]);
    const chromeApi = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 12, url: "https://www.zhipin.com/web/boss/job/edit" }])
      },
      scripting: { executeScript }
    };

    const result = await collectClickRecording(chromeApi);

    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 12, allFrames: true },
      world: "MAIN",
      func: expect.any(Function)
    });
    expect(result).toEqual({
      ok: true,
      responses: [
        { frameId: 0, recording: { url: "https://www.zhipin.com/top", logs: [] } },
        { frameId: 395, recording: { url: "https://www.zhipin.com/frame", logs: [{ type: "mousedown" }] } }
      ]
    });
  });
});

describe("Feishu document requests", () => {
  it("routes inspect and write through runtime messaging without an active Feishu tab", async () => {
    const sendMessage = vi.fn()
      .mockResolvedValueOnce({ ok: true, snapshot: { portfolioHeadingCount: 1, jdHeadingCount: 1 } })
      .mockResolvedValueOnce({ ok: true, completed: ["jd", "summary"] });
    const chromeApi = {
      runtime: { sendMessage }
    };

    await expect(sendFeishuInspectRequest(chromeApi)).resolves.toMatchObject({ ok: true });
    await expect(sendFeishuWriteRequest({ companyName: "Test" }, chromeApi)).resolves.toMatchObject({ ok: true });
    expect(sendMessage).toHaveBeenNthCalledWith(1, { type: "FEISHU_INSPECT" });
    expect(sendMessage).toHaveBeenNthCalledWith(2, {
      type: "FEISHU_WRITE",
      payload: { companyName: "Test" }
    });
  });

  it("returns a readable error when the background worker cannot be reached", async () => {
    const chromeApi = { runtime: { sendMessage: vi.fn().mockRejectedValue(new Error("worker unavailable")) } };
    const result = await sendFeishuInspectRequest(chromeApi);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("无法连接飞书自动化后台");
  });
});
