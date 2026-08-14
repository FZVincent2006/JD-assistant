import {
  applySuccessfulDelivery,
  emptyMonitorState,
  planScan
} from "./outlookMonitorCore.js";
import {
  deliveryBatchesFor,
  enqueueNotifications,
  getDueJobs,
  markDeliveryFailure,
  removeDeliveredJobs
} from "./outlookDeliveryQueue.js";
import {
  buildMailDigestCard,
  buildSingleMailCard,
  sendFeishuWebhook,
  validateFeishuWebhook
} from "./feishuWebhook.js";
import { validateFeishuChatId } from "./feishuRichMail.js";
import { createOutlookPageBridge } from "./outlookPageBridge.js";

export const OUTLOOK_MONITOR_STORAGE_KEY = "outlookMonitorStateV1";
export const OUTLOOK_SCAN_ALARM = "outlook-monitor-scan";
export const OUTLOOK_RETRY_ALARM = "outlook-monitor-retry";

const OUTLOOK_TAB_QUERY = "https://partner.outlook.cn/mail/*";
const TARGET_MAILBOX = "recruiting@zhenfund.com";
const TARGET_FOLDER = "个人投递（需提醒）";
const THIRTY_MINUTES = 30 * 60 * 1000;

export function createOutlookMonitorService({
  chromeApi = chrome,
  cryptoApi = globalThis.crypto,
  now = Date.now,
  sendWebhook = sendFeishuWebhook,
  pageBridge = createOutlookPageBridge({ chromeApi }),
  guiClient = null,
  richDelivery = null
} = {}) {
  let queueProcessing = null;
  async function initialize() {
    await chromeApi.alarms.create(OUTLOOK_SCAN_ALARM, { periodInMinutes: 10 });
    await chromeApi.alarms.create(OUTLOOK_RETRY_ALARM, { periodInMinutes: 1 });
    const state = await loadState();
    await saveState(state);
    return { ok: true };
  }

  async function handleMessage(message) {
    switch (message?.type) {
      case "OUTLOOK_MONITOR_GET":
        return { ok: true, snapshot: publicSnapshot(await loadState()) };
      case "OUTLOOK_MONITOR_SAVE_CONFIG":
        return saveConfig(message.payload || {});
      case "OUTLOOK_MONITOR_TEST_FEISHU":
        return testFeishu();
      case "OUTLOOK_MONITOR_SET_ENABLED":
        return setEnabled(Boolean(message.payload?.enabled));
      case "OUTLOOK_MONITOR_REBASELINE":
        return rebaseline(Boolean(message.payload?.confirmed));
      case "OUTLOOK_MONITOR_REPLAY_LATEST":
        return replayLatestMail();
      case "OUTLOOK_SCAN_RESULT":
        return handleScanResult(message);
      default:
        return { ok: false, error: "不支持的 Outlook 提醒操作。" };
    }
  }

  async function handleAlarm(alarm) {
    if (alarm?.name === OUTLOOK_SCAN_ALARM) return handleScanAlarm();
    if (alarm?.name === OUTLOOK_RETRY_ALARM) return handleRetryAlarm();
    return { ok: true, ignored: true };
  }

  async function handleScanAlarm() {
    const state = await loadState();
    if (!state.enabled) return { ok: true, skipped: "disabled" };

    const tabs = await chromeApi.tabs.query({ url: OUTLOOK_TAB_QUERY });
    const tab = tabs.find((candidate) => candidate?.id);
    if (!tab) return markOutlookMissing(state);

    try {
      const result = await pageBridge.send(tab.id, {
        type: "OUTLOOK_SCAN_REQUEST",
        reason: "alarm"
      });
      if (result?.type !== "OUTLOOK_SCAN_RESULT") {
        return updatePageProblem(state, "outlook_unavailable", null);
      }
      return handleScanResult(result);
    } catch {
      return updatePageProblem(state, "outlook_unavailable", null);
    }
  }

  async function handleRetryAlarm() {
    const state = await loadState();
    if (!state.enabled) return { ok: true, skipped: "disabled" };
    const dueJobs = getDueJobs(state.queue, now());
    if (dueJobs.length) {
      const tabs = await chromeApi.tabs.query({ url: OUTLOOK_TAB_QUERY });
      const tab = tabs.find((candidate) => candidate?.id);
      if (tab) {
        try {
          const scan = await pageBridge.send(tab.id, {
            type: "OUTLOOK_SCAN_REQUEST",
            reason: "retry"
          });
          if (scan?.type === "OUTLOOK_SCAN_RESULT" && !pageProblemStatus(sanitizePageState(scan.page))) {
            state.page = sanitizePageState(scan.page);
          }
        } catch {}
      }
    }
    return processQueue(state, dueJobs);
  }

  async function retryPendingNow() {
    const state = await loadState();
    if (!state.enabled) return { ok: true, skipped: "disabled" };
    const pendingJobs = (state.queue || []).filter((job) => job?.status === "pending");
    return processQueue(state, pendingJobs);
  }

  async function saveConfig(payload) {
    const state = await loadState();
    const nextConfig = { ...state.config };
    let credentialsChanged = false;

    if (typeof payload.webhookUrl === "string" && payload.webhookUrl.trim()) {
      const webhookUrl = payload.webhookUrl.trim();
      if (!validateFeishuWebhook(webhookUrl)) {
        return { ok: false, error: "请输入飞书 V2 自定义机器人的完整 Webhook 地址。" };
      }
      credentialsChanged ||= webhookUrl !== nextConfig.webhookUrl;
      nextConfig.webhookUrl = webhookUrl;
    }
    if (typeof payload.secret === "string" && payload.secret) {
      credentialsChanged ||= payload.secret !== nextConfig.secret;
      nextConfig.secret = payload.secret;
    }
    if (typeof payload.rulesConfirmed === "boolean") {
      nextConfig.rulesConfirmed = payload.rulesConfirmed;
    }
    if (payload.deliveryMode === "webhook" || payload.deliveryMode === "rich") {
      credentialsChanged ||= payload.deliveryMode !== nextConfig.deliveryMode;
      nextConfig.deliveryMode = payload.deliveryMode;
    }
    if (typeof payload.chatId === "string" && payload.chatId.trim()) {
      const chatId = payload.chatId.trim();
      if (!validateFeishuChatId(chatId)) {
        return { ok: false, error: "请输入以 oc_ 开头的飞书群 ID。" };
      }
      credentialsChanged ||= chatId !== nextConfig.chatId;
      nextConfig.chatId = chatId;
    }
    if (credentialsChanged) nextConfig.testedAt = null;

    const nextEnabled = credentialsChanged ? false : state.enabled;
    const nextState = {
      ...state,
      config: nextConfig,
      queue: credentialsChanged ? [] : state.queue,
      enabled: nextEnabled,
      status: nextEnabled
        ? state.status
        : readinessStatus(nextConfig)
    };
    if (credentialsChanged && state.enabled) {
      appendEvent(nextState, "monitor_paused", now());
    }
    if (credentialsChanged && state.queue.length) {
      appendEvent(nextState, "destination_queue_cleared", now(), state.queue.length);
    }
    appendEvent(nextState, "config_saved", now());
    await saveState(nextState);
    return { ok: true, snapshot: publicSnapshot(nextState) };
  }

  async function testFeishu() {
    const state = await loadState();
    let result;
    if (state.config.deliveryMode === "rich") {
      if (!richDelivery || !validateFeishuChatId(state.config.chatId)) {
        return { ok: false, error: "请先保存飞书群 ID，并确认已安装本机授权助手。" };
      }
      try {
        result = await richDelivery.sendTest(state.config.chatId);
      } catch (error) {
        result = { ok: false, code: error?.code || error?.stage || "RICH_DELIVERY" };
      }
    } else {
      if (!state.config.webhookUrl || !state.config.secret) {
        return { ok: false, error: "请先保存飞书机器人 Webhook 和签名密钥。" };
      }
      result = await sendWebhook(
        state.config,
        buildMonitorStatusCard(
          "Outlook 简历提醒测试成功",
          "这个群将接收 recruiting@zhenfund.com 的非平台新投递提醒。",
          "green"
        ),
        { cryptoApi, now }
      );
    }
    if (!result?.ok) {
      const nextState = {
        ...state,
        status: "feishu_unavailable"
      };
      appendEvent(nextState, "test_failed", now(), result?.code);
      await saveState(nextState);
      return { ok: false, error: state.config.deliveryMode === "rich"
        ? "完整邮件测试失败，请检查群 ID、机器人权限和本机授权助手。"
        : "测试提醒发送失败，请检查 Webhook 和签名密钥。" };
    }

    const testedAt = now();
    const nextState = {
      ...state,
      config: { ...state.config, testedAt },
      status: state.enabled ? state.status : readinessStatus({
        ...state.config,
        testedAt
      })
    };
    appendEvent(nextState, "test_succeeded", testedAt);
    await saveState(nextState);
    return { ok: true, snapshot: publicSnapshot(nextState) };
  }

  async function setEnabled(enabled) {
    const state = await loadState();
    if (!enabled) {
      const nextState = { ...state, enabled: false, status: "paused" };
      appendEvent(nextState, "monitor_paused", now());
      await saveState(nextState);
      return { ok: true, snapshot: publicSnapshot(nextState) };
    }
    if (!deliveryConfigured(state.config)) {
      return { ok: false, error: "请先保存飞书群 ID 或机器人配置。" };
    }
    if (state.config.deliveryMode !== "rich" && !state.config.testedAt) {
      return { ok: false, error: "兼容模式请先成功发送一条飞书测试提醒。" };
    }
    if (!state.config.rulesConfirmed) {
      return { ok: false, error: "请先确认脉脉、猎聘、实习僧和 BOSS 直聘四个平台分流规则。" };
    }

    const enabledAt = now();
    const monitorState = state.monitorState.baselineComplete
      ? state.monitorState
      : {
          ...state.monitorState,
          notificationCutoffAt: state.monitorState.notificationCutoffAt || enabledAt
        };
    const nextState = {
      ...state,
      enabled: true,
      queue: state.queue.filter((job) => !String(job?.id || "").startsWith("manual-replay-")),
      monitorState,
      status: monitorState.baselineComplete ? "monitoring" : "baselining"
    };
    appendEvent(nextState, "monitor_enabled", enabledAt);
    await saveState(nextState);
    await handleScanAlarm();
    return { ok: true, snapshot: publicSnapshot(await loadState()) };
  }

  async function rebaseline(confirmed) {
    if (!confirmed) return { ok: false, error: "重新建立基线需要再次确认。" };
    const state = await loadState();
    const resetAt = now();
    const nextState = {
      ...state,
      monitorState: {
        ...emptyMonitorState(),
        notificationCutoffAt: state.enabled ? resetAt : null
      },
      queue: [],
      status: state.enabled ? "baselining" : readinessStatus(state.config)
    };
    appendEvent(nextState, "baseline_reset", resetAt);
    await saveState(nextState);
    if (state.enabled) await handleScanAlarm();
    return { ok: true, snapshot: publicSnapshot(await loadState()) };
  }

  async function replayLatestMail() {
    const state = await loadState();
    if (state.config.deliveryMode !== "rich"
      || !validateFeishuChatId(state.config.chatId)
      || !guiClient
      || !richDelivery) {
      return { ok: false, error: "请先保存飞书群 ID，并完成附件发送测试。" };
    }

    const tabs = await chromeApi.tabs.query({ url: OUTLOOK_TAB_QUERY });
    const tab = tabs.find((candidate) => candidate?.id);
    if (!tab) return { ok: false, error: "请先打开 Recruiting Outlook 标签页。" };

    let scan;
    try {
      scan = await pageBridge.send(tab.id, {
        type: "OUTLOOK_SCAN_REQUEST",
        reason: "manual_replay"
      });
    } catch {
      return { ok: false, error: "Outlook 页面尚未加载新版助手，请刷新邮箱页面后重试。" };
    }
    const page = sanitizePageState(scan?.page);
    const pageProblem = pageProblemStatus(page);
    if (scan?.type !== "OUTLOOK_SCAN_RESULT" || pageProblem) {
      return { ok: false, error: "请确认 Recruiting 邮箱和“个人投递（需提醒）”文件夹已打开。" };
    }
    const [mail] = sanitizeScanMails(scan.mails);
    if (!mail) return { ok: false, error: "当前文件夹中没有可重新推送的邮件。" };

    const replayedAt = now();
    const pendingAttachmentJob = state.queue.find((job) =>
      job?.status === "pending"
      && job?.mails?.[0]?.conversationId === mail.conversationId
    );
    if (pendingAttachmentJob) {
      const forcedState = {
        ...state,
        page,
        lastScanAt: replayedAt,
        queue: state.queue.map((job) => job.id === pendingAttachmentJob.id
          ? { ...job, nextAttemptAt: replayedAt }
          : job)
      };
      appendEvent(forcedState, "attachment_retry_requested", replayedAt);
      await saveState(forcedState);
      await processQueue(forcedState);
      const afterRetry = await loadState();
      const stillPending = afterRetry.queue.some((job) => job.id === pendingAttachmentJob.id);
      return {
        ok: true,
        partial: stillPending,
        replayedSubject: mail.subject,
        message: stillPending
          ? "已立即重试完整提醒；附件尚未准备好时不会发送不完整的邮件卡片。"
          : pendingAttachmentJob.completedParts?.includes("card")
            ? "简历附件已重新下载并发送；邮件卡片没有重复发送。"
            : "邮件正文和简历附件已完整发送。",
        snapshot: publicSnapshot(afterRetry)
      };
    }

    const replayDedupeKey = `manual-replay-${replayedAt}`;
    let completedParts = [];
    try {
      const { detail, loadError } = await loadRichDetailForDelivery(mail);
      if (loadError && mail.hasAttachment) throw loadError;
      if (detail.retryableAttachmentFailure) throw attachmentRetryError(detail);
      await richDelivery.deliver({
        chatId: state.config.chatId,
        mail: { ...mail, dedupeKey: replayDedupeKey },
        detail,
        completedParts: [],
        onProgress: async (nextCompletedParts) => {
          completedParts = [...nextCompletedParts];
        }
      });
      const nextState = {
        ...state,
        page,
        lastScanAt: replayedAt,
        lastNotificationAt: replayedAt
      };
      appendEvent(nextState, "manual_replay_succeeded", replayedAt);
      await saveState(nextState);
      return {
        ok: true,
        replayedSubject: mail.subject,
        snapshot: publicSnapshot(nextState)
      };
    } catch (error) {
      const errorCode = error?.code || error?.stage || "RICH_DELIVERY";
      const attachmentPending = mail.hasAttachment && String(errorCode).startsWith("outlook-");
      const queued = attachmentPending
        ? enqueueNotifications(state.queue, [{ ...mail, dedupeKey: replayDedupeKey }], replayedAt)
          .map((job) => job.id === replayDedupeKey
            ? markDeliveryFailure({ ...job, completedParts }, replayedAt, errorCode)
            : job)
        : state.queue;
      const nextState = {
        ...state,
        queue: queued,
        page,
        status: attachmentPending ? "attachment_retrying" : state.status,
        lastScanAt: replayedAt
      };
      appendEvent(
        nextState,
        attachmentPending ? "manual_replay_attachment_pending" : "manual_replay_failed",
        replayedAt,
        errorCode
      );
      await saveState(nextState);
      if (attachmentPending) {
        return {
          ok: true,
          partial: true,
          replayedSubject: mail.subject,
          message: "附件尚未准备好，完整提醒已进入自动重试队列，当前不会发送不完整卡片。",
          snapshot: publicSnapshot(nextState)
        };
      }
      return {
        ok: false,
        error: `重新推送失败（${String(errorCode).slice(0, 80)}）。请查看最近记录。`,
        snapshot: publicSnapshot(nextState)
      };
    }
  }

  async function loadRichDetailForDelivery(mail) {
    try {
      return { detail: await guiClient.loadMail(mail), loadError: null };
    } catch (error) {
      return {
        detail: {
          body: "（邮件正文暂时无法读取，系统将继续重试。）",
          bodyTruncated: false,
          attachments: [],
          skippedAttachments: mail?.hasAttachment
            ? [{ name: "邮件中的简历附件", reason: "processing" }]
            : [],
          retryableAttachmentFailure: Boolean(mail?.hasAttachment)
        },
        loadError: error
      };
    }
  }

  async function handleScanResult(message) {
    const state = await loadState();
    const page = sanitizePageState(message?.page);

    if (!state.enabled) {
      const nextState = {
        ...state,
        page,
        status: deliveryConfigured(state.config) ? "paused" : "unconfigured"
      };
      await saveState(nextState);
      return { ok: true, snapshot: publicSnapshot(nextState) };
    }

    const pageProblem = pageProblemStatus(page);
    if (pageProblem) return updatePageProblem(state, pageProblem, page);

    const scanTime = now();
    const plan = await planScan(
      state.monitorState,
      sanitizeScanMails(message?.mails),
      scanTime,
      cryptoApi
    );
    const nextState = {
      ...state,
      page,
      monitorState: plan.nextState,
      queue: enqueueNotifications(state.queue, plan.notifications, scanTime),
      status: plan.nextState.baselineComplete ? "monitoring" : "baselining",
      lastScanAt: scanTime,
      outlookMissingSince: null
    };
    if (!state.monitorState.baselineComplete && plan.nextState.baselineComplete) {
      appendEvent(nextState, "baseline_established", scanTime);
    } else if (plan.notifications.length) {
      appendEvent(nextState, "new_mail_queued", scanTime, plan.notifications.length);
    }

    await maybeSendRecoveryNotice(nextState);
    await saveState(nextState);
    return processQueue(nextState);
  }

  async function processQueue(providedState, providedDueJobs = null) {
    if (queueProcessing) return queueProcessing;
    queueProcessing = processQueueOnce(providedState, providedDueJobs);
    try {
      return await queueProcessing;
    } finally {
      queueProcessing = null;
    }
  }

  async function processQueueOnce(providedState, providedDueJobs = null) {
    let state = providedState || await loadState();
    const dueJobs = providedDueJobs || getDueJobs(state.queue, now());
    if (!dueJobs.length) {
      await saveState(state);
      return { ok: true, snapshot: publicSnapshot(state) };
    }

    if (state.config.deliveryMode === "rich") {
      return processRichQueue(state, dueJobs);
    }

    for (const batch of deliveryBatchesFor(dueJobs)) {
      const payload = batch.digest
        ? buildMailDigestCard(batch.mails)
        : buildSingleMailCard(batch.mails[0]);
      const result = await sendWebhook(
        state.config,
        payload,
        { cryptoApi, now }
      );
      const deliveryTime = now();
      if (result?.ok) {
        state = {
          ...state,
          monitorState: applySuccessfulDelivery(
            state.monitorState,
            batch.dedupeKeys,
            deliveryTime
          ),
          queue: removeDeliveredJobs(state.queue, batch.dedupeKeys),
          status: "monitoring",
          lastNotificationAt: deliveryTime
        };
        appendEvent(state, "notification_delivered", deliveryTime, batch.dedupeKeys.length);
        continue;
      }

      const failedIds = new Set(batch.jobIds);
      state = {
        ...state,
        queue: state.queue.map((job) =>
          failedIds.has(job.id)
            ? markDeliveryFailure(job, deliveryTime, result?.code)
            : job
        ),
        status: "feishu_unavailable"
      };
      appendEvent(state, "notification_failed", deliveryTime, result?.code);
    }

    const expired = state.queue.some((job) => job.status === "expired");
    if (expired) {
      await chromeApi.notifications.create("outlook-monitor-feishu-error", {
        type: "basic",
        iconUrl: "assets/zhenfund-logo.png",
        title: "Outlook 简历提醒需要检查",
        message: "飞书提醒持续失败，请打开扩展检查机器人配置。"
      });
    }
    await saveState(state);
    return { ok: true, snapshot: publicSnapshot(state) };
  }

  async function processRichQueue(initialState, dueJobs) {
    let state = initialState;
    if (!guiClient || !richDelivery) {
      state.status = "outlook_api_unavailable";
      await saveState(state);
      return { ok: true, snapshot: publicSnapshot(state) };
    }
    for (const dueJob of dueJobs) {
      const mail = dueJob.mails?.[0];
      try {
        const { detail, loadError } = await detailForQueuedJob(dueJob, mail);
        if (loadError && mail?.hasAttachment) throw loadError;
        if (detail.retryableAttachmentFailure) throw attachmentRetryError(detail);
        const preparedDetail = prepareDetailSnapshot(detail);
        if (preparedDetail) {
          state = {
            ...state,
            queue: state.queue.map((job) => job.id === dueJob.id
              ? { ...job, preparedDetail }
              : job)
          };
          await saveState(state);
        }
        await richDelivery.deliver({
          chatId: state.config.chatId,
          mail: { ...mail, dedupeKey: dueJob.dedupeKeys?.[0] || dueJob.id },
          detail,
          completedParts: dueJob.completedParts || [],
          onProgress: async (completedParts) => {
            state = {
              ...state,
              queue: state.queue.map((job) => job.id === dueJob.id
                ? { ...job, completedParts: [...completedParts] }
                : job)
            };
            await saveState(state);
          }
        });
        const deliveryTime = now();
        state = {
          ...state,
          monitorState: applySuccessfulDelivery(
            state.monitorState,
            dueJob.dedupeKeys,
            deliveryTime
          ),
          queue: removeDeliveredJobs(state.queue, dueJob.dedupeKeys),
          status: "monitoring",
          lastNotificationAt: deliveryTime
        };
        appendEvent(state, "notification_delivered", deliveryTime, dueJob.dedupeKeys.length);
      } catch (error) {
        const deliveryTime = now();
        const errorCode = error?.code || error?.stage || "RICH_DELIVERY";
        const attachmentFailure = Boolean(mail?.hasAttachment)
          && String(error?.stage || "").startsWith("outlook-");
        state = {
          ...state,
          queue: state.queue.map((job) => job.id === dueJob.id
            ? markDeliveryFailure(job, deliveryTime, errorCode)
            : job),
          status: attachmentFailure
            ? "attachment_retrying"
            : String(error?.stage || "").startsWith("outlook-")
              ? "outlook_api_unavailable"
            : "feishu_unavailable"
        };
        appendEvent(
          state,
          attachmentFailure ? "attachment_retry_scheduled" : "notification_failed",
          deliveryTime,
          errorCode
        );
      }
      await saveState(state);
    }
    const expired = state.queue.some((job) => job.status === "expired");
    if (expired) {
      await chromeApi.notifications.create("outlook-monitor-feishu-error", {
        type: "basic",
        iconUrl: "assets/zhenfund-logo.png",
        title: "Outlook 简历提醒需要检查",
        message: "正文或简历附件持续发送失败，请打开扩展检查授权与机器人配置。"
      });
    }
    return { ok: true, snapshot: publicSnapshot(state) };
  }

  async function detailForQueuedJob(dueJob, mail) {
    if (dueJob?.preparedDetail && typeof guiClient?.restorePreparedDetail === "function") {
      try {
        return {
          detail: await guiClient.restorePreparedDetail(dueJob.preparedDetail),
          loadError: null
        };
      } catch {
        // The user may have removed the local file. Fall back to Outlook below.
      }
    }
    if (mail?.hasAttachment
      && Number(dueJob?.attempts || 0) > 0
      && typeof guiClient?.recoverDownloadedAttachments === "function") {
      try {
        let attachments = await guiClient.recoverDownloadedAttachments({
          since: Number(dueJob.createdAt || 0),
          until: Number(dueJob.createdAt || 0) + THIRTY_MINUTES
        });
        if (!attachments.length) {
          attachments = await guiClient.recoverDownloadedAttachments({
            since: now() - THIRTY_MINUTES,
            until: now()
          });
        }
        if (attachments.length) {
          if (dueJob?.completedParts?.includes("card")) {
            return {
              detail: {
                body: "",
                bodyTruncated: false,
                attachments,
                skippedAttachments: [],
                retryableAttachmentFailure: false
              },
              loadError: null
            };
          }
          const bodyResult = await loadRichDetailForDelivery({ ...mail, hasAttachment: false });
          return {
            detail: {
              ...bodyResult.detail,
              attachments,
              skippedAttachments: [],
              retryableAttachmentFailure: false
            },
            loadError: null
          };
        }
      } catch {
        // Fall back to the Outlook page when recovery is ambiguous.
      }
    }
    return loadRichDetailForDelivery({
      ...mail,
      reuseRecentAttachmentDownload: Number(dueJob?.attempts || 0) > 0,
      attachmentSearchSince: Math.max(
        Number(dueJob?.createdAt || 0),
        now() - THIRTY_MINUTES
      ),
      attachmentSearchUntil: now()
    });
  }

  async function markOutlookMissing(state) {
    const currentTime = now();
    const nextState = {
      ...state,
      status: "outlook_tab_missing",
      outlookMissingSince: state.outlookMissingSince || currentTime,
      page: null
    };
    if (
      currentTime - nextState.outlookMissingSince >= THIRTY_MINUTES &&
      !nextState.outlookPauseNotifiedAt
    ) {
      const result = await sendStatusNotice(
        nextState.config,
        "邮箱监控已暂停",
        "30 分钟内未找到已登录的 Recruiting Outlook 标签页。",
        "orange"
      );
      if (result?.ok) nextState.outlookPauseNotifiedAt = currentTime;
    }
    appendEvent(nextState, "outlook_tab_missing", currentTime);
    await saveState(nextState);
    return { ok: true, snapshot: publicSnapshot(nextState) };
  }

  async function maybeSendRecoveryNotice(state) {
    if (!state.outlookPauseNotifiedAt) return;
    const result = await sendStatusNotice(
      state.config,
      "邮箱监控已恢复",
      "已重新连接 Recruiting Outlook，并恢复新投递扫描。",
      "green"
    );
    if (result?.ok) state.outlookPauseNotifiedAt = null;
  }

  async function sendStatusNotice(config, title, message, template) {
    if (config.deliveryMode === "rich") {
      try {
        return await richDelivery?.sendStatus?.(config.chatId, title, message, template) || { ok: false };
      } catch (error) {
        return { ok: false, code: error?.code || error?.stage || "RICH_DELIVERY" };
      }
    }
    return sendWebhook(
      config,
      buildMonitorStatusCard(title, message, template),
      { cryptoApi, now }
    );
  }

  async function updatePageProblem(state, status, page) {
    const nextState = {
      ...state,
      status,
      page,
      lastScanAt: now()
    };
    appendEvent(nextState, status, now());
    await saveState(nextState);
    return { ok: true, snapshot: publicSnapshot(nextState) };
  }

  async function loadState() {
    const stored = await chromeApi.storage.local.get(OUTLOOK_MONITOR_STORAGE_KEY);
    return normalizeDocument(stored?.[OUTLOOK_MONITOR_STORAGE_KEY]);
  }

  async function saveState(state) {
    await chromeApi.storage.local.set({
      [OUTLOOK_MONITOR_STORAGE_KEY]: normalizeDocument(state)
    });
  }

  return {
    initialize,
    handleMessage,
    handleAlarm,
    handleScanAlarm,
    handleRetryAlarm,
    retryPendingNow
  };
}

