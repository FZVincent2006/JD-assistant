import {
  readOutlookMailViaGui,
  triggerOutlookAttachmentDownload
} from "./outlookMailDetail.js";

const TARGET_ORIGIN = "https://partner.outlook.cn";
const TARGET_MAILBOX = "recruiting@zhenfund.com";
const TARGET_FOLDER = "个人投递（需提醒）";
const MAX_SENDER_LENGTH = 120;
const MAX_EMAIL_LENGTH = 254;
const MAX_SUBJECT_LENGTH = 240;
const MAX_TIME_LENGTH = 80;

export function extractOutlookMailRows(root = document) {
  return [...root.querySelectorAll('[role="option"][data-convid]')]
    .map(extractMailRow)
    .filter(Boolean);
}

export function getOutlookPageState(root = document, url = location.href) {
  const supported = isSupportedOutlookUrl(url);
  const detectedMailbox = findMailbox(root);
  const folder = findSelectedFolder(root);
  const visibleMailRows = root.querySelectorAll('[role="option"][data-convid]').length > 0;
  const inferredTargetMailbox = !detectedMailbox
    && folder === TARGET_FOLDER
    && visibleMailRows;
  const mailbox = detectedMailbox || (inferredTargetMailbox ? TARGET_MAILBOX : "");
  const loggedIn = supported && Boolean(mailbox);

  return {
    supported,
    mailbox,
    folder,
    loggedIn,
    targetMailbox: mailbox.toLowerCase() === TARGET_MAILBOX,
    targetFolder: folder === TARGET_FOLDER
  };
}

export function startOutlookMonitor({
  root = document,
  url = location.href,
  chromeApi = chrome,
  createObserver = (callback) => new MutationObserver(callback),
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  let scanTimer = null;
  let detailReadInProgress = false;

  const buildScanResult = (reason) => ({
    ok: true,
    type: "OUTLOOK_SCAN_RESULT",
    reason,
    page: getOutlookPageState(root, url),
    mails: extractOutlookMailRows(root)
  });

  const sendScan = (reason) => {
    const result = buildScanResult(reason);
    Promise.resolve(chromeApi.runtime.sendMessage(result)).catch(() => {
      // The service worker may still be waking. The periodic alarm will ask again.
    });
  };

  const scheduleScan = (reason, delayMs) => {
    if (scanTimer != null) clearTimer(scanTimer);
    scanTimer = setTimer(() => {
      scanTimer = null;
      sendScan(reason);
    }, delayMs);
  };

  const messageListener = (message, _sender, sendResponse) => {
    if (message?.type === "OUTLOOK_SCAN_REQUEST") {
      sendResponse(buildScanResult(message.reason || "request"));
      return false;
    }
    if (message?.type === "OUTLOOK_READ_MAIL_DETAIL") {
      detailReadInProgress = true;
      readOutlookMailViaGui({ root, mail: message.mail })
        .then((detail) => sendResponse({ ok: true, detail }))
        .catch((error) => sendResponse({
          ok: false,
          error: "无法从 Outlook 页面读取该邮件。",
          stage: error?.stage || "outlook-gui-detail"
        }))
        .finally(() => {
          detailReadInProgress = false;
        });
      return true;
    }
    if (message?.type === "OUTLOOK_TRIGGER_ATTACHMENT_DOWNLOAD") {
      detailReadInProgress = true;
      triggerOutlookAttachmentDownload({
        root,
        mail: message.mail,
        name: message.name
      })
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({
          ok: false,
          error: "无法触发 Outlook 附件下载。",
          stage: error?.stage || "outlook-gui-attachment-download-action"
        }))
        .finally(() => {
          detailReadInProgress = false;
        });
      return true;
    }
    return false;
  };

  chromeApi.runtime.onMessage.addListener(messageListener);
  const observer = createObserver(() => {
    if (!detailReadInProgress) scheduleScan("mutation", 3000);
  });
  observer.observe(root.body ?? root.documentElement, {
    childList: true,
    subtree: true
  });
  const scanOnResume = () => {
    if (!detailReadInProgress) scheduleScan("resume", 250);
  };
  root.addEventListener?.("visibilitychange", scanOnResume);
  root.defaultView?.addEventListener?.("focus", scanOnResume);
  root.defaultView?.addEventListener?.("pageshow", scanOnResume);
  root.defaultView?.addEventListener?.("online", scanOnResume);
  scheduleScan("page_load", 0);

  return () => {
    if (scanTimer != null) clearTimer(scanTimer);
    observer.disconnect();
    root.removeEventListener?.("visibilitychange", scanOnResume);
    root.defaultView?.removeEventListener?.("focus", scanOnResume);
    root.defaultView?.removeEventListener?.("pageshow", scanOnResume);
    root.defaultView?.removeEventListener?.("online", scanOnResume);
    try {
      chromeApi.runtime.onMessage.removeListener(messageListener);
    } catch {
      // The previous extension context can already be invalid after an update.
    }
  };
}

