export function getOutlookMonitorStatus(chromeApi = chrome) {
  return sendOutlookMonitorRequest("OUTLOOK_MONITOR_GET", undefined, chromeApi);
}

export function saveOutlookMonitorConfig(payload, chromeApi = chrome) {
  return sendOutlookMonitorRequest("OUTLOOK_MONITOR_SAVE_CONFIG", payload, chromeApi);
}

export function testOutlookMonitorFeishu(chromeApi = chrome) {
  return sendOutlookMonitorRequest("OUTLOOK_MONITOR_TEST_FEISHU", undefined, chromeApi);
}

export function setOutlookMonitorEnabled(enabled, chromeApi = chrome) {
  return sendOutlookMonitorRequest("OUTLOOK_MONITOR_SET_ENABLED", { enabled }, chromeApi);
}

export function rebaselineOutlookMonitor(confirmed, chromeApi = chrome) {
  return sendOutlookMonitorRequest("OUTLOOK_MONITOR_REBASELINE", { confirmed }, chromeApi);
}

export async function sendOutlookMonitorRequest(type, payload, chromeApi = chrome) {
  try {
    return await chromeApi.runtime.sendMessage(
      payload === undefined ? { type } : { type, payload }
    );
  } catch {
    return {
      ok: false,
      error: "Outlook 提醒后台暂时不可用，请重新加载扩展。"
    };
  }
}
