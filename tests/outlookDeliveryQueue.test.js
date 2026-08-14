import { describe, expect, it } from "vitest";
import {
  deliveryBatchesFor,
  enqueueNotifications,
  getDueJobs,
  markDeliveryFailure,
  removeDeliveredJobs,
  retryDelayMs
} from "../src/lib/outlookDeliveryQueue.js";

const now = Date.parse("2026-07-18T10:00:00+08:00");
const mail = {
  conversationId: "conv",
  dedupeKey: "hash-1",
  senderName: "Candidate",
  senderEmail: "candidate@example.com",
  subject: "Investment internship application",
  receivedTime: "2026-07-18T09:00:00+08:00",
  hasAttachment: true,
  preview: "must not persist",
  attachmentName: "must-not-persist.pdf"
};

describe("outlook delivery queue", () => {
  it("enqueues one privacy-safe durable job per mail", () => {
    const queue = enqueueNotifications([], [mail], now);

    expect(queue).toEqual([{
      id: "hash-1",
      dedupeKeys: ["hash-1"],
      mails: [{
        conversationId: "conv",
        senderName: "Candidate",
        senderEmail: "candidate@example.com",
        subject: "Investment internship application",
        receivedTime: "2026-07-18T09:00:00+08:00",
        hasAttachment: true
      }],
      attempts: 0,
      createdAt: now,
      nextAttemptAt: now,
      status: "pending",
      lastErrorCode: ""
    }]);
    expect(JSON.stringify(queue)).not.toMatch(/must not persist|must-not-persist\.pdf/);
  });

  it("does not enqueue the same dedupe key twice", () => {
    const once = enqueueNotifications([], [mail], now);
    expect(enqueueNotifications(once, [mail], now + 1_000)).toEqual(once);
  });

  it("uses 1, 5, 15, then 30 minute retry delays", () => {
    expect(retryDelayMs(0)).toBe(60_000);
    expect(retryDelayMs(1)).toBe(5 * 60_000);
    expect(retryDelayMs(2)).toBe(15 * 60_000);
    expect(retryDelayMs(3)).toBe(30 * 60_000);
    expect(retryDelayMs(20)).toBe(30 * 60_000);
  });

  it("schedules failures and expires them after 24 hours", () => {
    const [job] = enqueueNotifications([], [mail], now);
    const retry = markDeliveryFailure(job, now, "NETWORK");
    const expired = markDeliveryFailure(
      { ...retry, createdAt: now - 24 * 60 * 60 * 1000 },
      now,
      "NETWORK"
    );

    expect(retry).toMatchObject({
      attempts: 1,
      nextAttemptAt: now + 60_000,
      status: "pending",
      lastErrorCode: "NETWORK"
    });
    expect(expired).toMatchObject({
      attempts: 2,
      nextAttemptAt: null,
      status: "expired"
    });
  });

  it("returns only due pending jobs and removes delivered keys", () => {
    const [job] = enqueueNotifications([], [mail], now);
    const future = { ...job, id: "future", dedupeKeys: ["future"], nextAttemptAt: now + 10_000 };
    const expired = { ...job, id: "expired", dedupeKeys: ["expired"], status: "expired" };
    const queue = [job, future, expired];

    expect(getDueJobs(queue, now).map((item) => item.id)).toEqual(["hash-1"]);
    expect(removeDeliveredJobs(queue, ["hash-1"]).map((item) => item.id)).toEqual(["future", "expired"]);
  });

  it("sends up to five jobs separately and larger recoveries as one digest", () => {
    const small = Array.from({ length: 5 }, (_, index) => ({
      id: `id-${index}`,
      dedupeKeys: [`key-${index}`],
      mails: [{ ...mail, subject: `Mail ${index}` }]
    }));
    const large = [...small, {
      id: "id-5",
      dedupeKeys: ["key-5"],
      mails: [{ ...mail, subject: "Mail 5" }]
    }];

    expect(deliveryBatchesFor(small)).toHaveLength(5);
    expect(deliveryBatchesFor(large)).toEqual([{
      jobIds: ["id-0", "id-1", "id-2", "id-3", "id-4", "id-5"],
      dedupeKeys: ["key-0", "key-1", "key-2", "key-3", "key-4", "key-5"],
      mails: expect.arrayContaining([
        expect.objectContaining({ subject: "Mail 0" }),
        expect.objectContaining({ subject: "Mail 5" })
      ]),
      digest: true
    }]);
  });
});
