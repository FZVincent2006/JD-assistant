const STATUS_COPY = {
  unconfigured: "请先配置四人群的飞书机器人。",
  needs_setup: "配置已保存，请发送测试提醒并确认四个平台分流规则。",
  ready: "准备就绪，可以开启监控。",
  baselining: "正在建立当前邮件基线，历史邮件不会发送提醒。",
  monitoring: "正常监控中，只提醒新的非平台投递。",
  outlook_tab_missing: "没有找到 Chrome 中的 Outlook 标签页。",
  outlook_unavailable: "暂时无法连接 Outlook 页面，请刷新标签页。",
  outlook_api_unavailable: "暂时无法读取邮件正文或附件，系统会自动重试。",
  outlook_api_authorization_required: "Outlook 正文与附件授权已失效，请重新授权。",
  login_required: "Outlook 登录已失效，请在 Chrome 中重新登录。",
  wrong_mailbox: "请切换到 recruiting@zhenfund.com 邮箱。",
  wrong_folder: "请在 Outlook 中打开“个人投递（需提醒）”文件夹。",
  feishu_unavailable: "飞书机器人暂时不可用，提醒已进入重试队列。",
  paused: "监控已暂停，不会发送新提醒。"
};

const EVENT_COPY = {
  config_saved: "已保存机器人配置",
  test_succeeded: "飞书测试提醒发送成功",
  test_failed: "飞书测试提醒发送失败",
  monitor_enabled: "已开启邮箱监控",
  monitor_paused: "已暂停邮箱监控",
  baseline_established: "已建立邮件基线",
  baseline_reset: "已重置邮件基线",
  new_mail_queued: "发现新的个人投递",
  notification_delivered: "飞书提醒发送成功",
  notification_failed: "飞书发送失败",
  outlook_tab_missing: "未找到 Outlook 标签页",
  outlook_unavailable: "暂时无法连接 Outlook",
  login_required: "Outlook 需要重新登录",
  wrong_mailbox: "当前不是目标邮箱",
  wrong_folder: "当前没有打开提醒文件夹",
  outlook_graph_authorized: "已授权读取 Outlook 正文和附件",
  outlook_graph_authorization_failed: "Outlook 正文与附件授权失败",
  outlook_graph_cleared: "已清除 Outlook 正文与附件授权"
};

export function formatOutlookMonitorStatus(snapshot) {
  return STATUS_COPY[snapshot?.status] || "正在读取 Outlook 提醒状态。";
}

export function monitorSetupChecklist(snapshot) {
  const config = snapshot?.config || {};
  const page = snapshot?.page || {};
  const richMode = config.deliveryMode === "rich";
  const robotConfigured = richMode
    ? Boolean(config.chatIdConfigured && config.outlookClientConfigured && config.outlookTenantConfigured)
    : Boolean(config.webhookConfigured && config.secretConfigured);
  const contentAuthorized = !richMode || Boolean(config.outlookGraphAuthorized);
  const testSucceeded = Boolean(config.testedAt);
  const rulesConfirmed = Boolean(config.rulesConfirmed);
  const outlookReady = Boolean(page.loggedIn && page.targetMailbox && page.targetFolder);
  return {
    robotConfigured,
    richMode,
    contentAuthorized,
    testSucceeded,
    rulesConfirmed,
    outlookReady,
    readyToEnable: robotConfigured && contentAuthorized && testSucceeded && rulesConfirmed && outlookReady
  };
}

export function describeOutlookEvent(event) {
  if (event?.code === "notification_delivered" && event.count) {
    return `已发送 ${event.count} 条飞书提醒`;
  }
  if (event?.code === "new_mail_queued" && event.count) {
    return `发现 ${event.count} 封新的个人投递`;
  }
  if (event?.code === "notification_failed" && event.errorCode) {
    return `飞书发送失败（${event.errorCode}）`;
  }
  return EVENT_COPY[event?.code] || "监控状态已更新";
}

export function formatMonitorTime(value) {
  if (!value) return "尚无";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}
