export class OutlookPageBridgeError extends Error {
  constructor(message, { stage = "outlook-gui-bridge" } = {}) {
    super(message);
    this.name = "OutlookPageBridgeError";
    this.stage = stage;
  }
}

export function createOutlookPageBridge({ chromeApi = chrome } = {}) {
  async function send(tabId, message) {
    try {
      const response = await chromeApi.tabs.sendMessage(tabId, message);
      if (response != null) return response;
    } catch {
      // A loaded Outlook tab keeps its DOM after an extension update, but its
      // previous content-script connection is invalid. Reinject once below.
    }

    if (typeof chromeApi.scripting?.executeScript !== "function") {
      throw new OutlookPageBridgeError("Outlook page bridge is unavailable");
    }
    try {
      await chromeApi.scripting.executeScript({
        target: { tabId },
        files: ["outlook.js"]
      });
      const response = await chromeApi.tabs.sendMessage(tabId, message);
      if (response != null) return response;
    } catch {
      throw new OutlookPageBridgeError("Outlook page bridge could not reconnect");
    }
    throw new OutlookPageBridgeError("Outlook page bridge did not respond");
  }

  return { send };
}