function attachmentRetryError(detail) {
  const failure = (detail?.skippedAttachments || []).find((item) => item?.stage);
  const error = new Error("Resume attachment will be retried");
  error.stage = failure?.stage || "outlook-attachment-retry";
  return error;
}

function prepareDetailSnapshot(detail) {
  const attachments = detail?.attachments || [];
  if (attachments.some((attachment) => !attachment?.localRef?.path)) return null;
  return {
    body: String(detail?.body || "").slice(0, 12_000),
    bodyTruncated: Boolean(detail?.bodyTruncated),
    skippedAttachments: (detail?.skippedAttachments || []).map((item) => ({
      name: String(item?.name || "").slice(0, 180),
      reason: String(item?.reason || "").slice(0, 80)
    })),
    attachmentRefs: attachments.map((attachment) => ({
      ...attachment.localRef,
      id: String(attachment.id || attachment.localRef.id || "attachment").slice(0, 512),
      path: String(attachment.localRef.path || "").slice(0, 2_048),
      name: String(attachment.name || attachment.localRef.name || "resume").slice(0, 180),
      contentType: String(attachment.contentType || attachment.localRef.contentType || "")
        .slice(0, 120),
      expectedSize: Number(attachment.size || attachment.localRef.expectedSize || 0)
    }))
  };
}

