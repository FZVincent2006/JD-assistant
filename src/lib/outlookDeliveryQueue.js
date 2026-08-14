const ONE_MINUTE = 60 * 1000;
const MAX_JOB_AGE_MS = 24 * 60 * ONE_MINUTE;

export function enqueueNotifications(queue, mails, now = Date.now()) {
  const nextQueue = [...(queue || [])];
  const existingKeys = new Set(nextQueue.flatMap((job) => job.dedupeKeys || []));

  for (const mail of mails || []) {
    const dedupeKey = String(mail?.dedupeKey || "");
    if (!dedupeKey || existingKeys.has(dedupeKey)) continue;
    nextQueue.push({
      id: dedupeKey,
      dedupeKeys: [dedupeKey],
      mails: [sanitizeMail(mail)],
      attempts: 0,
      createdAt: now,
      nextAttemptAt: now,
      status: "pending",
      lastErrorCode: ""
    });
    existingKeys.add(dedupeKey);
  }

  return nextQueue;
}

export function retryDelayMs(previousAttempts) {
  if (previousAttempts <= 0) return ONE_MINUTE;
  if (previousAttempts === 1) return 5 * ONE_MINUTE;
  if (previousAttempts === 2) return 15 * ONE_MINUTE;
  return 30 * ONE_MINUTE;
}

export function markDeliveryFailure(job, now = Date.now(), errorCode = "UNKNOWN") {
  const attempts = Number(job?.attempts || 0) + 1;
  const expired = now - Number(job?.createdAt || now) >= MAX_JOB_AGE_MS;
  return {
    ...job,
    attempts,
    nextAttemptAt: expired ? null : now + retryDelayMs(attempts - 1),
    status: expired ? "expired" : "pending",
    lastErrorCode: String(errorCode || "UNKNOWN").slice(0, 80)
  };
}

export function getDueJobs(queue, now = Date.now()) {
  return (queue || []).filter((job) =>
    job?.status === "pending" &&
    Number(job?.nextAttemptAt) <= now
  );
}

export function removeDeliveredJobs(queue, deliveredKeys) {
  const keys = new Set(deliveredKeys || []);
  return (queue || []).filter((job) =>
    !(job?.dedupeKeys || []).some((key) => keys.has(key))
  );
}

export function deliveryBatchesFor(jobs) {
  const safeJobs = jobs || [];
  if (safeJobs.length <= 5) {
    return safeJobs.map((job) => ({
      jobIds: [job.id],
      dedupeKeys: [...(job.dedupeKeys || [])],
      mails: [...(job.mails || [])],
      digest: false
    }));
  }

  return [{
    jobIds: safeJobs.map((job) => job.id),
    dedupeKeys: safeJobs.flatMap((job) => job.dedupeKeys || []),
    mails: safeJobs.flatMap((job) => job.mails || []),
    digest: true
  }];
}

function sanitizeMail(mail) {
  return {
    conversationId: sanitize(mail?.conversationId, 180),
    senderName: sanitize(mail?.senderName, 120),
    senderEmail: sanitize(mail?.senderEmail, 254),
    subject: sanitize(mail?.subject, 240),
    receivedTime: sanitize(mail?.receivedTime, 80),
    hasAttachment: Boolean(mail?.hasAttachment)
  };
}

function sanitize(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}
