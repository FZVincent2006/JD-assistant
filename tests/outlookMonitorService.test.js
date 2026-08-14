import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OUTLOOK_MONITOR_STORAGE_KEY,
  createOutlookMonitorService
} from "../src/lib/outlookMonitorService.js";

const webhookUrl = "https://open.feishu.cn/open-apis/bot/v2/hook/test-token";
const validPage = {
  supported: true,
  mailbox: "recruiting@zhenfund.com",
  folder: "个人投递（需提醒）",
  loggedIn: true,
  targetMailbox: true,
  targetFolder: true
};
const candidateMail = {
  conversationId: "candidate-conversation",
  senderName: "Candidate",
  senderEmail: "candidate@example.com",
  subject: "Investment internship application",
  receivedTime: "2026-07-18T09:00:00+08:00",
  hasAttachment: true
};
const newCandidateMail = {
  ...candidateMail,
  conversationId: "new-candidate-conversation",
  receivedTime: "2026-07-18T10:01:00+08:00"
};

function createChromeFake(scanResult = { ok: true, type: "OUTLOOK_SCAN_RESULT", page: validPage, mails: [] }) {
  const values = {};
  const chromeApi = {
    storage: {
      local: {
        get: vi.fn(async (key) => ({ [key]: values[key] })),
        set: vi.fn(async (update) => Object.assign(values, update))
      }
    },
    alarms: {
      create: vi.fn()
    },
    tabs: {
      query: vi.fn().mockResolvedValue([{
        id: 42,
        url: "https://partner.outlook.cn/mail/"
      }]),
      sendMessage: vi.fn().mockResolvedValue(scanResult)
    },
    notifications: {
      create: vi.fn().mockResolvedValue("notification-id")
    }
  };
  return { chromeApi, values };
}

async function configureAndTest(service) {
  await service.handleMessage({
    type: "OUTLOOK_MONITOR_SAVE_CONFIG",
    payload: { webhookUrl, secret: "secret", rulesConfirmed: true }
  });
  return service.handleMessage({ type: "OUTLOOK_MONITOR_TEST_FEISHU" });
}

