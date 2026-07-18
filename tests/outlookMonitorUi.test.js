import { describe, expect, it } from "vitest";
import {
  describeOutlookEvent,
  formatOutlookMonitorStatus,
  monitorSetupChecklist
} from "../src/sidepanel/outlookMonitorUi.js";

describe("formatOutlookMonitorStatus", () => {
  it.each([
    ["unconfigured", "机器人"],
    ["needs_setup", "测试提醒"],
    ["ready", "开启"],
    ["baselining", "基线"],
    ["monitoring", "正常"],
    ["outlook_tab_missing", "Outlook 标签页"],
    ["login_required", "重新登录"],
    ["wrong_mailbox", "recruiting@zhenfund.com"],
    ["wrong_folder", "个人投递（需提醒）"],
    ["feishu_unavailable", "飞书机器人"],
    ["paused", "暂停"]
  ])("explains %s in non-technical language", (status, text) => {
    expect(formatOutlookMonitorStatus({ status })).toContain(text);
  });
});

describe("monitorSetupChecklist", () => {
  it("keeps the enable button locked until setup is complete", () => {
    expect(monitorSetupChecklist({
      config: {
        webhookConfigured: true,
        secretConfigured: true,
        rulesConfirmed: true,
        testedAt: 123
      },
      page: {
        targetMailbox: true,
        targetFolder: true,
        loggedIn: true
      },
      baselineComplete: false
    })).toEqual({
      robotConfigured: true,
      testSucceeded: true,
      rulesConfirmed: true,
      outlookReady: true,
      readyToEnable: true
    });
  });
});

describe("describeOutlookEvent", () => {
  it("describes events without candidate metadata", () => {
    expect(describeOutlookEvent({ code: "notification_delivered", count: 2 }))
      .toBe("已发送 2 条飞书提醒");
    expect(describeOutlookEvent({ code: "notification_failed", errorCode: "NETWORK" }))
      .toBe("飞书发送失败（NETWORK）");
  });
});
