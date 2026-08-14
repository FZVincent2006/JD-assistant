const MAX_BODY_CHARS = 12_000;
const ATTACHMENT_EXTENSIONS = "pdf|docx?|png|jpe?g|webp";

const BODY_SELECTORS = [
  '[data-automationid="message-body"]',
  '[data-automation-id="message-body"]',
  '[data-testid="message-body"]',
  '[id^="UniqueMessageBody_"]',
  '[data-testid="mail-reading-pane"] [role="document"]',
  '[aria-label="邮件正文"]',
  '[aria-label="Message body"]'
];

const SUBJECT_SELECTORS = [
  '[data-automationid="message-subject"]',
  '[data-automation-id="message-subject"]',
  '[data-testid="message-subject"]',
  '[data-app-section="MailReadCompose"] [role="heading"]',
  '[data-testid="mail-reading-pane"] [role="heading"]'
];

const ATTACHMENT_CONTAINER_SELECTOR = [
  '[data-automationid*="attachment" i]',
  '[data-automation-id*="attachment" i]',
  '[data-testid*="attachment" i]',
  '[class*="attachment" i]',
  '[aria-label*="附件"]',
  '[aria-label*="attachment" i]'
].join(",");

const ATTACHMENT_FILE_SELECTOR = [
  '[download]',
  '[data-file-name]',
  '[title$=".pdf" i]',
  '[title$=".doc" i]',
  '[title$=".docx" i]',
  '[title$=".png" i]',
  '[title$=".jpg" i]',
  '[title$=".jpeg" i]',
  '[title$=".webp" i]',
  '[aria-label*=".pdf" i]',
  '[aria-label*=".doc" i]',
  '[aria-label*=".docx" i]',
  '[aria-label*=".png" i]',
  '[aria-label*=".jpg" i]',
  '[aria-label*=".jpeg" i]',
  '[aria-label*=".webp" i]'
].join(",");

export class OutlookGuiDetailError extends Error {
  constructor(message, { stage = "outlook-gui-detail" } = {}) {
    super(message);
    this.name = "OutlookGuiDetailError";
    this.stage = stage;
  }
}

export async function readOutlookMailViaGui({
  root = document,
  mail,
  timeoutMs = 12_000,
  pollMs = 200,
  now = Date.now,
  setTimer = setTimeout
} = {}) {
  const alreadyOpen = extractOpenOutlookMail(root, mail);
  if (detailIsReady(alreadyOpen, mail)) return alreadyOpen;

  let activationTarget = null;
  if (!alreadyOpen) {
    const row = [...root.querySelectorAll('[role="option"][data-convid]')]
      .find((candidate) => candidate.getAttribute("data-convid") === String(mail?.conversationId || ""));
    if (!row) {
      throw new OutlookGuiDetailError("Outlook mail row is no longer visible", {
        stage: "outlook-gui-row"
      });
    }
    activationTarget = activateMailRow(row, mail?.subject);
  }

  const deadline = now() + timeoutMs;
  let retried = false;
  let lastDetail = alreadyOpen;
  while (now() <= deadline) {
    const detail = extractOpenOutlookMail(root, mail);
    if (detail) lastDetail = detail;
    if (detailIsReady(detail, mail)) return detail;
    if (activationTarget && !retried && now() + pollMs >= deadline - Math.floor(timeoutMs / 2)) {
      retried = true;
      const view = root.defaultView || activationTarget.ownerDocument?.defaultView || globalThis.window;
      const MouseEventClass = view?.MouseEvent || globalThis.MouseEvent;
      activationTarget.dispatchEvent?.(new MouseEventClass("dblclick", {
        bubbles: true,
        cancelable: true
      }));
    }
    await new Promise((resolve) => setTimer(resolve, pollMs));
  }
  if (lastDetail) return lastDetail;
  throw new OutlookGuiDetailError("Outlook mail detail did not render", {
    stage: "outlook-gui-detail"
  });
}