function normalizeDocument(value) {
  const storedMonitorState = value?.monitorState || {};
  return {
    schemaVersion: 2,
    config: {
      deliveryMode: "webhook",
      webhookUrl: "",
      secret: "",
      chatId: "",
      rulesConfirmed: false,
      testedAt: null,
      ...(value?.config || {})
    },
    enabled: Boolean(value?.enabled),
    status: value?.status || "unconfigured",
    monitorState: {
      ...emptyMonitorState(),
      ...storedMonitorState,
      notificationCutoffAt:
        storedMonitorState.notificationCutoffAt ||
        (storedMonitorState.baselineComplete ? storedMonitorState.baselineAt : null),
      seen: { ...(storedMonitorState.seen || {}) }
    },
    queue: [...(value?.queue || [])],
    events: [...(value?.events || [])].slice(-20),
    page: value?.page || null,
    lastScanAt: value?.lastScanAt || null,
    lastNotificationAt: value?.lastNotificationAt || null,
    outlookMissingSince: value?.outlookMissingSince || null,
    outlookPauseNotifiedAt: value?.outlookPauseNotifiedAt || null
  };
}

function publicSnapshot(state) {
  return {
    enabled: state.enabled,
    status: state.status,
    targetMailbox: TARGET_MAILBOX,
    targetFolder: TARGET_FOLDER,
    config: {
      deliveryMode: state.config.deliveryMode,
      webhookConfigured: Boolean(state.config.webhookUrl),
      secretConfigured: Boolean(state.config.secret),
      chatIdConfigured: Boolean(state.config.chatId),
      rulesConfirmed: Boolean(state.config.rulesConfirmed),
      testedAt: state.config.testedAt || null
    },
    page: state.page,
    baselineComplete: Boolean(state.monitorState.baselineComplete),
    baselineAt: state.monitorState.baselineAt || null,
    lastScanAt: state.lastScanAt,
    lastNotificationAt: state.lastNotificationAt,
    queueCount: state.queue.filter((job) => job.status === "pending").length,
    expiredCount: state.queue.filter((job) => job.status === "expired").length,
    events: state.events
  };
}

