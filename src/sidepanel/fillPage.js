const MESSAGE_TYPE = "RECRUITING_ASSISTANT_FILL";
const RECEIVER_MISSING = "Receiving end does not exist";
const SUPPORTED_URL = /^https:\/\/([^/]+\.)?(zhipin|kanzhun|maimai)\.(com|cn)\//;

export async function sendFillRequest(payload, platform, chromeApi = chrome) {
  const tab = await getActiveTab(chromeApi);
  if (!tab?.id || !isSupportedTab(tab.url)) {
    return {
      ok: false,
      error: "请先切到脉脉或 Boss 发布职位页面，再点击填入当前页面。"
    };
  }

  const message = { type: MESSAGE_TYPE, platform, payload };

  try {
    return await chromeApi.tabs.sendMessage(tab.id, message);
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      return { ok: false, error: readableError(error) };
    }
  }

  try {
    await chromeApi.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });
    return await chromeApi.tabs.sendMessage(tab.id, message);
  } catch (error) {
    return {
      ok: false,
      error: `无法连接到当前页面，请刷新发布页后重试。${readableError(error)}`
    };
  }
}

async function getActiveTab(chromeApi) {
  const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isSupportedTab(url = "") {
  return SUPPORTED_URL.test(url);
}

function isMissingReceiverError(error) {
  return readableError(error).includes(RECEIVER_MISSING);
}

function readableError(error) {
  return error instanceof Error ? error.message : String(error ?? "");
}
