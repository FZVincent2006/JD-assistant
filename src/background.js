import {
  createFeishuBackgroundServices,
  registerFeishuBackgroundMessages
} from "./background/feishuMessages.js";
import {
  OUTLOOK_RETRY_ALARM,
  OUTLOOK_SCAN_ALARM,
  createOutlookMonitorService
} from "./lib/outlookMonitorService.js";
import { createOutlookGraphAuth } from "./lib/outlookGraphAuth.js";
import { createOutlookGraphClient } from "./lib/outlookGraphClient.js";
import { createFeishuRichMailDelivery } from "./lib/feishuRichMail.js";
import { createFeishuTenantAuth } from "./background/feishuTenantAuth.js";

const outlookGraphAuth = createOutlookGraphAuth({ chromeApi: chrome });
const feishuTenantAuth = createFeishuTenantAuth({ chromeApi: chrome });
const richDelivery = createFeishuRichMailDelivery({
  getAccessToken: feishuTenantAuth.getAccessToken
});
const outlookMonitorService = createOutlookMonitorService({
  chromeApi: chrome,
  graphAuth: outlookGraphAuth,
  graphClient: (config) => createOutlookGraphClient({
    getAccessToken: () => outlookGraphAuth.getAccessToken(config)
  }),
  richDelivery
});

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
  outlookMonitorService.initialize();
});

chrome.runtime.onStartup.addListener(() => {
  outlookMonitorService.initialize();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name !== OUTLOOK_SCAN_ALARM && alarm?.name !== OUTLOOK_RETRY_ALARM) return;
  outlookMonitorService.handleAlarm(alarm);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!String(message?.type || "").startsWith("OUTLOOK_")) return false;

  outlookMonitorService.handleMessage(message)
    .then((response) => sendResponse(response))
    .catch(() => sendResponse({
      ok: false,
      error: "Outlook 提醒暂时无法处理该操作，请稍后重试。"
    }));
  return true;
});

const feishuServices = createFeishuBackgroundServices({ chromeApi: chrome });
registerFeishuBackgroundMessages(chrome, feishuServices);
outlookMonitorService.initialize();
