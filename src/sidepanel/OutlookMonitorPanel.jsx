import React, { useEffect, useMemo, useState } from "react";
import {
  BellRing,
  Bot,
  Check,
  CircleAlert,
  ExternalLink,
  Pause,
  Play,
  RefreshCw,
  Save,
  Send
} from "lucide-react";
import {
  authorizeOutlookGraph,
  clearOutlookGraphAuthorization,
  getOutlookMonitorStatus,
  rebaselineOutlookMonitor,
  saveOutlookMonitorConfig,
  setOutlookMonitorEnabled,
  testOutlookMonitorFeishu
} from "./outlookMonitorApi.js";
import {
  describeOutlookEvent,
  formatMonitorTime,
  formatOutlookMonitorStatus,
  monitorSetupChecklist
} from "./outlookMonitorUi.js";

export default function OutlookMonitorPanel() {
  const [snapshot, setSnapshot] = useState(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [deliveryMode, setDeliveryMode] = useState("webhook");
  const [chatId, setChatId] = useState("");
  const [outlookClientId, setOutlookClientId] = useState("");
  const [outlookTenantId, setOutlookTenantId] = useState("");
  const [rulesConfirmed, setRulesConfirmed] = useState(false);
  const [message, setMessage] = useState("正在读取监控状态…");
  const [busy, setBusy] = useState(false);
  const checklist = useMemo(() => monitorSetupChecklist(snapshot), [snapshot]);

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    const result = await getOutlookMonitorStatus();
    applyResult(result, "状态已刷新。");
  }

  function applyResult(result, successMessage) {
    if (!result?.ok) {
      setMessage(result?.error || "操作失败，请稍后重试。");
      return false;
    }
    if (result.snapshot) {
      setSnapshot(result.snapshot);
      setRulesConfirmed(Boolean(result.snapshot.config?.rulesConfirmed));
      setDeliveryMode(result.snapshot.config?.deliveryMode || "webhook");
    }
    setMessage(successMessage);
    return true;
  }

  async function run(action, successMessage) {
    setBusy(true);
    try {
      const result = await action();
      return applyResult(result, successMessage);
    } finally {
      setBusy(false);
    }
  }

  async function saveConfig() {
    const saved = await run(
      () => saveOutlookMonitorConfig({
        deliveryMode,
        webhookUrl,
        secret,
        chatId,
        outlookClientId,
        outlookTenantId,
        rulesConfirmed
      }),
      "机器人配置已保存在这台电脑的 Chrome 中。"
    );
    if (saved) {
      setWebhookUrl("");
      setSecret("");
      setChatId("");
      setOutlookClientId("");
      setOutlookTenantId("");
    }
  }

  async function sendTest() {
    await run(
      () => testOutlookMonitorFeishu(),
      "测试提醒已发送，请在四人群中确认。"
    );
  }

  async function connectOutlookContent() {
    await run(
      () => authorizeOutlookGraph(),
      "已授权读取新邮件正文和简历附件。"
    );
  }

  async function disconnectOutlookContent() {
    await run(
      () => clearOutlookGraphAuthorization(),
      "已清除 Outlook 正文与附件授权。"
    );
  }

  async function enableMonitor() {
    await run(
      () => setOutlookMonitorEnabled(true),
      "监控已开启；当前邮件已作为历史基线。"
    );
  }

  async function pauseMonitor() {
    await run(
      () => setOutlookMonitorEnabled(false),
      "监控已暂停。"
    );
  }

  async function rebuildBaseline() {
    if (!window.confirm("重新建立基线后，当前已有邮件都会被视为历史邮件，不会提醒。确认继续？")) return;
    await run(
      () => rebaselineOutlookMonitor(true),
      "基线已重新建立。"
    );
  }

  const events = [...(snapshot?.events || [])].reverse();

  return (
    <div className="outlookMonitor">
      <section className="panel monitorHero">
        <div className="monitorTitleRow">
          <div className="monitorIcon"><BellRing size={19} /></div>
          <div>
            <h2>Outlook 简历提醒</h2>
            <p>电脑和 Chrome 开着时，自动把新的个人投递提醒到四人飞书群。</p>
          </div>
        </div>
        <div className={`monitorState monitorState-${snapshot?.status || "loading"}`}>
          {snapshot?.status === "monitoring" ? <Check size={16} /> : <CircleAlert size={16} />}
          <span>{formatOutlookMonitorStatus(snapshot)}</span>
        </div>
      </section>

      <section className="panel monitorTarget">
        <h3>监控目标</h3>
        <dl>
          <div><dt>邮箱</dt><dd>recruiting@zhenfund.com</dd></div>
          <div><dt>文件夹</dt><dd>个人投递（需提醒）</dd></div>
          <div><dt>轮询</dt><dd>每 10 分钟 + 页面新邮件变化</dd></div>
        </dl>
        <a
          className="secondary buttonLink"
          href="https://partner.outlook.cn/mail/"
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={15} />
          打开 Recruiting Outlook
        </a>
      </section>

      <section className="panel fields">
        <div className="sectionHeading">
          <Bot size={17} />
          <h3>四人群机器人</h3>
        </div>
        <label htmlFor="outlook-delivery-mode">提醒内容</label>
        <select
          id="outlook-delivery-mode"
          value={deliveryMode}
          onChange={(event) => setDeliveryMode(event.target.value)}
        >
          <option value="rich">正文 + 简历附件（推荐）</option>
          <option value="webhook">仅主题提醒（兼容模式）</option>
        </select>
        {deliveryMode === "rich" ? (
          <>
            <label htmlFor="outlook-chat-id">飞书群 ID</label>
            <input
              id="outlook-chat-id"
              type="text"
              autoComplete="off"
              placeholder={snapshot?.config?.chatIdConfigured ? "已配置；留空表示不更换" : "oc_..."}
              value={chatId}
              onChange={(event) => setChatId(event.target.value)}
            />
            <label htmlFor="outlook-client-id">Outlook 应用 Client ID</label>
            <input
              id="outlook-client-id"
              type="text"
              autoComplete="off"
              placeholder={snapshot?.config?.outlookClientConfigured ? "已配置；留空表示不更换" : "Azure 中国应用的 Client ID"}
              value={outlookClientId}
              onChange={(event) => setOutlookClientId(event.target.value)}
            />
            <label htmlFor="outlook-tenant-id">Outlook Tenant ID</label>
            <input
              id="outlook-tenant-id"
              type="text"
              autoComplete="off"
              placeholder={snapshot?.config?.outlookTenantConfigured ? "已配置；留空表示不更换" : "Azure 中国租户 ID"}
              value={outlookTenantId}
              onChange={(event) => setOutlookTenantId(event.target.value)}
            />
            <p className="fieldHint">
              需要在 Azure 中国为本扩展登记应用，并授权 Mail.Read 和 Mail.Read.Shared。
            </p>
          </>
        ) : (
          <>
            <label htmlFor="outlook-webhook">Webhook</label>
            <input
              id="outlook-webhook"
              type="password"
              autoComplete="off"
              placeholder={snapshot?.config?.webhookConfigured ? "已配置；留空表示不更换" : "https://open.feishu.cn/open-apis/bot/v2/hook/..."}
              value={webhookUrl}
              onChange={(event) => setWebhookUrl(event.target.value)}
            />
            <label htmlFor="outlook-secret">签名密钥</label>
            <input
              id="outlook-secret"
              type="password"
              autoComplete="off"
              placeholder={snapshot?.config?.secretConfigured ? "已配置；留空表示不更换" : "粘贴机器人安全设置中的签名密钥"}
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
            />
          </>
        )}
        <label className="checkRow">
          <input
            type="checkbox"
            checked={rulesConfirmed}
            onChange={(event) => setRulesConfirmed(event.target.checked)}
          />
          <span>已确认 Outlook 会排除脉脉、猎聘、实习僧和 BOSS 直聘</span>
        </label>
        <button className="secondary" type="button" onClick={saveConfig} disabled={busy}>
          <Save size={16} />
          保存机器人配置
        </button>
        {deliveryMode === "rich" && (
          snapshot?.config?.outlookGraphAuthorized ? (
            <button className="secondary" type="button" onClick={disconnectOutlookContent} disabled={busy}>
              取消 Outlook 正文授权
            </button>
          ) : (
            <button
              className="secondary"
              type="button"
              onClick={connectOutlookContent}
              disabled={busy || !snapshot?.config?.outlookClientConfigured || !snapshot?.config?.outlookTenantConfigured}
            >
              授权读取正文和附件
            </button>
          )
        )}
        <button
          className="secondary"
          type="button"
          onClick={sendTest}
          disabled={busy || !checklist.robotConfigured}
        >
          <Send size={16} />
          发送测试提醒
        </button>
      </section>

      <section className="panel monitorChecklist">
        <h3>开启检查</h3>
        <ChecklistItem
          ok={checklist.robotConfigured}
          text={checklist.richMode ? "群 ID 和 Outlook 应用信息已保存" : "机器人 Webhook 和签名已保存"}
        />
        {checklist.richMode && (
          <ChecklistItem ok={checklist.contentAuthorized} text="已授权读取邮件正文和简历附件" />
        )}
        <ChecklistItem ok={checklist.testSucceeded} text="四人群测试提醒已成功" />
        <ChecklistItem ok={checklist.rulesConfirmed} text="四个平台分流规则已确认" />
        <ChecklistItem ok={checklist.outlookReady} text="目标邮箱和提醒文件夹已打开" />
        {!snapshot?.enabled ? (
          <button
            className="primary"
            type="button"
            onClick={enableMonitor}
            disabled={busy || !checklist.readyToEnable}
          >
            <Play size={16} />
            建立基线并开启监控
          </button>
        ) : (
          <button className="secondary" type="button" onClick={pauseMonitor} disabled={busy}>
            <Pause size={16} />
            暂停监控
          </button>
        )}
      </section>

      <section className="panel monitorMetrics">
        <h3>运行状态</h3>
        <div className="metricGrid">
          <Metric label="最近扫描" value={formatMonitorTime(snapshot?.lastScanAt)} />
          <Metric label="最近提醒" value={formatMonitorTime(snapshot?.lastNotificationAt)} />
          <Metric label="待发送" value={`${snapshot?.queueCount || 0} 条`} />
          <Metric label="基线" value={snapshot?.baselineComplete ? "已建立" : "未建立"} />
        </div>
        <div className="monitorActionGrid">
          <button className="secondary" type="button" onClick={refresh} disabled={busy}>
            <RefreshCw size={15} />
            刷新状态
          </button>
          <button className="secondary" type="button" onClick={rebuildBaseline} disabled={busy}>
            重新建立基线
          </button>
        </div>
      </section>

      {events.length > 0 && (
        <section className="panel monitorEvents">
          <h3>最近记录</h3>
          <ul>
            {events.map((event, index) => (
              <li key={`${event.at}-${event.code}-${index}`}>
                <span>{describeOutlookEvent(event)}</span>
                <time>{formatMonitorTime(event.at)}</time>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="status monitorFooter">
        <BellRing size={16} />
        <span>{message}</span>
      </footer>
    </div>
  );
}

function ChecklistItem({ ok, text }) {
  return (
    <div className={`checklistItem ${ok ? "isDone" : ""}`}>
      <span className="checkDot">{ok ? <Check size={13} /> : null}</span>
      <span>{text}</span>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