export async function triggerOutlookAttachmentDownload({
  root = document,
  mail,
  name,
  setTimer = setTimeout
} = {}) {
  await readOutlookMailViaGui({ root, mail, setTimer });
  const subjectElement = findOpenSubjectElement(root, normalizeComparable(mail?.subject));
  const bodyElement = BODY_SELECTORS
    .map((selector) => root.querySelector(selector))
    .find((element) => element && isVisibleDetailElement(element));
  if (!subjectElement || !bodyElement) {
    throw new OutlookGuiDetailError("Outlook mail detail did not render", {
      stage: "outlook-gui-detail"
    });
  }
  const detailRoot = findDetailRoot(root, subjectElement, bodyElement);
  const inlineImage = inlineImageAttachments(bodyElement)
    .find((item) => normalizeAttachmentName(item.name) === normalizeAttachmentName(name));
  if (inlineImage) {
    const size = await downloadInlineImage(inlineImage, name, root);
    return { ok: true, name, size };
  }
  const candidate = findAttachmentCandidate({ root, detailRoot, bodyElement, name });
  if (!candidate) {
    throw new OutlookGuiDetailError("Outlook attachment control was not found", {
      stage: "outlook-gui-attachment-control"
    });
  }

  const size = attachmentSize(candidate);
  let menuTrigger = findAttachmentMenuTrigger(candidate, detailRoot, bodyElement);
  if (!menuTrigger) {
    const label = String(
      candidate.getAttribute("aria-label") || candidate.getAttribute("title") || ""
    );
    if (candidate.matches?.("a[download], a[href][download]") || /^(?:下载|download)\b/i.test(label)) {
      clickOnce(candidate);
      return { ok: true, name, size };
    }
    clickOnce(candidate);
    await new Promise((resolve) => setTimer(resolve, 250));
    menuTrigger = findAttachmentMenuTrigger(candidate, detailRoot, bodyElement);
  }
  if (menuTrigger) clickOnce(menuTrigger);
  const downloadAction = await findDownloadAction({ root, setTimer });
  if (downloadAction) {
    clickOnce(downloadAction);
  } else {
    const label = String(
      candidate.getAttribute("aria-label") || candidate.getAttribute("title") || ""
    );
    if (!/^(?:下载|download)\b/i.test(label)) {
      throw new OutlookGuiDetailError("Outlook download action was not found", {
        stage: "outlook-gui-attachment-download-action"
      });
    }
    clickOnce(candidate);
  }
  return { ok: true, name, size };
}

export function extractOpenOutlookMail(root = document, expectedMail = {}) {
  const expectedSubject = normalizeComparable(expectedMail?.subject);
  const subjectElement = findOpenSubjectElement(root, expectedSubject);
  const subject = sanitize(subjectElement?.innerText || subjectElement?.textContent, 240);
  if (!subject || (expectedSubject && normalizeComparable(subject) !== expectedSubject)) return null;

  const bodyElement = BODY_SELECTORS
    .map((selector) => root.querySelector(selector))
    .find((element) => element && isVisibleDetailElement(element));
  if (!bodyElement) return null;

  const detailRoot = findDetailRoot(root, subjectElement, bodyElement);
  const fullBody = extractCurrentMessageText(bodyElement);
  const documentScope = root.body || root.documentElement || root;
  const attachmentScope = detailRoot === documentScope ? detailRoot : documentScope;
  const { attachments, skippedAttachments } = extractAttachmentLinks(attachmentScope, bodyElement);
  for (const image of inlineImageAttachments(bodyElement)) {
    if (attachments.some((item) => normalizeAttachmentName(item.name) === normalizeAttachmentName(image.name))
      || skippedAttachments.some((item) => normalizeAttachmentName(item.name) === normalizeAttachmentName(image.name))) {
      continue;
    }
    skippedAttachments.push({
      id: image.id,
      name: image.name,
      reason: "inline-image",
      size: image.size,
      kind: "inline-image"
    });
  }
  return {
    subject,
    body: fullBody.slice(0, MAX_BODY_CHARS),
    bodyTruncated: fullBody.length > MAX_BODY_CHARS,
    attachments,
    skippedAttachments
  };
}

function detailIsReady(detail, mail) {
  if (!detail) return false;
  if (!mail?.hasAttachment) return true;
  return Boolean((detail.attachments?.length || 0) + (detail.skippedAttachments?.length || 0));
}

function findOpenSubjectElement(root, expectedSubject) {
  for (const selector of SUBJECT_SELECTORS) {
    for (const element of root.querySelectorAll(selector)) {
      if (element.closest('[role="option"][data-convid]')) continue;
      const text = sanitize(element.innerText || element.textContent, 240);
      if (!text) continue;
      if (!expectedSubject || normalizeComparable(text) === expectedSubject) return element;
    }
  }
  return null;
}

