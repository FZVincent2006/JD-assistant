import { parseOutlookReceivedTime } from "./outlookMonitorCore.js";

const GRAPH_ORIGIN = "https://microsoftgraph.chinacloudapi.cn";
const TARGET_MAILBOX = "recruiting@zhenfund.com";
const TARGET_FOLDER = "个人投递（需提醒）";
const MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 60 * 1024 * 1024;
const MAX_BODY_CHARS = 12_000;
const ALLOWED_EXTENSIONS = new Set(["pdf", "doc", "docx"]);

export class OutlookGraphClientError extends Error {
  constructor(message, { status = 0, code = "", stage = "outlook-graph-api" } = {}) {
    super(message);
    this.name = "OutlookGraphClientError";
    Object.assign(this, { status, code, stage });
  }
}

export function createOutlookGraphClient({
  fetchImpl = fetch,
  getAccessToken,
  mailbox = TARGET_MAILBOX,
  folderName = TARGET_FOLDER
} = {}) {
  if (typeof getAccessToken !== "function") throw new TypeError("getAccessToken is required");
  let cachedFolderId = "";

  async function loadMail(mail) {
    const folderId = cachedFolderId || await findFolderId();
    cachedFolderId = folderId;
    const message = await findMatchingMessage(folderId, mail);
    const body = message.body?.contentType?.toLowerCase() === "html"
      ? htmlToPlainText(message.body.content)
      : normalizeText(message.body?.content);
    const attachmentResult = message.hasAttachments
      ? await loadAttachments(message.id)
      : { attachments: [], skippedAttachments: [] };
    return {
      messageId: message.id,
      body: truncateBody(body),
      bodyTruncated: body.length > MAX_BODY_CHARS,
      ...attachmentResult
    };
  }

  async function findFolderId() {
    const data = await requestJson(`/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders`, {
      query: {
        "$select": "id,displayName",
        "$filter": `displayName eq '${escapeOData(folderName)}'`,
        "$top": 25
      },
      stage: "outlook-folder"
    });
    const matches = (data.value || []).filter((folder) => folder?.displayName === folderName);
    if (matches.length !== 1 || !matches[0]?.id) {
      throw new OutlookGraphClientError("Outlook target folder was not found", {
        stage: "outlook-folder"
      });
    }
    return matches[0].id;
  }

  async function findMatchingMessage(folderId, mail) {
    const data = await requestJson(
      `/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders/${encodeURIComponent(folderId)}/messages`,
      {
        query: {
          "$select": "id,subject,receivedDateTime,from,body,hasAttachments",
          "$orderby": "receivedDateTime desc",
          "$top": 50
        },
        stage: "outlook-message"
      }
    );
    const candidates = (data.value || []).filter((message) => mailMatches(message, mail));
    if (!candidates.length) {
      throw new OutlookGraphClientError("Outlook message content was not found", {
        stage: "outlook-message"
      });
    }
    return candidates[0];
  }

  async function loadAttachments(messageId) {
    const data = await requestJson(
      `/v1.0/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}/attachments`,
      {
        query: { "$select": "id,name,contentType,size,isInline" },
        stage: "outlook-attachments"
      }
    );
    const attachments = [];
    const skippedAttachments = [];
    let totalBytes = 0;

    for (const item of data.value || []) {
      const name = sanitizeFileName(item?.name);
      if (!item?.id || !isAllowedResumeAttachment(item)) {
        if (name && !item?.isInline) skippedAttachments.push({ name, reason: "unsupported" });
        continue;
      }
      if (totalBytes + Number(item.size || 0) > MAX_TOTAL_ATTACHMENT_BYTES) {
        skippedAttachments.push({ name, reason: "total-size" });
        continue;
      }
      const bytes = await requestBytes(
        `/v1.0/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}` +
          `/attachments/${encodeURIComponent(item.id)}/$value`,
        "outlook-attachment-download"
      );
      totalBytes += bytes.byteLength;
      attachments.push({
        id: String(item.id || "").slice(0, 512),
        name,
        contentType: String(item.contentType || "application/octet-stream").slice(0, 180),
        size: bytes.byteLength,
        bytes
      });
    }
    return { attachments, skippedAttachments };
  }

  async function requestJson(path, { query = {}, stage }) {
    const response = await request(path, { query, stage });
    const payload = await response.json().catch(() => ({}));
    if (!payload || typeof payload !== "object") {
      throw new OutlookGraphClientError("Outlook Graph response is incomplete", { stage });
    }
    return payload;
  }

  async function requestBytes(path, stage) {
    const response = await request(path, { stage, accept: "*/*" });
    const buffer = await response.arrayBuffer();
    if (!buffer?.byteLength) {
      throw new OutlookGraphClientError("Outlook attachment was empty", { stage });
    }
    if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new OutlookGraphClientError("Outlook attachment exceeds the Feishu limit", { stage });
    }
    return new Uint8Array(buffer);
  }

  async function request(path, { query = {}, stage, accept = "application/json" }) {
    const token = await getAccessToken();
    const url = new URL(path, GRAPH_ORIGIN);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    let response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: accept
        }
      });
    } catch {
      throw new OutlookGraphClientError("Outlook Graph request failed", { stage });
    }
    if (!response.ok) {
      const payload = await response.json?.().catch(() => ({}));
      throw new OutlookGraphClientError("Outlook Graph request was rejected", {
        status: response.status,
        code: String(payload?.error?.code || ""),
        stage
      });
    }
    return response;
  }

  return { loadMail };
}

export function isAllowedResumeAttachment(attachment) {
  const name = String(attachment?.name || "");
  const extension = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  const size = Number(attachment?.size || 0);
  return Boolean(
    !attachment?.isInline &&
    ALLOWED_EXTENSIONS.has(extension) &&
    size > 0 &&
    size <= MAX_ATTACHMENT_BYTES &&
    (!attachment?.["@odata.type"] || attachment["@odata.type"] === "#microsoft.graph.fileAttachment")
  );
}

export function htmlToPlainText(value) {
  return normalizeText(String(value || "")
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|tr|h[1-6])\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'"));
}

function mailMatches(message, mail) {
  if (normalizeComparable(message?.subject) !== normalizeComparable(mail?.subject)) return false;
  const expectedSender = String(mail?.senderEmail || "").trim().toLowerCase();
  const actualSender = String(message?.from?.emailAddress?.address || "").trim().toLowerCase();
  if (expectedSender && actualSender && expectedSender !== actualSender) return false;
  const expectedTime = parseOutlookReceivedTime(mail?.receivedTime);
  const actualTime = Date.parse(message?.receivedDateTime || "");
  if (expectedTime != null && Number.isFinite(actualTime)) {
    return Math.abs(expectedTime - actualTime) <= 10 * 60 * 1000;
  }
  return true;
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function truncateBody(value) {
  return String(value || "").slice(0, MAX_BODY_CHARS);
}

function normalizeComparable(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function escapeOData(value) {
  return String(value || "").replace(/'/g, "''");
}

function sanitizeFileName(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "_")
    .trim()
    .slice(0, 180);
}
