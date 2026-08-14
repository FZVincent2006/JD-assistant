import { createOutlookPageBridge } from "./outlookPageBridge.js";

const OUTLOOK_TAB_QUERY = "https://partner.outlook.cn/mail/*";
const MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 60 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["pdf", "doc", "docx", "png", "jpg", "jpeg", "webp"]);
const RECENT_RETRY_DOWNLOAD_WINDOW_MS = 30 * 60 * 1000;

export class OutlookGuiClientError extends Error {
  constructor(message, { stage = "outlook-gui-client" } = {}) {
    super(message);
    this.name = "OutlookGuiClientError";
    this.stage = stage;
  }
}

export function createOutlookGuiClient({
  chromeApi = chrome,
  pageBridge = createOutlookPageBridge({ chromeApi }),
  downloadedFileReader = null,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  downloadTimeoutMs = 20_000
} = {}) {
  async function loadMail(mail) {
    const recoveredBeforeDetail = mail?.hasAttachment && mail?.reuseRecentAttachmentDownload
      ? await recoverRecentDownloadsWithoutMetadata({
          since: Number(mail?.attachmentSearchSince || 0) || now() - RECENT_RETRY_DOWNLOAD_WINDOW_MS,
          until: Number(mail?.attachmentSearchUntil || 0) || now()
        })
      : [];
    const tabs = await chromeApi.tabs.query({ url: OUTLOOK_TAB_QUERY });
    const tab = tabs.find((candidate) => candidate?.id);
    if (!tab) {
      throw new OutlookGuiClientError("Outlook tab was not found", {
        stage: "outlook-gui-tab"
      });
    }

    let detailResult;
    try {
      detailResult = await pageBridge.send(tab.id, {
        type: "OUTLOOK_READ_MAIL_DETAIL",
        mail
      });
    } catch (error) {
      throw new OutlookGuiClientError("Outlook page did not return mail detail", {
        stage: error?.stage || "outlook-gui-detail"
      });
    }
    if (!detailResult?.ok || !detailResult.detail) {
      throw new OutlookGuiClientError("Outlook page did not return mail detail", {
        stage: detailResult?.stage || "outlook-gui-detail"
      });
    }

    const attachments = [];
    const skippedAttachments = [];
    const metadata = dedupeAttachmentMetadata([
      ...(detailResult.detail.attachments || []),
      ...(detailResult.detail.skippedAttachments || [])
    ]);
    let totalBytes = 0;
    let retryableAttachmentFailure = false;
    if (recoveredBeforeDetail.length) {
      attachments.push(...recoveredBeforeDetail);
      totalBytes += recoveredBeforeDetail.reduce((sum, attachment) => sum + attachment.size, 0);
    }
    const metadataToDownload = attachments.length ? [] : metadata;
    for (const item of metadataToDownload) {
      const name = sanitizeFileName(item?.name);
      if (!isAllowedResumeAttachment(item)) {
        if (name) skippedAttachments.push({ name, reason: "unsupported" });
        continue;
      }
      if (item.size && totalBytes + Number(item.size) > MAX_TOTAL_ATTACHMENT_BYTES) {
        skippedAttachments.push({ name, reason: "total-size" });
        continue;
      }
      try {
        const downloaded = await downloadRealAttachment({
          tabId: tab.id,
          mail,
          item: { ...item, name }
        });
        const bytes = downloaded.bytes;
        if (totalBytes + bytes.byteLength > MAX_TOTAL_ATTACHMENT_BYTES) {
          skippedAttachments.push({ name, reason: "total-size" });
          continue;
        }
        totalBytes += bytes.byteLength;
        attachments.push({
          id: String(item.id || `${attachments.length}-${name}`).slice(0, 512),
          name,
          contentType: contentTypeFor(name),
          size: bytes.byteLength,
          bytes,
          localRef: downloaded.localRef
        });
      } catch (error) {
        retryableAttachmentFailure = true;
        skippedAttachments.push({
          name,
          reason: "download-failed",
          stage: String(error?.stage || "outlook-browser-download")
        });
      }
    }
    if (attachments.length) retryableAttachmentFailure = false;
    if (mail?.hasAttachment && !metadata.length && !attachments.length) {
      retryableAttachmentFailure = true;
      skippedAttachments.push({
        name: "邮件中的简历附件",
        reason: "control-not-found",
        stage: "outlook-gui-attachment-control"
      });
    }

    return {
      body: String(detailResult.detail.body || "").slice(0, 12_000),
      bodyTruncated: Boolean(detailResult.detail.bodyTruncated),
      attachments,
      skippedAttachments,
      retryableAttachmentFailure
    };
  }

  async function recoverRecentDownloadsWithoutMetadata({
    since = now() - RECENT_RETRY_DOWNLOAD_WINDOW_MS,
    until = now()
  } = {}) {
    if (typeof downloadedFileReader?.read !== "function") return [];
    const candidates = await recentCompletedDownloads({ since, until });
    const groups = new Map();
    for (const candidate of candidates) {
      const name = sanitizeFileName(fileNameFromPath(candidate.filename));
      if (!isAllowedResumeAttachment({ name, size: Number(candidate.totalBytes || 0) })) continue;
      const key = normalizedDownloadedName(name);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ ...candidate, name });
    }
    const recovered = [];
    for (const group of groups.values()) {
      const download = group.sort((first, second) =>
        (Date.parse(second.startTime || "") || 0) - (Date.parse(first.startTime || "") || 0)
      )[0];
      try {
        const bytes = await downloadedFileReader.read({
          path: download.filename,
          name: download.name,
          expectedSize: Number(download.totalBytes || 0)
        });
        validateDownloadedAttachment({
          name: download.name,
          bytes,
          expectedSize: Number(download.totalBytes || 0),
          contentType: contentTypeFor(download.name)
        });
        recovered.push({
          id: `recovered-${normalizedDownloadedName(download.name)}`.slice(0, 512),
          name: download.name,
          contentType: contentTypeFor(download.name),
          size: bytes.byteLength,
          bytes,
          localRef: localAttachmentRef(download, download.name, bytes.byteLength)
        });
      } catch {}
    }
    return recovered;
  }

  async function recoverDownloadedAttachments({ since = 0, until = now() } = {}) {
    return recoverRecentDownloadsWithoutMetadata({ since, until });
  }

  async function restorePreparedDetail(snapshot) {
    const attachments = [];
    for (const ref of snapshot?.attachmentRefs || []) {
      const bytes = await downloadedFileReader.read({
        path: ref.path,
        name: ref.name,
        expectedSize: Number(ref.expectedSize || 0)
      });
      validateDownloadedAttachment({
        name: ref.name,
        bytes,
        expectedSize: Number(ref.expectedSize || 0),
        contentType: ref.contentType || contentTypeFor(ref.name)
      });
      attachments.push({
        id: String(ref.id || `restored-${attachments.length}`).slice(0, 512),
        name: ref.name,
        contentType: ref.contentType || contentTypeFor(ref.name),
        size: bytes.byteLength,
        bytes,
        localRef: { ...ref }
      });
    }
    return {
      body: String(snapshot?.body || "").slice(0, 12_000),
      bodyTruncated: Boolean(snapshot?.bodyTruncated),
      attachments,
      skippedAttachments: [...(snapshot?.skippedAttachments || [])],
      retryableAttachmentFailure: false
    };
  }

  async function downloadRealAttachment({ tabId, mail, item }) {
    if (!downloadedFileReader || !chromeApi.downloads?.onCreated || !chromeApi.downloads?.onChanged) {
      throw new OutlookGuiClientError("Chrome download monitoring is unavailable", {
        stage: "outlook-browser-download-unavailable"
      });
    }
    if (mail?.reuseRecentAttachmentDownload) {
      const recentDownload = await findRecentCompletedDownload({
        name: item.name,
        expectedSize: Number(item.size || 0),
        since: now() - RECENT_RETRY_DOWNLOAD_WINDOW_MS
      });
      if (recentDownload) {
        try {
          return await readValidateDownload(recentDownload, item);
        } catch {}
      }
    }
    const completion = waitForChromeDownload({
      name: item.name,
      startedAt: now(),
      timeoutMs: downloadTimeoutMs
    });
    let trigger;
    try {
      trigger = await pageBridge.send(tabId, {
        type: "OUTLOOK_TRIGGER_ATTACHMENT_DOWNLOAD",
        mail,
        name: item.name
      });
    } catch {
      completion.cancel();
      await completion.promise.catch(() => {});
      throw new OutlookGuiClientError("Outlook download action failed", {
        stage: "outlook-gui-attachment-download-action"
      });
    }
    if (!trigger?.ok) {
      completion.cancel();
      await completion.promise.catch(() => {});
      throw new OutlookGuiClientError("Outlook download action failed", {
        stage: trigger?.stage || "outlook-gui-attachment-download-action"
      });
    }
    void completion.checkNow();
    const download = await completion.promise;
    return readValidateDownload(download, {
      ...item,
      size: Number(item.size || trigger.size || 0)
    });
  }

  async function readValidateDownload(download, item) {
    const readFile = downloadedFileReader.read || downloadedFileReader.readAndDelete;
    const bytes = await readFile({
      path: download.filename,
      name: item.name,
      expectedSize: Number(item.size || 0)
    });
    validateDownloadedAttachment({
      name: item.name,
      bytes,
      expectedSize: Number(item.size || 0),
      contentType: contentTypeFor(item.name)
    });
    return {
      bytes,
      localRef: localAttachmentRef(download, item.name, bytes.byteLength, item.id)
    };
  }

  async function findRecentCompletedDownload({ name, expectedSize, since }) {
    const matches = await recentCompletedDownloads({ since });
    return matches.find((candidate) => {
        const started = Date.parse(candidate?.startTime || "") || 0;
        const downloadedSize = Number(candidate?.totalBytes || candidate?.bytesReceived || 0);
        return candidate?.state === "complete"
          && candidate?.exists !== false
          && started >= since
          && downloadedNamesMatch(candidate?.filename, name)
          && downloadedSizesMatch(downloadedSize, expectedSize);
      }) || null;
  }

  async function recentCompletedDownloads({ since, until = now() }) {
    let browserMatches = [];
    try {
      browserMatches = await chromeApi.downloads.search({
        orderBy: ["-startTime"],
        limit: 50
      });
    } catch {}
    let nativeMatches = [];
    if (typeof downloadedFileReader?.listRecent === "function") {
      try {
        nativeMatches = await downloadedFileReader.listRecent({ since, until });
      } catch {}
    }
    const seen = new Set();
    return [...(browserMatches || []), ...(nativeMatches || [])].filter((candidate) => {
      const started = Date.parse(candidate?.startTime || "") || 0;
      const path = String(candidate?.filename || "");
      if (candidate?.state !== "complete"
        || candidate?.exists === false
        || started < since
        || started > until
        || !ALLOWED_EXTENSIONS.has(extensionFromName(path))
        || seen.has(path)) return false;
      seen.add(path);
      return true;
    });
  }

  function waitForChromeDownload({ name, startedAt, timeoutMs }) {
    let targetId = null;
    let settled = false;
    let pollId = null;
    let rejectPromise;
    const cleanup = () => {
      chromeApi.downloads.onCreated.removeListener(onCreated);
      chromeApi.downloads.onChanged.removeListener(onChanged);
      clearTimer(timeoutId);
      if (pollId != null) clearTimer(pollId);
    };
    const finish = async (resolve, reject, id) => {
      if (settled) return;
      try {
        const matches = await chromeApi.downloads.search({ id });
        const item = matches?.[0];
        if (!isMatchingTriggeredDownload(item, name)) return;
        settled = true;
        cleanup();
        resolve(item);
      } catch {
        settled = true;
        cleanup();
        reject(new OutlookGuiClientError("Chrome download could not be inspected", {
          stage: "outlook-browser-download-inspection"
        }));
      }
    };
    let resolvePromise;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const onCreated = (item) => {
      const started = Date.parse(item?.startTime || "") || now();
      if (started < startedAt - 1_000 || !isMatchingTriggeredDownload(item, name)) return;
      if (targetId == null) targetId = item.id;
      if (item.id !== targetId) return;
      if (item.state === "complete") void finish(resolvePromise, rejectPromise, item.id);
    };
    const onChanged = (delta) => {
      if (delta?.id !== targetId) return;
      if (delta?.error?.current) {
        if (!settled) {
          settled = true;
          cleanup();
          rejectPromise(new OutlookGuiClientError("Chrome download failed", {
            stage: "outlook-browser-download-failed"
          }));
        }
        return;
      }
      if (delta?.state?.current === "complete") {
        void finish(resolvePromise, rejectPromise, delta.id);
      }
    };
    chromeApi.downloads.onCreated.addListener(onCreated);
    chromeApi.downloads.onChanged.addListener(onChanged);
    const checkNow = async () => {
      if (settled) return;
      try {
        const matches = await chromeApi.downloads.search({
          orderBy: ["-startTime"],
          limit: 50
        });
        const item = (matches || []).find((candidate) => {
          const started = Date.parse(candidate?.startTime || "") || 0;
          return candidate?.state === "complete"
            && started >= startedAt - 1_000
            && isMatchingTriggeredDownload(candidate, name);
        });
        if (item) {
          targetId = item.id;
          await finish(resolvePromise, rejectPromise, item.id);
          return;
        }
      } catch {}
      if (!settled) pollId = setTimer(() => void checkNow(), 250);
    };
    pollId = setTimer(() => void checkNow(), 250);
    const timeoutId = setTimer(() => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectPromise(new OutlookGuiClientError("Chrome download timed out", {
        stage: "outlook-browser-download-timeout"
      }));
    }, timeoutMs);
    return {
      promise,
      checkNow,
      cancel() {
        if (settled) return;
        settled = true;
        cleanup();
        rejectPromise(new OutlookGuiClientError("Chrome download was cancelled", {
          stage: "outlook-browser-download-cancelled"
        }));
      }
    };
  }

  return { loadMail, recoverDownloadedAttachments, restorePreparedDetail };
}