function sanitizePageState(page) {
  if (!page) return null;
  return {
    supported: Boolean(page.supported),
    mailbox: String(page.mailbox || "").slice(0, 254),
    folder: String(page.folder || "").slice(0, 120),
    loggedIn: Boolean(page.loggedIn),
    targetMailbox: Boolean(page.targetMailbox),
    targetFolder: Boolean(page.targetFolder)
  };
}

function sanitizeScanMails(mails) {
  return (mails || []).map((mail) => ({
    conversationId: String(mail?.conversationId || "").slice(0, 180),
    senderName: String(mail?.senderName || "").slice(0, 120),
    senderEmail: String(mail?.senderEmail || "").slice(0, 254),
    subject: String(mail?.subject || "").slice(0, 240),
    receivedTime: String(mail?.receivedTime || "").slice(0, 80),
    hasAttachment: Boolean(mail?.hasAttachment)
  })).filter((mail) => mail.conversationId && mail.subject && mail.receivedTime);
}

function pageProblemStatus(page) {
  if (!page?.supported) return "outlook_unavailable";
  if (!page.loggedIn) return "login_required";
  if (!page.targetMailbox) return "wrong_mailbox";
  if (!page.targetFolder) return "wrong_folder";
  return "";
}

function readinessStatus(config) {
  if (!deliveryConfigured(config)) return "unconfigured";
  if (!config.rulesConfirmed) return "needs_setup";
  if (config.deliveryMode !== "rich" && !config.testedAt) return "needs_setup";
  return "ready";
}

function deliveryConfigured(config) {
  if (config?.deliveryMode === "rich") {
    return validateFeishuChatId(config.chatId);
  }
  return Boolean(config?.webhookUrl && config?.secret);
}

function appendEvent(state, code, at, detail) {
  const event = {
    code: String(code || "event").slice(0, 80),
    at: Number(at || Date.now())
  };
  if (typeof detail === "number") event.count = detail;
  else if (detail != null) event.errorCode = String(detail).slice(0, 80);
  state.events = [...(state.events || []), event].slice(-20);
}

function buildMonitorStatusCard(title, message, template) {
  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: {
        template,
        title: { tag: "plain_text", content: title }
      },
      elements: [{
        tag: "div",
        text: { tag: "plain_text", content: message }
      }]
    }
  };
}
