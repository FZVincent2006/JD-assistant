import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  applySuccessfulDelivery,
  emptyMonitorState,
  hashMailVersion,
  isExcludedPlatformMail,
  planScan,
  pruneMonitorState
} from "../src/lib/outlookMonitorCore.js";

const now = Date.parse("2026-07-18T10:00:00+08:00");
const candidateMail = {
  conversationId: "candidate-conversation",
  senderName: "Candidate",
  senderEmail: "candidate@example.com",
  subject: "Investment internship application",
  receivedTime: "2026-07-18T09:00:00+08:00",
  hasAttachment: true
};
const baselineSeedMail = {
  ...candidateMail,
  conversationId: "baseline-seed",
  receivedTime: "2026-07-18T08:00:00+08:00"
};

describe("hashMailVersion", () => {
  it("is stable for a scan refresh but changes for a new message version", async () => {
    const first = await hashMailVersion(candidateMail, webcrypto);
    const refresh = await hashMailVersion({ ...candidateMail }, webcrypto);
    const reply = await hashMailVersion({
      ...candidateMail,
      receivedTime: "2026-07-18T09:05:00+08:00"
    }, webcrypto);

    expect(first).toBe(refresh);
    expect(first).not.toBe(reply);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain("candidate");
  });
});

describe("isExcludedPlatformMail", () => {
  it.each([
    "noreply@mail.maimai.cn",
    "service@mail7.lietou-edm.com",
    "service@notice.shixiseng.com",
    "cv@service.bosszhipin.com"
  ])("excludes fixed platform domain %s", (senderEmail) => {
    expect(isExcludedPlatformMail({ senderName: "", senderEmail, subject: "" })).toBe(true);
  });

  it.each(["脉脉", "猎聘", "实习僧网", "BOSS直聘"])(
    "excludes the exact platform sender name %s when Outlook hides the email",
    (senderName) => {
      expect(isExcludedPlatformMail({ senderName, senderEmail: "", subject: "New CV" })).toBe(true);
    }
  );

  it("does not exclude CaseMock or a personal sender who mentions a platform in the subject", () => {
    expect(isExcludedPlatformMail({
      senderName: "CaseMock",
      senderEmail: "apply@casemock.com",
      subject: "CaseMock platform submission"
    })).toBe(false);
    expect(isExcludedPlatformMail({
      senderName: "Candidate",
      senderEmail: "candidate@example.com",
      subject: "I also applied on BOSS直聘"
    })).toBe(false);
  });
});