function extractMailRow(row) {
  const liveSender = findLiveSender(row);
  const liveReceivedTime = findLiveReceivedTime(row);
  const liveSubject = findLiveSubject(row, liveReceivedTime?.element);
  const conversationId = sanitize(row.getAttribute("data-convid"), 180);
  const senderName = sanitize(
    row.getAttribute("data-sender-name") || textFrom(row, [
      '[data-automationid="sender"]',
      '[data-testid="sender"]',
      '[class*="sender"]'
    ]) || liveSender?.textContent,
    MAX_SENDER_LENGTH
  );
  const senderEmail = sanitize(
    row.getAttribute("data-sender-email") || attributeFrom(row, [
      '[data-automationid="sender"][data-email]',
      '[data-testid="sender"][data-email]'
    ], "data-email") || liveSender?.getAttribute("title"),
    MAX_EMAIL_LENGTH
  ).toLowerCase();
  const subject = sanitize(
    row.getAttribute("data-subject") || textFrom(row, [
      '[data-automationid="subject"]',
      '[data-testid="subject"]',
      '[class*="subject"]'
    ]) || liveSubject?.textContent,
    MAX_SUBJECT_LENGTH
  );
  const timeElement = row.querySelector(
    'time, [data-automationid="receivedTime"], [data-testid="received-time"], [class*="receivedTime"]'
  );
  const receivedTime = sanitize(
    row.getAttribute("data-received-time") ||
      timeElement?.getAttribute("datetime") ||
      timeElement?.getAttribute("title") ||
      timeElement?.textContent ||
      liveReceivedTime?.value,
    MAX_TIME_LENGTH
  );
  const attachmentValue = row.getAttribute("data-has-attachment");
  const hasAttachment = attachmentValue == null
    ? Boolean(row.querySelector('[data-icon-name*="Attach"], [aria-label*="附件"], [title*="附件"]')) ||
      /\bhas attachments?\b/i.test(row.getAttribute("aria-label") || "") ||
      (row.getAttribute("aria-label") || "").includes("带附件")
    : attachmentValue === "true";

  if (!conversationId || !subject || !receivedTime) return null;

  return {
    conversationId,
    senderName,
    senderEmail,
    subject,
    receivedTime,
    hasAttachment
  };
}

function findMailbox(root) {
  for (const link of root.querySelectorAll('a[href*="username="]')) {
    try {
      const username = new URL(link.href).searchParams.get("username");
      if (looksLikeEmail(username)) return sanitize(username, MAX_EMAIL_LENGTH).toLowerCase();
    } catch {
      // Ignore malformed shell links.
    }
  }

  const accountNode = root.querySelector(
    '[data-automationid="account-email"], [data-testid="account-email"], [aria-label*="@"]'
  );
  const match = String(accountNode?.textContent || accountNode?.getAttribute("aria-label") || "")
    .match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? sanitize(match[0], MAX_EMAIL_LENGTH).toLowerCase() : "";
}