function extractAttachmentLinks(detailRoot, bodyElement) {
  const elements = new Set();
  for (const container of detailRoot.querySelectorAll(ATTACHMENT_CONTAINER_SELECTOR)) {
    if (bodyElement.contains(container)) continue;
    elements.add(container);
    for (const child of container.querySelectorAll("a[href], [data-download-url], [data-url]")) {
      elements.add(child);
    }
  }
  for (const fileElement of detailRoot.querySelectorAll(ATTACHMENT_FILE_SELECTOR)) {
    if (!bodyElement.contains(fileElement) && isVisibleDetailElement(fileElement)) {
      elements.add(fileElement);
    }
  }
  for (const fileElement of attachmentTextCandidates(detailRoot, bodyElement)) {
    elements.add(fileElement);
  }

  const attachments = [];
  const skippedAttachments = [];
  const seen = new Set();
  for (const element of elements) {
    const name = attachmentFileName(element);
    if (!name) continue;
    const rawUrl = element.getAttribute("href") ||
      element.getAttribute("data-download-url") ||
      element.getAttribute("data-url") ||
      element.querySelector("a[href]")?.getAttribute("href") ||
      element.closest?.("a[href]")?.getAttribute("href") ||
      element.closest?.("[data-download-url]")?.getAttribute("data-download-url") ||
      element.closest?.("[data-url]")?.getAttribute("data-url") || "";
    const identity = String(
      element.getAttribute("data-attachment-id") || rawUrl || name.toLowerCase()
    );
    if (seen.has(identity)) continue;
    seen.add(identity);
    if (!rawUrl) {
      skippedAttachments.push({ name, reason: "no-download-url", size: attachmentSize(element) });
      continue;
    }
    let url;
    try {
      url = new URL(rawUrl, location.href).toString();
    } catch {
      skippedAttachments.push({ name, reason: "no-download-url", size: attachmentSize(element) });
      continue;
    }
    attachments.push({
      id: sanitize(
        element.getAttribute("data-attachment-id") || `${attachments.length}-${name}`,
        512
      ),
      name,
      url,
      contentType: contentTypeFor(name),
      size: attachmentSize(element)
    });
  }
  return { attachments, skippedAttachments };
}

function attachmentCandidates(detailRoot, bodyElement) {
  return [...new Set([
    ...detailRoot.querySelectorAll(ATTACHMENT_FILE_SELECTOR),
    ...detailRoot.querySelectorAll(ATTACHMENT_CONTAINER_SELECTOR),
    ...attachmentTextCandidates(detailRoot, bodyElement)
  ])];
}

function findAttachmentCandidate({ root, detailRoot, bodyElement, name }) {
  const expectedName = normalizeAttachmentName(name);
  const documentScope = root.body || root.documentElement || root;
  const scopes = detailRoot === documentScope ? [detailRoot] : [detailRoot, documentScope];
  for (const scope of scopes) {
    const match = attachmentCandidates(scope, bodyElement).find((element) =>
      normalizeAttachmentName(attachmentFileName(element)) === expectedName
      && isVisibleDetailElement(element)
    );
    if (match) return match;
  }
  return null;
}

function normalizeAttachmentName(value) {
  return String(value || "")
    .replace(/\s+\(\d+\)(?=\.[^.]+$)/, "")
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFKC")
    .toLowerCase();
}

function attachmentTextCandidates(detailRoot, bodyElement) {
  const candidates = [];
  const walker = detailRoot.ownerDocument.createTreeWalker(
    detailRoot,
    globalThis.NodeFilter?.SHOW_TEXT || 4
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = String(node.nodeValue || "").replace(/\s+/g, " ").trim();
    if (!new RegExp(`[^\\\\/:*?"<>|\\n]+\\.(?:${ATTACHMENT_EXTENSIONS})`, "i").test(text)
      || text.length > 240) continue;
    const element = node.parentElement;
    if (!element || element.closest('[role="option"][data-convid]')) {
      continue;
    }
    let candidate = element.closest('button, [role="button"], a, [tabindex]');
    if (!candidate || !detailRoot.contains(candidate)) {
      candidate = closestCompactAttachmentBlock(element, detailRoot, bodyElement);
    }
    if (bodyElement.contains(element) && !isInteractiveAttachmentCard(candidate, element)) continue;
    if (candidate && isVisibleDetailElement(candidate)) candidates.push(candidate);
  }
  return candidates;
}