describe("createOutlookMonitorService", () => {
  let currentTime;

  beforeEach(() => {
    currentTime = Date.parse("2026-07-18T10:00:00+08:00");
  });

  it("creates the ten-minute scan and one-minute retry alarms", async () => {
    const { chromeApi } = createChromeFake();
    const service = createOutlookMonitorService({
      chromeApi,
      cryptoApi: webcrypto,
      now: () => currentTime,
      sendWebhook: vi.fn().mockResolvedValue({ ok: true, code: 0, message: "success" })
    });

    await service.initialize();

    expect(chromeApi.alarms.create).toHaveBeenCalledWith(
      "outlook-monitor-scan",
      { periodInMinutes: 10 }
    );
    expect(chromeApi.alarms.create).toHaveBeenCalledWith(
      "outlook-monitor-retry",
      { periodInMinutes: 1 }
    );
  });

  it("retries queued mail immediately after an extension update", async () => {
    const { chromeApi, values } = createChromeFake();
    const sendWebhook = vi.fn().mockResolvedValue({ ok: true, code: 0, message: "success" });
    const service = createOutlookMonitorService({
      chromeApi,
      cryptoApi: webcrypto,
      now: () => currentTime,
      sendWebhook
    });
    await configureAndTest(service);
    await service.handleMessage({
      type: "OUTLOOK_MONITOR_SET_ENABLED",
      payload: { enabled: true }
    });
    values[OUTLOOK_MONITOR_STORAGE_KEY].queue = [{
      id: "queued-before-update",
      dedupeKeys: ["queued-before-update"],
      mails: [{ ...candidateMail, hasAttachment: false }],
      attempts: 3,
      createdAt: currentTime,
      nextAttemptAt: currentTime + 30 * 60_000,
      status: "pending"
    }];

    await service.retryPendingNow();

    expect(sendWebhook).toHaveBeenCalledTimes(2);
    expect(values[OUTLOOK_MONITOR_STORAGE_KEY].queue).toEqual([]);
  });

  it("requires a successful bot test and confirmed rules before enabling", async () => {
    const { chromeApi } = createChromeFake();
    const service = createOutlookMonitorService({
      chromeApi,
      cryptoApi: webcrypto,
      now: () => currentTime,
      sendWebhook: vi.fn().mockResolvedValue({ ok: true, code: 0, message: "success" })
    });

    const missingConfig = await service.handleMessage({
      type: "OUTLOOK_MONITOR_SET_ENABLED",
      payload: { enabled: true }
    });
    await service.handleMessage({
      type: "OUTLOOK_MONITOR_SAVE_CONFIG",
      payload: { webhookUrl, secret: "secret", rulesConfirmed: false }
    });
    await service.handleMessage({ type: "OUTLOOK_MONITOR_TEST_FEISHU" });
    const unconfirmed = await service.handleMessage({
      type: "OUTLOOK_MONITOR_SET_ENABLED",
      payload: { enabled: true }
    });

    expect(missingConfig).toEqual({
      ok: false,
      error: expect.stringContaining("机器人配置")
    });
    expect(unconfirmed).toEqual({
      ok: false,
      error: expect.stringContaining("四个平台")
    });
  });

  it("pauses monitoring when the destination group changes but allows rich mode to restart silently", async () => {
    const { chromeApi } = createChromeFake();
    const richDelivery = {
      sendTest: vi.fn().mockResolvedValue({ ok: true, code: 0 }),
      deliver: vi.fn().mockResolvedValue({ ok: true })
    };
    const service = createOutlookMonitorService({
      chromeApi,
      cryptoApi: webcrypto,
      now: () => currentTime,
      guiClient: { loadMail: vi.fn() },
      richDelivery
    });
    await service.handleMessage({
      type: "OUTLOOK_MONITOR_SAVE_CONFIG",
      payload: {
        deliveryMode: "rich",
        chatId: "oc_30c3295e3b77a970817952be0fffa7ee",
        rulesConfirmed: true
      }
    });
    await service.handleMessage({ type: "OUTLOOK_MONITOR_TEST_FEISHU" });
    await service.handleMessage({
      type: "OUTLOOK_MONITOR_SET_ENABLED",
      payload: { enabled: true }
    });

    const result = await service.handleMessage({
      type: "OUTLOOK_MONITOR_SAVE_CONFIG",
      payload: { chatId: "oc_a676db7b8ae16f5ca23a9dd9b15ed3ca" }
    });

    expect(result.snapshot.enabled).toBe(false);
    expect(result.snapshot.config.testedAt).toBeNull();
    expect(result.snapshot.status).toBe("ready");

    const restarted = await service.handleMessage({
      type: "OUTLOOK_MONITOR_SET_ENABLED",
      payload: { enabled: true }
    });
    expect(restarted.ok).toBe(true);
    expect(richDelivery.sendTest).toHaveBeenCalledTimes(1);
  });

  it("drops manual replay work when silently enabling the new destination", async () => {
    const { chromeApi, values } = createChromeFake();
    const richDelivery = {
      sendTest: vi.fn().mockResolvedValue({ ok: true, code: 0 }),
      deliver: vi.fn().mockResolvedValue({ ok: true })
    };
    const service = createOutlookMonitorService({
      chromeApi,
      cryptoApi: webcrypto,
      now: () => currentTime,
      guiClient: { loadMail: vi.fn() },
      richDelivery
    });
    await service.handleMessage({
      type: "OUTLOOK_MONITOR_SAVE_CONFIG",
      payload: {
        deliveryMode: "rich",
        chatId: "oc_a676db7b8ae16f5ca23a9dd9b15ed3ca",
        rulesConfirmed: true
      }
    });
    values[OUTLOOK_MONITOR_STORAGE_KEY].queue = [{
      id: "manual-replay-old-mail",
      dedupeKeys: ["manual-replay-old-mail"],
      mails: [candidateMail],
      attempts: 1,
      createdAt: currentTime,
      nextAttemptAt: currentTime,
      status: "pending",
      completedParts: []
    }];

    const result = await service.handleMessage({
      type: "OUTLOOK_MONITOR_SET_ENABLED",
      payload: { enabled: true }
    });

    expect(result.ok).toBe(true);
    expect(values[OUTLOOK_MONITOR_STORAGE_KEY].queue).toEqual([]);
    expect(richDelivery.sendTest).not.toHaveBeenCalled();
    expect(richDelivery.deliver).not.toHaveBeenCalled();
  });

  it("redacts webhook and secret from every public status response", async () => {
    const { chromeApi } = createChromeFake();
    const service = createOutlookMonitorService({
      chromeApi,
      cryptoApi: webcrypto,
      now: () => currentTime,
      sendWebhook: vi.fn().mockResolvedValue({ ok: true, code: 0, message: "success" })
    });
    await configureAndTest(service);

    const result = await service.handleMessage({ type: "OUTLOOK_MONITOR_GET" });

    expect(result.ok).toBe(true);
    expect(result.snapshot.config).toEqual({
      deliveryMode: "webhook",
      webhookConfigured: true,
      secretConfigured: true,
      chatIdConfigured: false,
      rulesConfirmed: true,
      testedAt: currentTime
    });
    expect(JSON.stringify(result)).not.toContain(webhookUrl);
    expect(result.snapshot.config).not.toHaveProperty("secret");
    expect(result.snapshot.config).not.toHaveProperty("webhookUrl");
  });

  it("queries the China Outlook tab and requests a scan", async () => {
    const { chromeApi } = createChromeFake();
    const sendWebhook = vi.fn().mockResolvedValue({ ok: true, code: 0, message: "success" });
    const service = createOutlookMonitorService({
      chromeApi,
      cryptoApi: webcrypto,
      now: () => currentTime,
      sendWebhook
    });
    await configureAndTest(service);
    await service.handleMessage({
      type: "OUTLOOK_MONITOR_SET_ENABLED",
      payload: { enabled: true }
    });
    chromeApi.tabs.sendMessage.mockClear();

    await service.handleScanAlarm();

    expect(chromeApi.tabs.query).toHaveBeenLastCalledWith({
      url: "https://partner.outlook.cn/mail/*"
    });
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(42, {
      type: "OUTLOOK_SCAN_REQUEST",
      reason: "alarm"
    });
  });

  it("establishes a baseline without sending historical mail", async () => {
    const scanResult = {
      ok: true,
      type: "OUTLOOK_SCAN_RESULT",
      page: validPage,
      mails: [candidateMail]
    };
    const { chromeApi, values } = createChromeFake(scanResult);
    const sendWebhook = vi.fn().mockResolvedValue({ ok: true, code: 0, message: "success" });
    const service = createOutlookMonitorService({
      chromeApi,
      cryptoApi: webcrypto,
      now: () => currentTime,
      sendWebhook
    });
    await configureAndTest(service);
    sendWebhook.mockClear();

    const result = await service.handleMessage({
      type: "OUTLOOK_MONITOR_SET_ENABLED",
      payload: { enabled: true }
    });

    expect(result.ok).toBe(true);
    expect(result.snapshot.status).toBe("monitoring");
    expect(result.snapshot.baselineComplete).toBe(true);
    expect(sendWebhook).not.toHaveBeenCalled();
    expect(Object.values(values[OUTLOOK_MONITOR_STORAGE_KEY].monitorState.seen)[0].status)
      .toBe("baseline");
  });

  it("stamps an activation cutoff and waits when Outlook has not rendered any rows", async () => {
    const { chromeApi, values } = createChromeFake();
    const sendWebhook = vi.fn().mockResolvedValue({ ok: true, code: 0, message: "success" });
    const service = createOutlookMonitorService({
      chromeApi,
      cryptoApi: webcrypto,
      now: () => currentTime,
      sendWebhook
    });
    await configureAndTest(service);
    sendWebhook.mockClear();

    const result = await service.handleMessage({
      type: "OUTLOOK_MONITOR_SET_ENABLED",
      payload: { enabled: true }
    });

    expect(result.ok).toBe(true);
    expect(result.snapshot.status).toBe("baselining");
    expect(result.snapshot.baselineComplete).toBe(false);
    expect(values[OUTLOOK_MONITOR_STORAGE_KEY].monitorState.notificationCutoffAt)
      .toBe(currentTime);
    expect(sendWebhook).not.toHaveBeenCalled();
  });

  it("clears pending historical delivery jobs when rebuilding the baseline", async () => {
    const { chromeApi, values } = createChromeFake();
    const sendWebhook = vi.fn()
      .mockResolvedValueOnce({ ok: true, code: 0, message: "success" })
      .mockResolvedValue({ ok: false, code: "NETWORK", message: "offline" });
    const service = createOutlookMonitorService({
      chromeApi,
      cryptoApi: webcrypto,
      now: () => currentTime,
      sendWebhook
    });
    await configureAndTest(service);
    await service.handleMessage({
      type: "OUTLOOK_MONITOR_SET_ENABLED",
      payload: { enabled: true }
    });
    currentTime += 60_000;
    await service.handleMessage({
      type: "OUTLOOK_SCAN_RESULT",
      page: validPage,
      mails: [newCandidateMail]
    });
    expect(values[OUTLOOK_MONITOR_STORAGE_KEY].queue).toHaveLength(1);

    await service.handleMessage({
      type: "OUTLOOK_MONITOR_REBASELINE",
      payload: { confirmed: true }
    });

    expect(values[OUTLOOK_MONITOR_STORAGE_KEY].queue).toEqual([]);
    expect(values[OUTLOOK_MONITOR_STORAGE_KEY].monitorState.notificationCutoffAt)
      .toBe(currentTime);
  });

  it("marks a new mail delivered only after Feishu returns success", async () => {
    const { chromeApi, values } = createChromeFake();
    const sendWebhook = vi.fn().mockResolvedValue({ ok: true, code: 0, message: "success" });
    const service = createOutlookMonitorService({
      chromeApi,
      cryptoApi: webcrypto,
      now: () => currentTime,
      sendWebhook
    });
    await configureAndTest(service);
    sendWebhook.mockClear();
    await service.handleMessage({
      type: "OUTLOOK_MONITOR_SET_ENABLED",
      payload: { enabled: true }
    });

    currentTime += 60_000;
    const result = await service.handleMessage({
      type: "OUTLOOK_SCAN_RESULT",
      page: validPage,
      mails: [newCandidateMail],
      reason: "mutation"
    });
    const stored = values[OUTLOOK_MONITOR_STORAGE_KEY];

    expect(result.ok).toBe(true);
    expect(sendWebhook).toHaveBeenCalledTimes(1);
    expect(Object.values(stored.monitorState.seen)[0].status).toBe("delivered");
    expect(stored.queue).toEqual([]);
    expect(stored.lastNotificationAt).toBe(currentTime);
  });

  it("keeps a failed delivery queued without marking the mail delivered", async () => {
    const { chromeApi, values } = createChromeFake();
    const sendWebhook = vi.fn()
      .mockResolvedValueOnce({ ok: true, code: 0, message: "success" })
      .mockResolvedValue({ ok: false, code: "NETWORK", message: "offline" });
    const service = createOutlookMonitorService({
      chromeApi,
      cryptoApi: webcrypto,
      now: () => currentTime,
      sendWebhook
    });
    await configureAndTest(service);
    await service.handleMessage({
      type: "OUTLOOK_MONITOR_SET_ENABLED",
      payload: { enabled: true }
    });

    currentTime += 60_000;
    await service.handleMessage({
      type: "OUTLOOK_SCAN_RESULT",
      page: validPage,
      mails: [newCandidateMail]
    });
    const stored = values[OUTLOOK_MONITOR_STORAGE_KEY];

    expect(Object.values(stored.monitorState.seen)[0].status).toBe("pending");
    expect(stored.queue).toHaveLength(1);
    expect(stored.queue[0]).toMatchObject({
      attempts: 1,
      nextAttemptAt: currentTime + 60_000,
      lastErrorCode: "NETWORK"
    });
    expect(stored.status).toBe("feishu_unavailable");
  });

  it("reports the precise Outlook page problem without storing mail rows", async () => {
    const { chromeApi, values } = createChromeFake();
    const service = createOutlookMonitorService({
      chromeApi,
      cryptoApi: webcrypto,
      now: () => currentTime,
      sendWebhook: vi.fn().mockResolvedValue({ ok: true, code: 0, message: "success" })
    });
    await configureAndTest(service);
    await service.handleMessage({
      type: "OUTLOOK_MONITOR_SET_ENABLED",
      payload: { enabled: true }
    });

    await service.handleMessage({
      type: "OUTLOOK_SCAN_RESULT",
      page: { ...validPage, folder: "Inbox", targetFolder: false },
      mails: [{ ...candidateMail, preview: "private" }]
    });

    expect(values[OUTLOOK_MONITOR_STORAGE_KEY].status).toBe("wrong_folder");
    expect(JSON.stringify(values[OUTLOOK_MONITOR_STORAGE_KEY])).not.toContain("private");
  });

  it("reads the Outlook GUI and delivers body plus resume in rich mode", async () => {
    const { chromeApi, values } = createChromeFake({
      ok: true,
      type: "OUTLOOK_SCAN_RESULT",
      page: validPage,
      mails: [candidateMail]
    });
    const guiClient = {
      loadMail: vi.fn().mockResolvedValue({
        body: "Full candidate email body",
        bodyTruncated: false,
        attachments: [{
          id: "attachment-1",
          name: "Resume.pdf",
          contentType: "application/pdf",
          size: 3,
          bytes: new Uint8Array([1, 2, 3])
        }],
        skippedAttachments: []
      })
    };
    const richDelivery = {
      sendTest: vi.fn().mockResolvedValue({ ok: true, code: 0 }),
      sendStatus: vi.fn().mockResolvedValue({ ok: true, code: 0 }),
      deliver: vi.fn().mockImplementation(async ({ onProgress }) => {
        await onProgress(["card"]);
        await onProgress(["card", "attachment:attachment-1"]);
        return { ok: true };
      })
    };
    const service = createOutlookMonitorService({
      chromeApi,
      cryptoApi: webcrypto,
      now: () => currentTime,
      guiClient,
      richDelivery
    });

    await service.handleMessage({
      type: "OUTLOOK_MONITOR_SAVE_CONFIG",
      payload: {
        deliveryMode: "rich",
        chatId: "oc_a676db7b8ae16f5ca23a9dd9b15ed3ca",
        rulesConfirmed: true
      }
    });
    await service.handleMessage({ type: "OUTLOOK_MONITOR_TEST_FEISHU" });
    await service.handleMessage({
      type: "OUTLOOK_MONITOR_SET_ENABLED",
      payload: { enabled: true }
    });

    currentTime += 60_000;
    await service.handleMessage({
      type: "OUTLOOK_SCAN_RESULT",
      page: validPage,
      mails: [newCandidateMail]
    });

    expect(guiClient.loadMail).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: newCandidateMail.conversationId,
      subject: newCandidateMail.subject
    }));
    expect(richDelivery.deliver).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "oc_a676db7b8ae16f5ca23a9dd9b15ed3ca",
      detail: expect.objectContaining({ body: "Full candidate email body" })
    }));
    expect(values[OUTLOOK_MONITOR_STORAGE_KEY].queue).toEqual([]);
    expect(values[OUTLOOK_MONITOR_STORAGE_KEY].status).toBe("monitoring");
    expect(JSON.stringify(values[OUTLOOK_MONITOR_STORAGE_KEY]))
      .not.toMatch(/Full candidate email body|Resume\.pdf|1,2,3/);
  });

  it("waits for the attachment before sending the complete mail reminder", async () => {
    const { chromeApi, values } = createChromeFake({
      ok: true,
      type: "OUTLOOK_SCAN_RESULT",
      page: validPage,
      mails: [candidateMail]
    });
    const guiClient = {
      loadMail: vi.fn()
        .mockResolvedValueOnce({
          body: "Candidate body",
          attachments: [],
          skippedAttachments: [{
            name: "Candidate.pdf",
            reason: "download-failed",
            stage: "outlook-browser-download-timeout"
          }],
          retryableAttachmentFailure: true
        })
        .mockResolvedValueOnce({
          body: "Candidate body",
          attachments: [{
            id: "resume",
            name: "Candidate.pdf",
            contentType: "application/pdf",
            bytes: new Uint8Array([1, 2, 3])
          }],
          skippedAttachments: [],
          retryableAttachmentFailure: false
        })
    };
    const richDelivery = {
      sendTest: vi.fn().mockResolvedValue({ ok: true, code: 0 }),
      deliver: vi.fn().mockImplementation(async ({ completedParts, onProgress }) => {
        if (!completedParts.includes("card")) await onProgress(["card"]);
        else await onProgress([...completedParts, "attachment:resume"]);
        return { ok: true };
      })
    };
    const service = createOutlookMonitorService({
      chromeApi,
      cryptoApi: webcrypto,
      now: () => currentTime,
      guiClient,
      richDelivery
    });
    await service.handleMessage({
      type: "OUTLOOK_MONITOR_SAVE_CONFIG",
      payload: {
        deliveryMode: "rich",
        chatId: "oc_30c3295e3b77a970817952be0fffa7ee",
        rulesConfirmed: true
      }
    });
    await service.handleMessage({ type: "OUTLOOK_MONITOR_TEST_FEISHU" });
    await service.handleMessage({
      type: "OUTLOOK_MONITOR_SET_ENABLED",
      payload: { enabled: true }
    });

    currentTime += 60_000;
    await service.handleMessage({
      type: "OUTLOOK_SCAN_RESULT",
      page: validPage,
      mails: [newCandidateMail]
    });

    let stored = values[OUTLOOK_MONITOR_STORAGE_KEY];
    expect(richDelivery.deliver).not.toHaveBeenCalled();
    expect(stored.status).toBe("attachment_retrying");
    expect(stored.queue[0]).toMatchObject({
      attempts: 1,
      lastErrorCode: "outlook-browser-download-timeout"
    });
    expect(stored.events.at(-1).code).toBe("attachment_retry_scheduled");

    chromeApi.tabs.sendMessage.mockResolvedValue({
      ok: true,
      type: "OUTLOOK_SCAN_RESULT",
      page: validPage,
      mails: [newCandidateMail]
    });
    const [retryResult, concurrentRetryResult] = await Promise.all([
      service.handleMessage({ type: "OUTLOOK_MONITOR_REPLAY_LATEST" }),
      service.handleMessage({ type: "OUTLOOK_MONITOR_REPLAY_LATEST" })
    ]);

    stored = values[OUTLOOK_MONITOR_STORAGE_KEY];
    expect(retryResult).toMatchObject({ ok: true, partial: false });
    expect(concurrentRetryResult).toMatchObject({ ok: true, partial: false });
    expect(guiClient.loadMail).toHaveBeenCalledTimes(2);
    expect(richDelivery.deliver).toHaveBeenCalledTimes(1);
    expect(richDelivery.deliver.mock.calls[0][0].completedParts).toEqual([]);
    expect(guiClient.loadMail.mock.calls[1][0]).toMatchObject({
      reuseRecentAttachmentDownload: true
    });
    expect(stored.queue).toEqual([]);
    expect(stored.status).toBe("monitoring");
  });

  it("recovers an attachment-only legacy job from the local download without reopening Outlook detail", async () => {
    const { chromeApi, values } = createChromeFake({
      ok: true,
      type: "OUTLOOK_SCAN_RESULT",
      page: validPage,
      mails: [newCandidateMail]
    });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const guiClient = {
      loadMail: vi.fn(),
      recoverDownloadedAttachments: vi.fn().mockResolvedValue([{
        id: "recovered-image",
        name: "BD73D418.png",
        contentType: "image/png",
        size: png.byteLength,
        bytes: png,
        localRef: {
          id: "recovered-image",
          path: "/Users/test/Downloads/BD73D418.png",
          name: "BD73D418.png",
          contentType: "image/png",
          expectedSize: png.byteLength
        }
      }])
    };
    const richDelivery = {
      sendTest: vi.fn().mockResolvedValue({ ok: true, code: 0 }),
      deliver: vi.fn().mockResolvedValue({ ok: true })
    };
    const service = createOutlookMonitorService({
      chromeApi,
      cryptoApi: webcrypto,
      now: () => currentTime,
      guiClient,
      richDelivery
    });
    await service.handleMessage({
      type: "OUTLOOK_MONITOR_SAVE_CONFIG",
      payload: {
        deliveryMode: "rich",
        chatId: "oc_30c3295e3b77a970817952be0fffa7ee",
        rulesConfirmed: true
      }
    });
    await service.handleMessage({ type: "OUTLOOK_MONITOR_TEST_FEISHU" });
    const jobCreatedAt = currentTime - 2 * 60 * 60 * 1000;
    values[OUTLOOK_MONITOR_STORAGE_KEY].queue = [{
      id: "legacy-job",
      dedupeKeys: ["legacy-job"],
      mails: [newCandidateMail],
      attempts: 13,
      createdAt: jobCreatedAt,
      nextAttemptAt: currentTime,
      status: "pending",
      lastErrorCode: "outlook-gui-detail",
      completedParts: ["card"]
    }];
    values[OUTLOOK_MONITOR_STORAGE_KEY].enabled = true;

    await service.handleAlarm({ name: "outlook-monitor-retry" });

    expect(guiClient.recoverDownloadedAttachments).toHaveBeenCalledWith({
      since: jobCreatedAt,
      until: jobCreatedAt + 30 * 60 * 1000
    });
    expect(guiClient.loadMail).not.toHaveBeenCalled();
    expect(richDelivery.deliver).toHaveBeenCalledWith(expect.objectContaining({
      completedParts: ["card"],
      detail: expect.objectContaining({
        attachments: [expect.objectContaining({ name: "BD73D418.png" })]
      })
    }));
    expect(values[OUTLOOK_MONITOR_STORAGE_KEY].queue).toEqual([]);
  });

  it("uses a newly downloaded retry copy when the original download window is empty", async () => {
    const { chromeApi, values } = createChromeFake();
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const attachment = {
      id: "recent-retry-pdf",
      name: "林诗青_简历_大使(1) (1).pdf",
      contentType: "application/pdf",
      size: pdf.byteLength,
      bytes: pdf,
      localRef: {
        path: "/Users/test/Downloads/林诗青_简历_大使(1) (1).pdf",
        name: "林诗青_简历_大使(1) (1).pdf",
        expectedSize: pdf.byteLength
      }
    };
    const guiClient = {
      recoverDownloadedAttachments: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([attachment]),
      loadMail: vi.fn().mockResolvedValue({
        body: "Candidate body",
        bodyTruncated: false,
        attachments: [],
        skippedAttachments: [],
        retryableAttachmentFailure: false
      })
    };
    const richDelivery = {
      sendTest: vi.fn().mockResolvedValue({ ok: true, code: 0 }),
      deliver: vi.fn().mockResolvedValue({ ok: true })
    };
    const service = createOutlookMonitorService({
      chromeApi,
      cryptoApi: webcrypto,
      now: () => currentTime,
      guiClient,
      richDelivery
    });
    await service.handleMessage({
      type: "OUTLOOK_MONITOR_SAVE_CONFIG",
      payload: {
        deliveryMode: "rich",
        chatId: "oc_a676db7b8ae16f5ca23a9dd9b15ed3ca",
        rulesConfirmed: true
      }
    });
    values[OUTLOOK_MONITOR_STORAGE_KEY].enabled = true;
    const jobCreatedAt = currentTime - 3 * 60 * 60_000;
    values[OUTLOOK_MONITOR_STORAGE_KEY].queue = [{
      id: "recent-retry-job",
      dedupeKeys: ["recent-retry-job"],
      mails: [newCandidateMail],
      attempts: 8,
      createdAt: jobCreatedAt,
      nextAttemptAt: currentTime,
      status: "pending",
      completedParts: []
    }];

    await service.retryPendingNow();

    expect(guiClient.recoverDownloadedAttachments).toHaveBeenNthCalledWith(1, {
      since: jobCreatedAt,
      until: jobCreatedAt + 30 * 60_000
    });
    expect(guiClient.recoverDownloadedAttachments).toHaveBeenNthCalledWith(2, {
      since: currentTime - 30 * 60_000,
      until: currentTime
    });
    expect(guiClient.loadMail).toHaveBeenCalledWith(expect.objectContaining({
      hasAttachment: false
    }));
    expect(richDelivery.deliver).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({
        body: "Candidate body",
        attachments: [attachment]
      })
    }));
    expect(values[OUTLOOK_MONITOR_STORAGE_KEY].queue).toEqual([]);
  });

  it("manually replays the latest visible mail without changing dedupe history", async () => {
    const scanResult = {
      ok: true,
      type: "OUTLOOK_SCAN_RESULT",
      page: validPage,
      mails: [{ ...candidateMail, subject: "投递 3.0-测试邮件" }]
    };
    const { chromeApi, values } = createChromeFake(scanResult);
    const guiClient = {
      loadMail: vi.fn().mockResolvedValue({
        body: "Candidate body",
        attachments: [{
          id: "resume-3",
          name: "Candidate.pdf",
          contentType: "application/pdf",
          bytes: new Uint8Array([1, 2, 3])
        }],
        skippedAttachments: []
      })
    };
    const richDelivery = {
      sendTest: vi.fn().mockResolvedValue({ ok: true, code: 0 }),
      deliver: vi.fn().mockResolvedValue({ ok: true })
    };
    const service = createOutlookMonitorService({
      chromeApi,
      cryptoApi: webcrypto,
      now: () => currentTime,
      guiClient,
      richDelivery
    });
    await service.handleMessage({
      type: "OUTLOOK_MONITOR_SAVE_CONFIG",
      payload: {
        deliveryMode: "rich",
        chatId: "oc_30c3295e3b77a970817952be0fffa7ee",
        rulesConfirmed: true
      }
    });
    await service.handleMessage({ type: "OUTLOOK_MONITOR_TEST_FEISHU" });

    const result = await service.handleMessage({ type: "OUTLOOK_MONITOR_REPLAY_LATEST" });

    expect(result).toMatchObject({ ok: true, replayedSubject: "投递 3.0-测试邮件" });
    expect(guiClient.loadMail).toHaveBeenCalledWith(expect.objectContaining({
      subject: "投递 3.0-测试邮件"
    }));
    expect(richDelivery.deliver).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "oc_30c3295e3b77a970817952be0fffa7ee",
      mail: expect.objectContaining({ dedupeKey: `manual-replay-${currentTime}` }),
      completedParts: []
    }));
    expect(values[OUTLOOK_MONITOR_STORAGE_KEY].monitorState.seen).toEqual({});
    expect(values[OUTLOOK_MONITOR_STORAGE_KEY].events.at(-1).code)
      .toBe("manual_replay_succeeded");
  });
});
