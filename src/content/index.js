import { fillRecruitingForm } from "./formFiller.js";
import { collectPageDiagnostics } from "./diagnostics.js";
import { collectClickRecording, startClickRecording, stopClickRecording } from "./clickRecorder.js";
import { handleFeishuHeadingNumberingMessage } from "./feishuHeadingMessages.js";

if (!globalThis.__recruitingAssistantContentLoaded) {
  globalThis.__recruitingAssistantContentLoaded = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "FEISHU_APPLY_HEADING_NUMBERING") {
      handleFeishuHeadingNumberingMessage(message, { root: document, url: location.href })
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false, reason: "page-unavailable", error: "飞书页面自动编号失败。" }));
      return true;
    }

    if (message?.type === "RECRUITING_ASSISTANT_DIAGNOSE") {
      sendResponse({ ok: true, diagnostics: collectPageDiagnostics(document) });
      return false;
    }

    if (message?.type === "RECRUITING_ASSISTANT_RECORD_START") {
      sendResponse({ ok: true, recording: startClickRecording(document, message.options) });
      return false;
    }

    if (message?.type === "RECRUITING_ASSISTANT_RECORD_COLLECT") {
      const recording = collectClickRecording(document);
      stopClickRecording(document);
      sendResponse({ ok: true, recording });
      return false;
    }

    if (message?.type !== "RECRUITING_ASSISTANT_FILL") return false;

    fillRecruitingForm(message.payload, document, { platform: message.platform })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      });

    return true;
  });
}