function findSelectedFolder(root) {
  const selected = root.querySelector(
    '[role="treeitem"][aria-selected="true"], [role="treeitem"][data-is-selected="true"], [role="treeitem"][aria-current="page"]'
  );
  const folderName = sanitize(selected?.getAttribute("data-folder-name"), 120);
  if (folderName) return folderName;

  const visibleText = sanitize(selected?.textContent, 120);
  if (visibleText.includes(TARGET_FOLDER)) return TARGET_FOLDER;
  const selectedText = visibleText.replace(/\s*\d+\s*未读.*$/u, "").replace(/\s*已选择.*$/u, "");

  // New Outlook layouts can collapse the folder tree and expose the open
  // folder only in the message-list heading. Do not accept a matching label
  // from an unselected tree item, because the user may have another folder open.
  const headingCandidates = root.querySelectorAll(
    '[role="heading"], h1, h2, h3, [data-folder-name], [title], [aria-label]'
  );
  for (const candidate of headingCandidates) {
    const treeItem = candidate.closest?.('[role="treeitem"]');
    if (treeItem && treeItem.getAttribute("aria-selected") !== "true"
      && treeItem.getAttribute("data-is-selected") !== "true"
      && treeItem.getAttribute("aria-current") !== "page") continue;
    if (candidate.closest?.('[hidden], [aria-hidden="true"]')) continue;
    const labels = [
      candidate.getAttribute?.("data-folder-name"),
      candidate.getAttribute?.("title"),
      candidate.getAttribute?.("aria-label"),
      candidate.textContent
    ];
    if (labels.some((value) => sanitize(value, 120).includes(TARGET_FOLDER))) return TARGET_FOLDER;
  }

  if (sanitize(root.title, 240).includes(TARGET_FOLDER)) return TARGET_FOLDER;
  return selectedText;
}

function findLiveSender(row) {
  return [...row.querySelectorAll("span[title]")]
    .find((element) => looksLikeEmail(element.getAttribute("title")));
}

function findLiveSubject(row, receivedTimeElement) {
  const candidates = [...row.querySelectorAll('span[title=""]')]
    .filter((element) => sanitize(directText(element), MAX_SUBJECT_LENGTH));
  if (candidates.length === 1) return candidates[0];

  const heading = receivedTimeElement?.parentElement;
  if (!heading) return null;
  const structuralCandidates = [...heading.querySelectorAll("span")]
    .filter((element) => element !== receivedTimeElement)
    .filter((element) => sanitize(directText(element), MAX_SUBJECT_LENGTH))
    .filter((element) => !looksLikeEmail(element.getAttribute("title")))
    .filter((element) => !normalizeReceivedTimeCandidate(element.getAttribute("title")));
  return structuralCandidates.length === 1 ? structuralCandidates[0] : null;
}

function findLiveReceivedTime(row) {
  for (const element of row.querySelectorAll("span[title]")) {
    const receivedTime = normalizeReceivedTimeCandidate(element.getAttribute("title"));
    if (receivedTime) return { element, value: receivedTime };
  }
  return null;
}

function textFrom(root, selectors) {
  for (const selector of selectors) {
    const text = root.querySelector(selector)?.textContent;
    if (sanitize(text, MAX_SUBJECT_LENGTH)) return text;
  }
  return "";
}

function attributeFrom(root, selectors, attribute) {
  for (const selector of selectors) {
    const value = root.querySelector(selector)?.getAttribute(attribute);
    if (value) return value;
  }
  return "";
}

function sanitize(value, maxLength) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

function normalizeReceivedTimeCandidate(value) {
  const text = String(value || "").trim();
  return text.match(/\d{4}年\d{1,2}月\d{1,2}日(?:星期.)?\s*\d{1,2}:\d{2}/u)?.[0] ||
    text.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T\s]\d{1,2}:\d{2})?/)?.[0] ||
    "";
}

function directText(element) {
  return [...(element?.childNodes || [])]
    .filter((node) => node.nodeType === 3)
    .map((node) => node.textContent)
    .join(" ");
}

function isSupportedOutlookUrl(url) {
  try {
    const candidate = new URL(url);
    return candidate.origin === TARGET_ORIGIN && candidate.pathname.startsWith("/mail");
  } catch {
    return false;
  }
}

const outlookMonitorScriptVersion = typeof chrome !== "undefined"
  ? chrome.runtime?.getManifest?.().version || "development"
  : "development";

if (
  typeof chrome !== "undefined" &&
  typeof document !== "undefined" &&
  isSupportedOutlookUrl(globalThis.location?.href) &&
  globalThis.__recruitingAssistantOutlookMonitorVersion !== outlookMonitorScriptVersion
) {
  try {
    globalThis.__recruitingAssistantOutlookMonitorCleanup?.();
  } catch {
    // Ignore cleanup from an invalidated extension context.
  }
  globalThis.__recruitingAssistantOutlookMonitorVersion = outlookMonitorScriptVersion;
  globalThis.__recruitingAssistantOutlookMonitorCleanup = startOutlookMonitor();
}