function isInteractiveAttachmentCard(candidate, fileNameElement) {
  if (!candidate) return false;
  const text = String(candidate.textContent || "").replace(/\s+/g, " ").trim();
  if (!attachmentFileName(candidate) || text.length > 360) return false;
  if (candidate.matches?.('button, [role="button"], a, [tabindex], [aria-haspopup="menu"]')) {
    return true;
  }
  const controls = candidate.querySelectorAll?.(
    'button, [role="button"], a, [tabindex], [aria-haspopup="menu"]'
  );
  if (controls?.length) return true;
  return Boolean(fileNameElement?.parentElement?.querySelector?.(
    'button, [role="button"], [aria-haspopup="menu"]'
  ));
}

function closestCompactAttachmentBlock(element, detailRoot, bodyElement) {
  let current = element;
  let fallback = element;
  for (let depth = 0; depth < 5 && current && current !== detailRoot; depth += 1) {
    const text = String(current.textContent || "").replace(/\s+/g, " ").trim();
    if (text.length <= 320 && attachmentFileName(current)) {
      fallback = current;
      if (current.matches?.('button, [role="button"], a, [tabindex]')
        || current.querySelector?.('button, [role="button"], a, [tabindex]')) {
        return current;
      }
    }
    current = current.parentElement;
  }
  return fallback;
}

function findAttachmentMenuTrigger(candidate, detailRoot, bodyElement) {
  const tile = closestCompactAttachmentBlock(candidate, detailRoot, bodyElement) || candidate;
  const controls = [...tile.querySelectorAll('button, [role="button"], [aria-haspopup="menu"]')]
    .filter((element) => element !== candidate && isVisibleDetailElement(element));
  return controls.find((element) => /(?:更多|菜单|展开|操作|more|menu|action|expand)/i.test(
    `${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""}`
  )) || controls.at(-1) || null;
}

async function findDownloadAction({ root, setTimer }) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const action = findVisibleDownloadAction(root);
    if (action) return action;
    await new Promise((resolve) => setTimer(resolve, 100));
  }
  return null;
}

function findVisibleDownloadAction(root) {
  const interactive = root.querySelectorAll([
    '[role="menuitem"]',
    '[role="option"]',
    '[role="button"]',
    'button',
    '[tabindex]',
    '[aria-label]',
    '[title]',
    '[data-automationid]'
  ].join(","));
  const direct = [...interactive].find((element) =>
    isVisibleDetailElement(element) && isDownloadLabel(actionLabel(element))
  );
  if (direct) return direct;

  const documentObject = root.ownerDocument || root;
  const walker = documentObject.createTreeWalker(
    root.body || root.documentElement || root,
    globalThis.NodeFilter?.SHOW_TEXT || 4
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!isDownloadLabel(String(node.nodeValue || "").replace(/\s+/g, " ").trim())) continue;
    const element = node.parentElement;
    if (!element || !isVisibleDetailElement(element)) continue;
    const action = element.closest?.(
      'button, [role="menuitem"], [role="option"], [role="button"], [tabindex]'
    ) || closestExactTextContainer(element, root);
    if (action && isVisibleDetailElement(action)) return action;
  }
  return null;
}

function closestExactTextContainer(element, root) {
  let current = element;
  let match = element;
  for (let depth = 0; depth < 4 && current?.parentElement; depth += 1) {
    const parent = current.parentElement;
    if (parent === root.body || parent === root.documentElement) break;
    if (!isDownloadLabel(String(parent.textContent || "").replace(/\s+/g, " ").trim())) break;
    match = parent;
    current = parent;
  }
  return match;
}

function actionLabel(element) {
  return String(
    element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent || ""
  ).replace(/\s+/g, " ").trim();
}

function isDownloadLabel(value) {
  return /^(?:下载|download)(?:到本地|附件|文件)?(?:\s|$)/i.test(String(value || ""));
}

function clickOnce(element) {
  element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  element.focus?.({ preventScroll: true });
  element.click();
}

function activateMailRow(row, expectedSubject) {
  row.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  const normalizedSubject = normalizeComparable(expectedSubject);
  const candidates = [
    ...row.querySelectorAll(
      '[data-automationid="subject"], [data-testid="subject"], [class*="subject" i], span[title]'
    )
  ];
  const target = candidates.find((element) =>
    normalizeComparable(element.innerText || element.textContent).includes(normalizedSubject)
  ) || row;
  target.focus?.({ preventScroll: true });
  const view = row.ownerDocument?.defaultView || globalThis.window;
  for (const type of ["mousedown", "mouseup"]) {
    const MouseEventClass = view?.MouseEvent || globalThis.MouseEvent;
    target.dispatchEvent?.(new MouseEventClass(type, {
      bubbles: true,
      cancelable: true
    }));
  }
  target.click();
  return target;
}