function localAttachmentRef(download, displayName, actualSize, id = "") {
  return {
    id: String(id || download?.id || "attachment").slice(0, 512),
    path: String(download?.filename || "").slice(0, 2_048),
    name: sanitizeFileName(displayName),
    contentType: contentTypeFor(displayName),
    expectedSize: Number(actualSize || download?.totalBytes || 0)
  };
}

function downloadedNamesMatch(path, expectedName) {
  return normalizedDownloadedName(path) === normalizedDownloadedName(expectedName);
}

function normalizedDownloadedName(value) {
  return fileNameFromPath(value)
    .replace(/\s+\(\d+\)(?=\.[^.]+$)/, "")
    .normalize("NFKC")
    .toLowerCase();
}

function fileNameFromPath(value) {
  return String(value || "").split(/[\\/]/).pop();
}

function extensionFromName(value) {
  const name = fileNameFromPath(value);
  return name.includes(".") ? name.split(".").pop().toLowerCase() : "";
}

function downloadedSizesMatch(actualSize, expectedSize) {
  const actual = Number(actualSize || 0);
  const expected = Number(expectedSize || 0);
  if (actual < 1024 || expected < 1024) return true;
  return actual >= expected * 0.5 && actual <= expected * 1.5;
}

function contentTypeFor(name) {
  const extension = String(name || "").split(".").pop().toLowerCase();
  if (extension === "pdf") return "application/pdf";
  if (extension === "doc") return "application/msword";
  if (extension === "docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  return "application/octet-stream";
}

function dedupeAttachmentMetadata(items) {
  const seen = new Set();
  return (items || []).filter((item) => {
    const name = sanitizeFileName(item?.name);
    const key = name.normalize("NFKC").toLowerCase();
    if (!name || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function validateDownloadedAttachment({ name, bytes, expectedSize = 0, contentType = "" }) {
  const extension = String(name || "").split(".").pop().toLowerCase();
  const type = String(contentType || "").toLowerCase();
  if (/^(?:text\/html|application\/(?:json|xml))\b/.test(type)) {
    throw new OutlookGuiClientError("Outlook returned a page instead of the attachment", {
      stage: "outlook-gui-attachment-content"
    });
  }

  const imageExtension = ["png", "jpg", "jpeg", "webp"].includes(extension);
  const validSignature = extension === "pdf"
    ? startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])
    : extension === "doc"
      ? startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
      : extension === "docx"
        ? startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])
        : imageExtension
          ? isSupportedImageSignature(bytes)
          : false;
  if (!validSignature) {
    throw new OutlookGuiClientError("Outlook returned invalid attachment bytes", {
      stage: "outlook-gui-attachment-content"
    });
  }

  const actualSize = Number(bytes?.byteLength || 0);
  const declaredSize = Number(expectedSize || 0);
  if (declaredSize >= 1024
    && (actualSize < declaredSize * 0.5 || actualSize > declaredSize * 1.5)) {
    throw new OutlookGuiClientError("Outlook attachment size does not match the visible file", {
      stage: "outlook-gui-attachment-size-mismatch"
    });
  }
}

function isSupportedImageSignature(bytes) {
  return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    || startsWith(bytes, [0xff, 0xd8, 0xff])
    || (startsWith(bytes, [0x52, 0x49, 0x46, 0x46])
      && bytes?.byteLength >= 12
      && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP");
}

function startsWith(bytes, signature) {
  return Boolean(bytes?.byteLength >= signature.length
    && signature.every((value, index) => bytes[index] === value));
}

function isMatchingTriggeredDownload(candidate, expectedName) {
  if (!candidate?.filename) return false;
  const actualExtension = extensionFromName(candidate.filename);
  const expectedExtension = extensionFromName(expectedName);
  if (!ALLOWED_EXTENSIONS.has(actualExtension)) return false;
  if (actualExtension === expectedExtension) return true;
  return ["jpg", "jpeg"].includes(actualExtension) && ["jpg", "jpeg"].includes(expectedExtension);
}

export function isAllowedResumeAttachment(attachment) {
  const name = String(attachment?.name || "");
  const extension = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  const size = Number(attachment?.size || 0);
  return Boolean(
    ALLOWED_EXTENSIONS.has(extension) &&
    size >= 0 &&
    size <= MAX_ATTACHMENT_BYTES
  );
}

function sanitizeFileName(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "_")
    .trim()
    .slice(0, 180);
}
