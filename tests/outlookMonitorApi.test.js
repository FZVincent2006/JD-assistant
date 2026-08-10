import { describe, expect, it, vi } from "vitest";
import {
  authorizeOutlookGraph,
  clearOutlookGraphAuthorization,
  getOutlookMonitorStatus,
  rebaselineOutlookMonitor,
  saveOutlookMonitorConfig,
  setOutlookMonitorEnabled,
  testOutlookMonitorFeishu
} from "../src/sidepanel/outlookMonitorApi.js";

function chromeFake(response = { ok: true }) {
  return {
    runtime: {
      sendMessage: vi.fn().mockResolvedValue(response)
    }
  };
}

describe("Outlook monitor side-panel API", () => {
  it("uses explicit service-worker messages for every action", async () => {
    const chromeApi = chromeFake();

    await getOutlookMonitorStatus(chromeApi);
    await saveOutlookMonitorConfig({
      webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/test",
      secret: "secret",
      rulesConfirmed: true
    }, chromeApi);
    await testOutlookMonitorFeishu(chromeApi);
    await authorizeOutlookGraph(chromeApi);
    await clearOutlookGraphAuthorization(chromeApi);
    await setOutlookMonitorEnabled(true, chromeApi);
    await rebaselineOutlookMonitor(true, chromeApi);

    expect(chromeApi.runtime.sendMessage.mock.calls).toEqual([
      [{ type: "OUTLOOK_MONITOR_GET" }],
      [{
        type: "OUTLOOK_MONITOR_SAVE_CONFIG",
        payload: {
          webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/test",
          secret: "secret",
          rulesConfirmed: true
        }
      }],
      [{ type: "OUTLOOK_MONITOR_TEST_FEISHU" }],
      [{ type: "OUTLOOK_MONITOR_AUTHORIZE_GRAPH" }],
      [{ type: "OUTLOOK_MONITOR_CLEAR_GRAPH" }],
      [{ type: "OUTLOOK_MONITOR_SET_ENABLED", payload: { enabled: true } }],
      [{ type: "OUTLOOK_MONITOR_REBASELINE", payload: { confirmed: true } }]
    ]);
  });

  it("returns a readable error when the background worker is unavailable", async () => {
    const chromeApi = {
      runtime: {
        sendMessage: vi.fn().mockRejectedValue(new Error("Receiving end does not exist"))
      }
    };

    await expect(getOutlookMonitorStatus(chromeApi)).resolves.toEqual({
      ok: false,
      error: "Outlook 提醒后台暂时不可用，请重新加载扩展。"
    });
  });
});
