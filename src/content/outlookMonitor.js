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
  const mailbox = findMailbox(root);
  const folder = findSelectedFolder(root);
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
    if (message?.type !== "OUTLOOK_SCAN_REQUEST") return false;
    sendResponse(buildScanResult(message.reason || "request"));
    return false;
  };

  chromeApi.runtime.onMessage.addListener(messageListener);
  const observer = createObserver(() => scheduleScan("mutation", 3000));
  observer.observe(root.body ?? root.documentElement, {
    childList: true,
    subtree: true
  });
  scheduleScan("page_load", 0);

  return () => {
    if (scanTimer != null) clearTimer(scanTimer);
    observer.disconnect();
    chromeApi.runtime.onMessage.removeListener(messageListener);
  };
}

function extractMailRow(row) {
  const conversationId = sanitize(row.getAttribute("data-convid"), 180);
  const senderName = sanitize(
    row.getAttribute("data-sender-name") || textFrom(row, [
      '[data-automationid="sender"]',
      '[data-testid="sender"]',
      '[class*="sender"]'
    ]),
    MAX_SENDER_LENGTH
  );
  const senderEmail = sanitize(
    row.getAttribute("data-sender-email") || attributeFrom(row, [
      '[data-automationid="sender"][data-email]',
      '[data-testid="sender"][data-email]'
    ], "data-email"),
    MAX_EMAIL_LENGTH
  ).toLowerCase();
  const subject = sanitize(
    row.getAttribute("data-subject") || textFrom(row, [
      '[data-automationid="subject"]',
      '[data-testid="subject"]',
      '[class*="subject"]'
    ]),
    MAX_SUBJECT_LENGTH
  );
  const timeElement = row.querySelector(
    'time, [data-automationid="receivedTime"], [data-testid="received-time"], [class*="receivedTime"]'
  );
  const receivedTime = sanitize(
    row.getAttribute("data-received-time") ||
      timeElement?.getAttribute("datetime") ||
      timeElement?.getAttribute("title") ||
      timeElement?.textContent,
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
    '[role="treeitem"][aria-selected="true"], [role="treeitem"][data-is-selected="true"]'
  );
  return sanitize(selected?.textContent, 120).replace(/\s+\d+\s*未读.*$/u, "").replace(/\s+已选择.*$/u, "");
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

function isSupportedOutlookUrl(url) {
  try {
    const candidate = new URL(url);
    return candidate.origin === TARGET_ORIGIN && candidate.pathname.startsWith("/mail");
  } catch {
    return false;
  }
}

if (
  typeof chrome !== "undefined" &&
  typeof document !== "undefined" &&
  isSupportedOutlookUrl(globalThis.location?.href) &&
  !globalThis.__recruitingAssistantOutlookMonitorLoaded
) {
  globalThis.__recruitingAssistantOutlookMonitorLoaded = true;
  startOutlookMonitor();
}
