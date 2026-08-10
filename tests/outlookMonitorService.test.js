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
      error: expect.stringContaining("测试提醒")
    });
    expect(unconfirmed).toEqual({
      ok: false,
      error: expect.stringContaining("四个平台")
    });
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
      outlookClientConfigured: false,
      outlookTenantConfigured: false,
      outlookGraphAuthorized: false,
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

  it("authorizes Outlook Graph and delivers body plus resume in rich mode", async () => {
    const { chromeApi, values } = createChromeFake({
      ok: true,
      type: "OUTLOOK_SCAN_RESULT",
      page: validPage,
      mails: [candidateMail]
    });
    const graphAuth = {
      authorize: vi.fn().mockResolvedValue({ status: "authorized" }),
      clear: vi.fn()
    };
    const graphClient = {
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
      graphAuth,
      graphClient,
      richDelivery
    });

    await service.handleMessage({
      type: "OUTLOOK_MONITOR_SAVE_CONFIG",
      payload: {
        deliveryMode: "rich",
        chatId: "oc_a676db7b8ae16f5ca23a9dd9b15ed3ca",
        outlookClientId: "11111111-2222-4333-8444-555555555555",
        outlookTenantId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        rulesConfirmed: true
      }
    });
    await service.handleMessage({ type: "OUTLOOK_MONITOR_AUTHORIZE_GRAPH" });
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

    expect(graphAuth.authorize).toHaveBeenCalled();
    expect(graphClient.loadMail).toHaveBeenCalledWith(expect.objectContaining({
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
});
