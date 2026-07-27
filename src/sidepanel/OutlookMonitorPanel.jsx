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
      () => saveOutlookMonitorConfig({ webhookUrl, secret, rulesConfirmed }),
      "机器人配置已保存在这台电脑的 Chrome 中。"
    );
    if (saved) {
      setWebhookUrl("");
      setSecret("");
    }
  }

  async function sendTest() {
    await run(
      () => testOutlookMonitorFeishu(),
      "测试提醒已发送，请在四人群中确认。"
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
        <ChecklistItem ok={checklist.robotConfigured} text="机器人 Webhook 和签名已保存" />
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