function isVisibleDetailElement(element) {
  if (!element || element.closest('[role="option"][data-convid]')) return false;
  if (element.closest('[hidden], [aria-hidden="true"]')) return false;
  const style = element.getAttribute?.("style") || "";
  if (/(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(style)) return false;
  const view = element.ownerDocument?.defaultView;
  const computed = view?.getComputedStyle?.(element);
  return computed?.display !== "none"
    && computed?.visibility !== "hidden"
    && computed?.visibility !== "collapse";
}

function attachmentFileName(element) {
  const values = [
    element.getAttribute("download"),
    element.getAttribute("data-file-name"),
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    String(element.textContent || "").length <= 300 ? element.textContent : "",
    element.querySelector("[download]")?.getAttribute("download"),
    element.querySelector("[aria-label]")?.getAttribute("aria-label"),
    element.querySelector("[title]")?.getAttribute("title")
  ];
  for (const value of values) {
    const match = String(value || "").match(
      new RegExp(`([^\\\\/:*?"<>|\\n]+\\.(?:${ATTACHMENT_EXTENSIONS}))`, "i")
    );
    if (match) {
      return sanitize(match[1], 180)
        .replace(/^(?:下载|附件|download|attachment)\s*[:：-]?\s*/i, "");
    }
  }
  return "";
}

function inlineImageAttachments(bodyElement) {
  return [...bodyElement.querySelectorAll("img[src]")]
    .filter(isResumeSizedImage)
    .map((element, index) => ({
      id: `inline-image-${index + 1}`,
      name: inlineImageName(element, index),
      size: 0,
      element
    }));
}

function isResumeSizedImage(element) {
  const rect = element.getBoundingClientRect?.() || {};
  const width = Math.max(
    Number(element.naturalWidth || 0),
    Number(element.getAttribute("width") || 0),
    Number(rect.width || 0)
  );
  const height = Math.max(
    Number(element.naturalHeight || 0),
    Number(element.getAttribute("height") || 0),
    Number(rect.height || 0)
  );
  return isVisibleDetailElement(element)
    && ((width >= 240 && height >= 160) || (width >= 160 && height >= 240));
}

function inlineImageName(element, index) {
  const labels = [
    element.getAttribute("data-file-name"),
    element.getAttribute("alt"),
    element.getAttribute("title"),
    element.getAttribute("aria-label")
  ];
  for (const value of labels) {
    const match = String(value || "").match(/([^\\/:*?"<>|\n]+\.(?:png|jpe?g|webp))/i);
    if (match) return sanitize(match[1], 180);
  }
  const source = String(element.currentSrc || element.getAttribute("src") || "");
  try {
    const parsed = new URL(source, location.href);
    for (const key of ["filename", "fileName", "name"]) {
      const value = parsed.searchParams.get(key);
      const match = String(value || "").match(/([^\\/:*?"<>|\n]+\.(?:png|jpe?g|webp))/i);
      if (match) return sanitize(match[1], 180);
    }
    const pathName = decodeURIComponent(parsed.pathname.split("/").pop() || "");
    if (/\.(?:png|jpe?g|webp)$/i.test(pathName)) return sanitize(pathName, 180);
  } catch {}
  return `邮件图片简历-${index + 1}.png`;
}

async function downloadInlineImage(image, name, root) {
  const documentObject = root.ownerDocument || root;
  const view = documentObject.defaultView || globalThis.window;
  let blob = null;
  try {
    const canvas = documentObject.createElement("canvas");
    canvas.width = image.element.naturalWidth || image.element.width;
    canvas.height = image.element.naturalHeight || image.element.height;
    if (canvas.width && canvas.height) {
      canvas.getContext("2d").drawImage(image.element, 0, 0, canvas.width, canvas.height);
      blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    }
  } catch {}
  if (!blob) {
    const source = image.element.currentSrc || image.element.getAttribute("src");
    const response = await view.fetch(source, { credentials: "include" });
    if (!response.ok) {
      throw new OutlookGuiDetailError("Outlook inline image could not be read", {
        stage: "outlook-gui-inline-image"
      });
    }
    blob = await response.blob();
  }
  if (!blob?.size) {
    throw new OutlookGuiDetailError("Outlook inline image was empty", {
      stage: "outlook-gui-inline-image"
    });
  }
  const url = view.URL.createObjectURL(blob);
  const anchor = documentObject.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.style.display = "none";
  documentObject.body.append(anchor);
  anchor.click();
  anchor.remove();
  view.setTimeout(() => view.URL.revokeObjectURL(url), 30_000);
  return blob.size;
}

function extractCurrentMessageText(bodyElement) {
  const clone = bodyElement.cloneNode(true);
  for (const unwanted of clone.querySelectorAll(
    "style, script, template, noscript, link, meta, svg, [aria-hidden=\"true\"]"
  )) {
    unwanted.remove();
  }
  removeAttachmentCardsFromBodyClone(clone);
  const replyMarker = clone.querySelector([
    '#divRplyFwdMsg',
    '[id^="divRplyFwdMsg"]',
    '[data-marker="__QUOTED_TEXT__"]',
    '[class*="quoted" i]',
    '[class*="replyForward" i]',
    'blockquote'
  ].join(","));
  if (replyMarker) removeNodeAndFollowing(replyMarker, clone);
  const text = normalizeText(clone.innerText || clone.textContent || "");
  return trimReplyHistory(text);
}

function removeAttachmentCardsFromBodyClone(clone) {
  const documentObject = clone.ownerDocument;
  const walker = documentObject.createTreeWalker(
    clone,
    globalThis.NodeFilter?.SHOW_TEXT || 4
  );
  const removals = new Set();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = String(node.nodeValue || "").replace(/\s+/g, " ").trim();
    if (!new RegExp(`[^\\\\/:*?"<>|\\n]+\\.(?:${ATTACHMENT_EXTENSIONS})`, "i").test(text)) {
      continue;
    }
    const element = node.parentElement;
    const candidate = element?.closest?.('button, [role="button"], a, [tabindex]')
      || closestCompactAttachmentBlock(element, clone, clone);
    if (isInteractiveAttachmentCard(candidate, element)) removals.add(candidate);
  }
  for (const element of removals) element.remove();
}

function findDetailRoot(root, subjectElement, bodyElement) {
  let common = lowestCommonAncestor(subjectElement, bodyElement) || bodyElement.parentElement || root;
  const fallback = common;
  for (let depth = 0; depth < 7 && common; depth += 1) {
    const candidates = common.querySelectorAll(
      `${ATTACHMENT_CONTAINER_SELECTOR}, ${ATTACHMENT_FILE_SELECTOR}`
    );
    if ([...candidates].some((element) =>
      !bodyElement.contains(element) && isVisibleDetailElement(element)
    )) {
      return common;
    }
    if (common === root.body || common === root.documentElement) break;
    common = common.parentElement;
  }
  return fallback;
}

function lowestCommonAncestor(first, second) {
  if (!first || !second) return null;
  const ancestors = new Set();
  for (let current = first; current; current = current.parentElement) ancestors.add(current);
  for (let current = second; current; current = current.parentElement) {
    if (ancestors.has(current)) return current;
  }
  return null;
}

function removeNodeAndFollowing(node, root) {
  let current = node;
  while (current && current !== root) {
    let sibling = current.nextSibling;
    while (sibling) {
      const next = sibling.nextSibling;
      sibling.remove();
      sibling = next;
    }
    const parent = current.parentNode;
    current.remove();
    current = parent;
  }
}

function trimReplyHistory(value) {
  const markers = [
    /\n\s*_{5,}\s*\n/u,
    /\n\s*-{3,}\s*(?:Original Message|原始邮件)\s*-{3,}/iu,
    /\n\s*(?:发件人|寄件者)\s*[:：]/u,
    /\n\s*From\s*:/iu,
    /\n\s*On\s+.+?\s+wrote\s*:/iu
  ];
  let cutoff = value.length;
  for (const marker of markers) {
    const match = marker.exec(value);
    if (match && match.index < cutoff) cutoff = match.index;
  }
  return value.slice(0, cutoff).trim();
}

function attachmentSize(element) {
  const explicit = Number(element.getAttribute("data-file-size") || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const text = String(element.textContent || "");
  const match = text.match(/(\d+(?:\.\d+)?)\s*(KB|MB|GB|B)\b/i);
  if (!match) return 0;
  const units = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
  return Math.round(Number(match[1]) * units[match[2].toUpperCase()]);
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

function normalizeText(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function normalizeComparable(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function sanitize(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}
