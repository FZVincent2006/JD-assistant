import {
  createFeishuBackgroundServices,
  registerFeishuBackgroundMessages
} from "./background/feishuMessages.js";
import {
  OUTLOOK_RETRY_ALARM,
  OUTLOOK_SCAN_ALARM,
  createOutlookMonitorService
} from "./lib/outlookMonitorService.js";
import { createOutlookGuiClient } from "./lib/outlookGuiClient.js";
import { createFeishuRichMailDelivery } from "./lib/feishuRichMail.js";
import { createFeishuTenantAuth } from "./background/feishuTenantAuth.js";
import { createDownloadedFileReader } from "./background/downloadedFileReader.js";
import { createOutlookPageBridge } from "./lib/outlookPageBridge.js";

const feishuTenantAuth = createFeishuTenantAuth({ chromeApi: chrome });
const outlookPageBridge = createOutlookPageBridge({ chromeApi: chrome });
const richDelivery = createFeishuRichMailDelivery({
  getAccessToken: feishuTenantAuth.getAccessToken
});
const outlookMonitorService = createOutlookMonitorService({
  chromeApi: chrome,
  pageBridge: outlookPageBridge,
  guiClient: createOutlookGuiClient({
    chromeApi: chrome,
    pageBridge: outlookPageBridge,
    downloadedFileReader: createDownloadedFileReader({ chromeApi: chrome })
  }),
  richDelivery
});

chrome.runtime.onInstalled.addListener((details) => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
  outlookMonitorService.initialize()
    .then(() => details?.reason === "update"
      ? outlookMonitorService.retryPendingNow()
      : null)
    .catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  outlookMonitorService.initialize();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name !== OUTLOOK_SCAN_ALARM && alarm?.name !== OUTLOOK_RETRY_ALARM) return;
  outlookMonitorService.handleAlarm(alarm);
});

chrome.tabs.onActivated?.addListener(() => {
  outlookMonitorService.handleAlarm({ name: OUTLOOK_SCAN_ALARM });
});

chrome.windows?.onFocusChanged?.addListener(() => {
  outlookMonitorService.handleAlarm({ name: OUTLOOK_SCAN_ALARM });
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