describe("planScan", () => {
  it("does not complete the baseline while the Outlook list is still empty", async () => {
    const plan = await planScan({
      ...emptyMonitorState(),
      notificationCutoffAt: now
    }, [], now, webcrypto);

    expect(plan.notifications).toEqual([]);
    expect(plan.nextState.baselineComplete).toBe(false);
    expect(plan.nextState.baselineAt).toBeNull();
    expect(plan.nextState.notificationCutoffAt).toBe(now);
  });

  it("establishes a first baseline without notifying historical mail", async () => {
    const plan = await planScan(emptyMonitorState(), [candidateMail], now, webcrypto);
    const [entry] = Object.values(plan.nextState.seen);

    expect(plan.notifications).toEqual([]);
    expect(plan.nextState.baselineComplete).toBe(true);
    expect(plan.nextState.baselineAt).toBe(now);
    expect(entry).toMatchObject({
      observedAt: now,
      receivedTime: candidateMail.receivedTime,
      classification: "personal",
      status: "baseline"
    });
    expect(JSON.stringify(plan.nextState)).not.toContain(candidateMail.subject);
    expect(JSON.stringify(plan.nextState)).not.toContain(candidateMail.senderEmail);
  });

  it("never alerts a historical row that Outlook renders after the baseline", async () => {
    const cutoffAt = Date.parse("2026-07-18T10:00:00+08:00");
    const initial = await planScan({
      ...emptyMonitorState(),
      notificationCutoffAt: cutoffAt
    }, [candidateMail], cutoffAt, webcrypto);
    const lateRenderedHistoricalMail = {
      ...candidateMail,
      conversationId: "late-rendered-history",
      receivedTime: "收到 2026/7/17 09:30"
    };

    const later = await planScan(
      initial.nextState,
      [lateRenderedHistoricalMail],
      cutoffAt + 60_000,
      webcrypto
    );

    expect(later.notifications).toEqual([]);
    expect(Object.values(later.nextState.seen)).toContainEqual(expect.objectContaining({
      receivedTime: lateRenderedHistoricalMail.receivedTime,
      status: "baseline"
    }));
  });

  it("still alerts mail received after the activation cutoff", async () => {
    const cutoffAt = Date.parse("2026-07-18T10:00:00+08:00");
    const initial = await planScan({
      ...emptyMonitorState(),
      notificationCutoffAt: cutoffAt
    }, [candidateMail], cutoffAt, webcrypto);
    const newMail = {
      ...candidateMail,
      conversationId: "new-after-cutoff",
      receivedTime: "2026-07-18T10:01:00+08:00"
    };

    const later = await planScan(
      initial.nextState,
      [newMail],
      cutoffAt + 60_000,
      webcrypto
    );

    expect(later.notifications).toEqual([{
      ...newMail,
      dedupeKey: expect.stringMatching(/^[a-f0-9]{64}$/)
    }]);
  });

  it("returns unseen personal mail once and records it as pending", async () => {
    const baseline = await planScan(
      emptyMonitorState(),
      [baselineSeedMail],
      now - 60_000,
      webcrypto
    );
    const first = await planScan(baseline.nextState, [candidateMail], now, webcrypto);
    const repeat = await planScan(first.nextState, [candidateMail], now + 1_000, webcrypto);

    expect(first.notifications).toEqual([{
      ...candidateMail,
      dedupeKey: expect.stringMatching(/^[a-f0-9]{64}$/)
    }]);
    expect(Object.values(first.nextState.seen)
      .find((entry) => entry.receivedTime === candidateMail.receivedTime)?.status)
      .toBe("pending");
    expect(repeat.notifications).toEqual([]);
  });

  it("records newly observed platform mail without notifying", async () => {
    const baseline = await planScan(
      emptyMonitorState(),
      [baselineSeedMail],
      now - 60_000,
      webcrypto
    );
    const platformMail = {
      ...candidateMail,
      conversationId: "platform",
      senderName: "猎聘",
      senderEmail: "service@mail18.lietou-edm.com"
    };
    const plan = await planScan(baseline.nextState, [platformMail], now, webcrypto);

    expect(plan.notifications).toEqual([]);
    expect(Object.values(plan.nextState.seen)
      .find((entry) => entry.classification === "platform")).toMatchObject({
      classification: "platform",
      status: "filtered"
    });
  });
});

describe("delivery and retention transitions", () => {
  it("marks only successful keys as delivered", async () => {
    const baseline = await planScan(
      emptyMonitorState(),
      [baselineSeedMail],
      now - 60_000,
      webcrypto
    );
    const planned = await planScan(baseline.nextState, [candidateMail], now, webcrypto);
    const key = Object.keys(planned.nextState.seen)
      .find((candidate) => candidate !== Object.keys(baseline.nextState.seen)[0]);
    const delivered = applySuccessfulDelivery(planned.nextState, [key], now + 5_000);

    expect(delivered.seen[key]).toMatchObject({
      status: "delivered",
      deliveredAt: now + 5_000
    });
  });

  it("prunes records older than 90 days without mutating the input", () => {
    const old = now - 91 * 24 * 60 * 60 * 1000;
    const recent = now - 2 * 24 * 60 * 60 * 1000;
    const state = {
      ...emptyMonitorState(),
      seen: {
        old: { observedAt: old, status: "delivered" },
        recent: { observedAt: recent, status: "delivered" }
      }
    };

    const pruned = pruneMonitorState(state, now);

    expect(pruned.seen).toEqual({ recent: state.seen.recent });
    expect(state.seen).toHaveProperty("old");
  });
});
