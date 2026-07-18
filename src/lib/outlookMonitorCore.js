const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export const DEFAULT_PLATFORM_RULES = Object.freeze({
  domains: Object.freeze([
    "maimai.cn",
    "lietou-edm.com",
    "shixiseng.com",
    "bosszhipin.com"
  ]),
  senderNames: Object.freeze([
    "脉脉",
    "猎聘",
    "实习僧",
    "实习僧网",
    "boss直聘"
  ])
});

export function emptyMonitorState() {
  return {
    schemaVersion: 1,
    baselineComplete: false,
    baselineAt: null,
    lastScanAt: null,
    latestBoundaryKey: "",
    seen: {}
  };
}

export async function hashMailVersion(mail, cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.subtle) throw new Error("当前浏览器不支持安全哈希。");
  const conversationId = normalizeRequired(mail?.conversationId, "conversationId");
  const receivedTime = normalizeRequired(mail?.receivedTime, "receivedTime");
  const bytes = new TextEncoder().encode(`${conversationId}\n${receivedTime}`);
  const digest = await cryptoApi.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isExcludedPlatformMail(mail, rules = DEFAULT_PLATFORM_RULES) {
  const senderEmail = String(mail?.senderEmail || "").trim().toLowerCase();
  const domain = senderEmail.includes("@") ? senderEmail.split("@").pop() : "";
  if (domain && rules.domains.some((candidate) => domain === candidate || domain.endsWith(`.${candidate}`))) {
    return true;
  }

  const senderName = normalizeSenderName(mail?.senderName);
  return rules.senderNames.some((candidate) => senderName === normalizeSenderName(candidate));
}

export async function planScan(
  state,
  mails,
  now = Date.now(),
  cryptoApi = globalThis.crypto
) {
  const sourceState = normalizeState(state);
  const nextState = pruneMonitorState({
    ...sourceState,
    seen: { ...sourceState.seen },
    lastScanAt: now
  }, now);
  const notifications = [];
  let latestBoundaryKey = sourceState.latestBoundaryKey || "";

  for (const mail of mails || []) {
    const dedupeKey = await hashMailVersion(mail, cryptoApi);
    latestBoundaryKey ||= dedupeKey;
    if (nextState.seen[dedupeKey]) continue;

    const platform = isExcludedPlatformMail(mail);
    const status = sourceState.baselineComplete
      ? (platform ? "filtered" : "pending")
      : "baseline";
    nextState.seen[dedupeKey] = {
      observedAt: now,
      receivedTime: String(mail.receivedTime || "").slice(0, 80),
      classification: platform ? "platform" : "personal",
      status
    };

    if (sourceState.baselineComplete && !platform) {
      notifications.push({
        conversationId: String(mail.conversationId || "").slice(0, 180),
        senderName: String(mail.senderName || "").slice(0, 120),
        senderEmail: String(mail.senderEmail || "").slice(0, 254),
        subject: String(mail.subject || "").slice(0, 240),
        receivedTime: String(mail.receivedTime || "").slice(0, 80),
        hasAttachment: Boolean(mail.hasAttachment),
        dedupeKey
      });
    }
  }

  if (!sourceState.baselineComplete) {
    nextState.baselineComplete = true;
    nextState.baselineAt = now;
  }
  nextState.latestBoundaryKey = latestBoundaryKey;

  return { notifications, nextState };
}

export function applySuccessfulDelivery(state, keys, deliveredAt = Date.now()) {
  const nextSeen = { ...(state?.seen || {}) };
  for (const key of keys || []) {
    if (!nextSeen[key]) continue;
    nextSeen[key] = {
      ...nextSeen[key],
      status: "delivered",
      deliveredAt
    };
  }
  return { ...normalizeState(state), seen: nextSeen };
}

export function pruneMonitorState(state, now = Date.now()) {
  const nextSeen = {};
  for (const [key, entry] of Object.entries(state?.seen || {})) {
    if (Number(entry?.observedAt) >= now - RETENTION_MS) nextSeen[key] = entry;
  }
  return { ...normalizeState(state), seen: nextSeen };
}

function normalizeState(state) {
  return {
    ...emptyMonitorState(),
    ...(state || {}),
    seen: { ...(state?.seen || {}) }
  };
}

function normalizeRequired(value, field) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) throw new Error(`缺少 ${field}，无法生成去重键。`);
  return normalized;
}

function normalizeSenderName(value) {
  return String(value || "").replace(/\s+/g, "").trim().toLowerCase();
}
