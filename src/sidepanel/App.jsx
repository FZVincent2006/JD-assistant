import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Bug, CheckCircle2, ClipboardPaste, Send, Wand2 } from "lucide-react";
import { parseJd } from "../lib/jdParser.js";
import { collectClickRecording, sendDiagnosticRequest, sendFillRequest, startClickRecording } from "./fillPage.js";
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
  const [status, setStatus] = useState("等待粘贴 JD");
  const [recording, setRecording] = useState(false);
  const keywordText = useMemo(() => draft.keywords.join("、"), [draft.keywords]);

  function parseCurrentJd() {
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

  return (
    <main className="shell">
      <header className="header">
        <div>
          <h1>招聘 JD 发布助手</h1>
          <p>选择平台，粘贴 JD，确认字段，然后填入当前发布页。</p>
        </div>
        <Wand2 aria-hidden="true" />
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
      </section>

      <section className="panel">
        <label htmlFor="jd">JD 原文</label>
        <textarea
          id="jd"
          className="jdInput"
          placeholder="从飞书复制完整 JD 到这里"
          value={jdText}
          onChange={(event) => setJdText(event.target.value)}
        />
        <button className="primary" type="button" onClick={parseCurrentJd} disabled={!jdText.trim()}>
          <ClipboardPaste size={16} />
          解析 JD
        </button>
      </section>

      <section className="panel fields">
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
      </section>

      <footer className="status">
        <CheckCircle2 size={16} />
        <span>{status}</span>
      </footer>
    </main>
  );
}

function Field({ label, value, onChange }) {
  const id = label.replace(/\s/g, "");
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <input id={id} value={value} onChange={(event) => onChange(event.target.value)} />
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

createRoot(document.getElementById("root")).render(<App />);
