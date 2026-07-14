import {
  createFeishuBackgroundServices,
  registerFeishuBackgroundMessages
} from "./background/feishuMessages.js";

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});

const feishuServices = createFeishuBackgroundServices({ chromeApi: chrome });
registerFeishuBackgroundMessages(chrome, feishuServices);
