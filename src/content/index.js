import { fillRecruitingForm } from "./formFiller.js";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "RECRUITING_ASSISTANT_FILL") return false;

  fillRecruitingForm(message.payload, document, { platform: message.platform })
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });

  return true;
});
