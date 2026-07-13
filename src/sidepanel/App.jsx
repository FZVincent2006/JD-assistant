import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Bug, CheckCircle2, ClipboardPaste, ExternalLink, KeyRound, Send, Wand2 } from "lucide-react";
import { TEST_FEISHU_DOC_URL } from "../lib/feishuConfig.js";
import { parseCompanyJdBatch, validateCompanyDraft } from "../lib/companyJdParser.js";
import { parseJd } from "../lib/jdParser.js";
import {
  collectClickRecording,
  sendDiagnosticRequest,
  sendFeishuInspectRequest,
  sendFeishuRuntimeRequest,
  sendFeishuWriteRequest,
  sendFillRequest,
  startClickRecording
} from "./fillPage.js";
import {
  canWriteFeishu,
  describeFeishuPlan,
  formatFeishuOperationError,
  formatFeishuWriteStatus,
  updateJobDraftField
} from "./feishuUi.js";
import zhenfundLogo from "./assets/zhenfund-logo.png";
import "./styles.css";

const emptyDraft = {
  companyName: "",
  title: "",
  recruitmentType: "社招全职",
  jobType: "",
  experience: "",
  education: "",
  salaryMinK: "",
  salaryMaxK: "",
  industry: "",
  keywords: [],
  highlights: "",
  location: "",
  email: "",
  description: ""
};

function App() {
  const [platform, setPlatform] = useState("maimai");
  const [jdText, setJdText] = useState("");
  const [draft, setDraft] = useState(emptyDraft);
  const [companyDraft, setCompanyDraft] = useState(null);
  const [status, setStatus] = useState("等待粘贴 JD");
  const [recording, setRecording] = useState(false);
  const [authStatus, setAuthStatus] = useState("unknown");
  const [inspection, setInspection] = useState(null);
  const [writePlan, setWritePlan] = useState(null);
  const [writeResult, setWriteResult] = useState(null);
  const [writing, setWriting] = useState(false);
  const keywordText = useMemo(() => draft.keywords.join("、"), [draft.keywords]);
  const feishuErrors = companyDraft ? validateCompanyDraft(companyDraft) : [];
  const feishuWarnings = companyDraft ? getFeishuWarnings(companyDraft) : [];
  const feishuReady = canWriteFeishu({ authStatus, inspection, plan: writePlan, errors: feishuErrors, writing });

  useEffect(() => {
    if (platform !== "feishu") return undefined;
    let current = true;
    setAuthStatus("checking");
    sendFeishuRuntimeRequest("FEISHU_AUTH_STATUS").then((response) => {
      if (!current) return;
      if (response?.ok) {
        setAuthStatus(response.auth?.status ?? "unauthorized");
      } else {
        setAuthStatus("unauthorized");
        setStatus(formatFeishuOperationError(response, "无法检查飞书授权状态。"));
      }
    });
    return () => { current = false; };
  }, [platform]);

  function parseCurrentJd() {
    if (platform === "feishu") {
      const parsed = parseCompanyJdBatch(jdText);
      setCompanyDraft(parsed);
      setWritePlan(null);
      setWriteResult(null);
      setStatus(parsed.errors.length
        ? `解析完成，但有 ${parsed.errors.length} 项需要修正。`
        : `已解析：${parsed.companyName || "未识别公司"}，${parsed.jobs.length} 个岗位。`);
      return;
    }
    const parsed = parseJd(jdText);
    setDraft(parsed);
    setStatus(`已解析：${parsed.title || "未识别岗位名"}`);
  }

  async function fillCurrentPage() {
    const response = await sendFillRequest(draft, platform);

    if (!response?.ok) {
      setStatus(response?.error || "填表失败，请确认已打开招聘平台发布职位页");
      return;
    }

    const missingText = response.missing.length ? `，未找到：${response.missing.join("、")}` : "";
    setStatus(`已填入 ${response.filled.length} 个字段${missingText}`);
  }

  async function diagnoseCurrentPage() {
    const response = await sendDiagnosticRequest();
    if (!response?.ok) {
      setStatus(response?.error || "诊断失败，请确认已打开招聘平台发布职位页");
      return;
    }

    const text = JSON.stringify(response.diagnostics, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setStatus(`诊断结果已复制：${response.diagnostics.length} 个 frame`);
    } catch {
      setStatus(`诊断结果生成成功，但复制失败：${text.slice(0, 120)}`);
    }
  }

  async function startRecordingClicks() {
    const response = await startClickRecording();
    if (!response?.ok) {
      setStatus(response?.error || "点击记录启动失败");
      return;
    }
    setRecording(true);
    setStatus("开始记录：请手动点击经验框、经验选项、学历框、学历选项，然后点复制点击记录。");
  }

  async function copyRecordedClicks() {
    const response = await collectClickRecording();
    if (!response?.ok) {
      setStatus(response?.error || "点击记录复制失败");
      return;
    }

    const recordings = response.responses.map(({ frameId, recording }) => ({ frameId, ...recording }));
    const text = JSON.stringify(recordings, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setRecording(false);
      setStatus(`点击记录已复制：${recordings.length} 个 frame`);
    } catch {
      setStatus(`点击记录生成成功，但复制失败：${text.slice(0, 120)}`);
    }
  }

  function updateDraft(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function invalidateFeishuPlan() {
    setWritePlan(null);
    setWriteResult(null);
  }

  function updateCompanyField(field, value) {
    setCompanyDraft((current) => ({ ...current, [field]: value }));
    invalidateFeishuPlan();
  }

  function updateCompanyJob(index, field, value) {
    setCompanyDraft((current) => updateJobDraftField(current, index, field, value));
    invalidateFeishuPlan();
  }

  async function authorizeFeishu() {
    const reauthorizing = authStatus === "authorized";
    setAuthStatus("authorizing");
    setStatus(reauthorizing ? "正在重新授权飞书…" : "正在授权飞书…");
    if (reauthorizing) await sendFeishuRuntimeRequest("FEISHU_CLEAR_AUTH");
    const response = await sendFeishuRuntimeRequest("FEISHU_AUTHORIZE");
    if (!response?.ok) {
      setAuthStatus("unauthorized");
      setStatus(formatFeishuOperationError(response, "飞书授权失败。"));
      return;
    }
    setAuthStatus(response.auth?.status ?? "authorized");
    setInspection(null);
    setWritePlan(null);
    setWriteResult(null);
    setStatus("飞书授权成功，可以检查测试副本。");
  }

  async function inspectFeishuCopy() {
    setStatus("正在通过 OpenAPI 检查飞书测试副本，请稍候…");
    const response = await sendFeishuInspectRequest();
    if (!response?.ok) {
      setStatus(formatFeishuOperationError(response, "测试副本检查失败。"));
      return;
    }
    setInspection(response.inspection);
    setWritePlan(null);
    setWriteResult(null);
    setStatus(`测试副本检查完成：版本 ${response.inspection.revisionId}，Portfolio ${response.inspection.portfolioCompanyCount} 家，岗位 JD ${response.inspection.jdCompanyCount} 家。`);
  }

  async function generateFeishuPlan() {
    if (!companyDraft || feishuErrors.length) {
      setStatus("请先修正预览中的必填项。");
      return;
    }
    setStatus("正在读取最新文档并生成块级写入计划…");
    const response = await sendFeishuRuntimeRequest("FEISHU_PLAN", companyDraft);
    if (!response?.ok) {
      setWritePlan(null);
      setStatus(formatFeishuOperationError(response, "写入计划生成失败。"));
      return;
    }
    setInspection(response.inspection);
    setWritePlan(response.plan);
    setWriteResult(null);
    const description = describeFeishuPlan(response.plan);
    setStatus(response.plan.ok
      ? `计划已生成：${description.title}，文档版本 ${response.plan.baseRevisionId}。`
      : `计划不可执行：${response.plan.errors.join("；")}`);
  }

  async function writeFeishuCopy() {
    if (!companyDraft || !feishuReady) {
      setStatus("请先完成授权、检查并生成与当前文档版本一致的有效计划。");
      return;
    }
    const planDescription = describeFeishuPlan(writePlan);
    const confirmed = window.confirm(`计划：${planDescription.title}\n公司：${companyDraft.companyName}\n岗位：${writePlan.jobs.length} 个\n仅写入飞书测试副本。确认继续？`);
    if (!confirmed) return;
    setWriting(true);
    setWriteResult(null);
    setStatus("正在写入测试副本：先更新 JD 区，再更新岗位汇总区…");
    try {
      const response = await sendFeishuWriteRequest(companyDraft);
      setWriteResult(response);
      setStatus(formatFeishuWriteStatus(response ?? { ok: false, error: "飞书写入没有返回结果。" }));
      setInspection(null);
      setWritePlan(null);
    } finally {
      setWriting(false);
    }
  }

  return (
    <main className="shell">
      <header className="header">
        <div>
          <img className="brandLogo" src={zhenfundLogo} alt="ZhenFund 真格基金" />
          <h1>招聘 JD 发布助手</h1>
          <p>选择平台，粘贴 JD，确认字段，然后填入招聘平台或飞书测试副本。</p>
        </div>
        <div className="brandMark" aria-hidden="true">
          <Wand2 size={20} />
        </div>
      </header>

      <section className="platformSwitch" aria-label="选择招聘平台">
        <button
          className={platform === "maimai" ? "active" : ""}
          type="button"
          onClick={() => setPlatform("maimai")}
        >
          脉脉
        </button>
        <button className={platform === "boss" ? "active" : ""} type="button" onClick={() => setPlatform("boss")}>
          Boss 直聘
        </button>
        <button className={platform === "feishu" ? "active" : ""} type="button" onClick={() => setPlatform("feishu")}>
          飞书文档
        </button>
      </section>

      <section className="panel">
        <label htmlFor="jd">JD 原文</label>
        <textarea
          id="jd"
          className="jdInput"
          placeholder={platform === "feishu" ? "粘贴一家公司的公司介绍和多个岗位 JD" : "从飞书复制完整 JD 到这里"}
          value={jdText}
          onChange={(event) => setJdText(event.target.value)}
        />
        <button className="primary" type="button" onClick={parseCurrentJd} disabled={!jdText.trim()}>
          <ClipboardPaste size={16} />
          {platform === "feishu" ? "解析公司与岗位" : "解析 JD"}
        </button>
      </section>

      {platform !== "feishu" && <section className="panel fields">
        {platform === "maimai" && (
          <Field label="公司名" value={draft.companyName} onChange={(value) => updateDraft("companyName", value)} />
        )}
        <Field label="职位名称" value={draft.title} onChange={(value) => updateDraft("title", value)} />
        {platform === "boss" && (
          <SelectField
            label="招聘类型"
            value={draft.recruitmentType}
            options={["社招全职", "应届校园招聘", "实习生招聘", "兼职招聘"]}
            onChange={(value) => updateDraft("recruitmentType", value)}
          />
        )}
        <Field label="经验" value={draft.experience} onChange={(value) => updateDraft("experience", value)} />
        <Field label="学历" value={draft.education} onChange={(value) => updateDraft("education", value)} />
        <div className="salaryGrid">
          <Field label="最低月薪(K)" value={draft.salaryMinK} onChange={(value) => updateDraft("salaryMinK", value)} />
          <Field label="最高月薪(K)" value={draft.salaryMaxK} onChange={(value) => updateDraft("salaryMaxK", value)} />
        </div>
        <Field label="工作地址" value={draft.location} onChange={(value) => updateDraft("location", value)} />
        {platform === "boss" && (
          <Field label="关键词" value={keywordText} onChange={(value) => updateDraft("keywords", splitKeywords(value))} />
        )}
        {platform === "maimai" && (
          <Field label="邮箱地址" value={draft.email} onChange={(value) => updateDraft("email", value)} />
        )}
        <label htmlFor="description">职位描述</label>
        <textarea
          id="description"
          className="description"
          value={draft.description}
          onChange={(event) => updateDraft("description", event.target.value)}
        />
        <button className="primary" type="button" onClick={fillCurrentPage} disabled={!draft.title || !draft.description}>
          <Send size={16} />
          填入当前页面
        </button>
        <button className="secondary" type="button" onClick={diagnoseCurrentPage}>
          <Bug size={16} />
          诊断当前页面
        </button>
        <div className="recordGrid">
          <button className="secondary" type="button" onClick={startRecordingClicks}>
            开始记录点击
          </button>
          <button className="secondary" type="button" onClick={copyRecordedClicks} disabled={!recording}>
            复制点击记录
          </button>
        </div>
      </section>}

      {platform === "feishu" && (
        <FeishuAccessPanel
          authStatus={authStatus}
          inspection={inspection}
          writing={writing}
          onAuthorize={authorizeFeishu}
          onInspect={inspectFeishuCopy}
        />
      )}

      {platform === "feishu" && companyDraft && (
        <FeishuPreview
          draft={companyDraft}
          errors={feishuErrors}
          warnings={feishuWarnings}
          writing={writing}
          writePlan={writePlan}
          writeResult={writeResult}
          canPlan={authStatus === "authorized"}
          canWrite={feishuReady}
          onCompanyField={updateCompanyField}
          onJobField={updateCompanyJob}
          onPlan={generateFeishuPlan}
          onWrite={writeFeishuCopy}
        />
      )}

      <footer className="status">
        <CheckCircle2 size={16} />
        <span>{status}</span>
      </footer>
    </main>
  );
}

function FeishuAccessPanel({ authStatus, inspection, writing, onAuthorize, onInspect }) {
  const authorized = authStatus === "authorized";
  const checking = authStatus === "checking" || authStatus === "authorizing";
  return (
    <section className="panel feishuAccess">
      <div className="environmentBadge">固定目标：飞书测试副本（正式文档无写入入口）</div>
      <div className="documentTarget">
        <div>
          <strong>测试副本文档</strong>
          <span>{TEST_FEISHU_DOC_URL}</span>
        </div>
        <a className="secondary" href={TEST_FEISHU_DOC_URL} target="_blank" rel="noreferrer">
          <ExternalLink size={15} />
          打开文档检查
        </a>
      </div>
      <div className={`authState ${authorized ? "authorized" : ""}`}>
        <KeyRound size={16} />
        <span>{authStatusLabel(authStatus)}</span>
      </div>
      <div className="actionGrid">
        <button className="secondary" type="button" onClick={onAuthorize} disabled={checking || writing}>
          {authorized ? "重新授权" : "授权飞书"}
        </button>
        <button className="secondary" type="button" onClick={onInspect} disabled={!authorized || writing}>
          检查测试副本
        </button>
      </div>
      {inspection && (
        <div className="inspectionSummary">
          <strong>文档版本 {inspection.revisionId}</strong>
          <span>Portfolio {inspection.portfolioCompanyCount} 家 · 岗位 JD {inspection.jdCompanyCount} 家</span>
        </div>
      )}
    </section>
  );
}

function FeishuPreview({
  draft,
  errors,
  warnings,
  writing,
  writePlan,
  writeResult,
  canPlan,
  canWrite,
  onCompanyField,
  onJobField,
  onPlan,
  onWrite
}) {
  const planDescription = writePlan ? describeFeishuPlan(writePlan) : null;
  return (
    <section className="panel fields feishuPreview">
      <div className="environmentBadge">预览字段可编辑；修改后必须重新生成计划</div>
      <Field id="feishu-company" label="公司名" value={draft.companyName} onChange={(value) => onCompanyField("companyName", value)} />
      <Field id="feishu-website" label="公司官网（可选）" value={draft.website} onChange={(value) => onCompanyField("website", value)} />
      <TextAreaField
        id="feishu-intro"
        label="公司介绍"
        value={draft.companyIntro.join("\n")}
        onChange={(value) => onCompanyField("companyIntro", splitLines(value))}
      />

      {draft.jobs.map((job, index) => (
        <article className="jobCard" key={index}>
          <h2>岗位 {index + 1}</h2>
          <Field id={`job-${index}-title`} label="岗位名称" value={job.title} onChange={(value) => onJobField(index, "title", value)} />
          <div className="salaryGrid">
            <Field id={`job-${index}-location`} label="地点" value={job.location} onChange={(value) => onJobField(index, "location", value)} />
            <Field id={`job-${index}-employment`} label="招聘类型" value={job.employment} onChange={(value) => onJobField(index, "employment", value)} />
          </div>
          <TextAreaField id={`job-${index}-responsibilities`} label="工作内容" value={job.responsibilities.join("\n")} onChange={(value) => onJobField(index, "responsibilities", splitLines(value))} />
          <TextAreaField id={`job-${index}-requirements`} label="职位要求" value={job.requirements.join("\n")} onChange={(value) => onJobField(index, "requirements", splitLines(value))} />
          <TextAreaField id={`job-${index}-bonuses`} label="加分项（可选）" value={job.bonuses.join("\n")} onChange={(value) => onJobField(index, "bonuses", splitLines(value))} />
        </article>
      ))}

      {warnings.length > 0 && <MessageList className="warningList" title="提醒" items={warnings} />}
      {errors.length > 0 && <MessageList className="errorList" title="需要修正" items={errors} />}
      {planDescription && (
        <div className={writePlan.ok ? "planCard" : "planCard invalid"}>
          <strong>{planDescription.title}</strong>
          <p>{planDescription.position}</p>
          {writePlan.ok && <span>基于文档版本 {writePlan.baseRevisionId}</span>}
          {planDescription.jobs.length > 0 && <ul>{planDescription.jobs.map((job) => <li key={job}>{job}</li>)}</ul>}
        </div>
      )}
      {writeResult && <div className={`writeResult ${writeResult.status ?? "failed"}`}>{formatFeishuWriteStatus(writeResult)}</div>}
      <button className="secondary" type="button" onClick={onPlan} disabled={!canPlan || writing || errors.length > 0}>
        生成写入计划
      </button>
      <button className="primary" type="button" onClick={onWrite} disabled={!canWrite}>
        <Send size={16} />
        {writing ? "正在写入…" : "确认并写入测试副本"}
      </button>
    </section>
  );
}

function MessageList({ className, title, items }) {
  return <div className={className}><strong>{title}</strong><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></div>;
}

function Field({ id: providedId, label, value, onChange }) {
  const id = providedId ?? label.replace(/\s/g, "");
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <input id={id} value={value} onChange={(event) => onChange(event.target.value)} />
    </>
  );
}

function TextAreaField({ id, label, value, onChange }) {
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <textarea id={id} className="compactTextArea" value={value} onChange={(event) => onChange(event.target.value)} />
    </>
  );
}

function SelectField({ label, value, options, onChange }) {
  const id = label.replace(/\s/g, "");
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </>
  );
}

function splitKeywords(value) {
  return value
    .split(/[、,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitLines(value) {
  return value.split("\n").map((line) => line.trim().replace(/^[-•]\s*/, "")).filter(Boolean);
}

function getFeishuWarnings(draft) {
  const warnings = [];
  if (!draft.website?.trim()) warnings.push("未填写公司官网，公司名将以纯文本写入。");
  if (!draft.companyIntro?.length) warnings.push("未填写公司介绍，确认写入时将使用“待补充”。");
  return warnings;
}

function authStatusLabel(value) {
  const labels = {
    unknown: "尚未检查飞书授权",
    checking: "正在检查飞书授权…",
    authorizing: "正在等待飞书授权…",
    authorized: "飞书已授权",
    expired: "飞书授权已过期，请重新授权",
    unauthorized: "飞书未授权"
  };
  return labels[value] ?? "飞书未授权";
}

createRoot(document.getElementById("root")).render(<App />);
