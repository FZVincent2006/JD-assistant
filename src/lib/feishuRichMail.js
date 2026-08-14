const FEISHU_ORIGIN = "https://open.feishu.cn";
const OUTLOOK_ENTRY_URL = "https://partner.outlook.cn/mail/";

export class FeishuRichMailError extends Error {
  constructor(message, { status = 0, code = 0, stage = "feishu-rich-mail" } = {}) {
    super(message);
    this.name = "FeishuRichMailError";
    Object.assign(this, { status, code, stage });
  }
}

export function validateFeishuChatId(value) {
  return /^oc_[A-Za-z0-9_-]{20,80}$/.test(String(value || "").trim());
}

export function createFeishuRichMailDelivery({ fetchImpl = fetch, getAccessToken } = {}) {
  if (typeof getAccessToken !== "function") throw new TypeError("getAccessToken is required");

  async function deliver({
    chatId,
    mail,
    detail,
    completedParts = [],
    onProgress = async () => {}
  }) {
    requireChatId(chatId);
    const completed = new Set(completedParts || []);
    const preparedAttachments = [];
    for (const attachment of detail?.attachments || []) {
      const part = `attachment:${String(attachment.id || "").slice(0, 512)}`;
      if (completed.has(part)) continue;
      preparedAttachments.push({
        attachment,
        part,
        fileKey: await uploadAttachment(attachment)
      });
    }
    if (!completed.has("card")) {
      await sendMessage(chatId, "interactive", buildRichMailCard(mail, detail), uuidFor(mail, "card"));
      completed.add("card");
      await onProgress([...completed]);
    }
    for (const { part, fileKey } of preparedAttachments) {
      await sendMessage(chatId, "file", { file_key: fileKey }, uuidFor(mail, part));
      completed.add(part);
      await onProgress([...completed]);
    }
    return { ok: true, completedParts: [...completed] };
  }

  async function sendTest(chatId) {
    requireChatId(chatId);
    const testAttachment = {
      name: "简历附件推送测试.txt",
      contentType: "text/plain; charset=utf-8",
      bytes: new TextEncoder().encode("招聘 JD 发布助手：附件上传与群文件发送测试成功。\n")
    };
    const fileKey = await uploadAttachment(testAttachment);
    await sendMessage(chatId, "file", { file_key: fileKey });
    await sendMessage(chatId, "interactive", statusCard(
      "完整邮件提醒测试成功",
      "机器人已具备向本群发送邮件正文和简历附件的能力；上方测试文件可以直接下载。",
      "green"
    ));
    return { ok: true, code: 0, message: "success" };
  }

  async function sendStatus(chatId, title, message, template = "blue") {
    requireChatId(chatId);
    await sendMessage(chatId, "interactive", statusCard(title, message, template));
    return { ok: true, code: 0, message: "success" };
  }

  async function uploadAttachment(attachment) {
    const token = await getAccessToken();
    const form = new FormData();
    form.set("file_type", feishuFileType(attachment?.name));
    form.set("file_name", String(attachment?.name || "resume").slice(0, 180));
    form.set("file", new Blob([attachment.bytes], {
      type: attachment?.contentType || "application/octet-stream"
    }), String(attachment?.name || "resume"));
    const response = await safeFetch(new URL("/open-apis/im/v1/files", FEISHU_ORIGIN), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form
    }, "feishu-file-upload");
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || Number(payload.code) !== 0 || !payload.data?.file_key) {
      throw apiError(response, payload, "feishu-file-upload");
    }
    return payload.data.file_key;
  }

  async function sendMessage(chatId, msgType, content, uuid) {
    const token = await getAccessToken();
    const url = new URL("/open-apis/im/v1/messages", FEISHU_ORIGIN);
    url.searchParams.set("receive_id_type", "chat_id");
    const body = {
      receive_id: chatId,
      msg_type: msgType,
      content: JSON.stringify(content)
    };
    if (uuid) body.uuid = uuid;
    const response = await safeFetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify(body)
    }, "feishu-message-send");
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || Number(payload.code) !== 0) {
      throw apiError(response, payload, "feishu-message-send");
    }
    return payload.data;
  }

  async function safeFetch(url, options, stage) {
    try {
      return await fetchImpl(url, options);
    } catch {
      throw new FeishuRichMailError("Feishu request failed", { stage });
    }
  }

  return { deliver, sendTest, sendStatus };
}

export function buildRichMailCard(mail, detail) {
  const body = escapeLarkMarkdown(String(detail?.body || "（邮件正文为空）"));
  const truncated = detail?.bodyTruncated ? "\n\n_正文过长，已截取前 12,000 字。_" : "";
  const attachments = (detail?.attachments || []).map((item) => escapeLarkMarkdown(item.name));
  const skipped = (detail?.skippedAttachments || []).map((item) =>
    `${escapeLarkMarkdown(item.name)}（未发送：${skipReason(item.reason)}）`
  );
  const attachmentText = [...attachments, ...skipped].length
    ? [...attachments, ...skipped].map((name) => `- ${name}`).join("\n")
    : "无";
  return {
    config: { wide_screen_mode: true, enable_forward: false },
    header: {
      template: "blue",
      title: { tag: "plain_text", content: "收到新的简历投递" }
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: [
            `**发件人：** ${senderLabel(mail)}`,
            `**主题：** ${escapeLarkMarkdown(mail?.subject || "（无主题）")}`,
            `**时间：** ${escapeLarkMarkdown(mail?.receivedTime || "")}`,
            "",
            "**邮件正文**",
            `${body}${truncated}`,
            "",
            "**简历附件**",
            attachmentText
          ].join("\n")
        }
      },
      {
        tag: "action",
        actions: [{
          tag: "button",
          type: "primary",
          text: { tag: "plain_text", content: "打开 Recruiting 邮箱" },
          url: OUTLOOK_ENTRY_URL
        }]
      }
    ]
  };
}

function statusCard(title, message, template) {
  return {
    config: { wide_screen_mode: true },
    header: {
      template,
      title: { tag: "plain_text", content: title }
    },
    elements: [{
      tag: "div",
      text: { tag: "plain_text", content: message }
    }]
  };
}

function requireChatId(chatId) {
  if (!validateFeishuChatId(chatId)) {
    throw new FeishuRichMailError("Invalid Feishu chat ID", { stage: "feishu-chat-config" });
  }
}

function feishuFileType(name) {
  const extension = String(name || "").split(".").pop().toLowerCase();
  if (extension === "pdf") return "pdf";
  if (extension === "doc") return "doc";
  return "stream";
}

function senderLabel(mail) {
  const name = escapeLarkMarkdown(mail?.senderName || "未知发件人");
  const email = String(mail?.senderEmail || "").trim();
  return email ? `${name} <${escapeLarkMarkdown(email)}>` : name;
}

function escapeLarkMarkdown(value) {
  return String(value || "").replace(/([\\`*_[\]()~>#+=|{}!])/g, "\\$1");
}

function skipReason(reason) {
  if (reason === "total-size") return "附件总大小超过 60 MB";
  if (reason === "no-download-url") return "Outlook 页面未提供安全下载入口";
  if (reason === "processing") return "附件处理中，系统将继续重试";
  if (reason === "download-failed") return "附件下载失败，系统将继续重试";
  if (reason === "control-not-found") return "附件控件暂未识别，系统将继续重试";
  return "仅支持 30 MB 以内的 PDF、DOC、DOCX、PNG、JPG、WebP";
}

function uuidFor(mail, part) {
  const base = String(mail?.dedupeKey || "mail").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  let suffix = "part";
  let hash = 2166136261;
  for (const char of String(part || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  suffix = (hash >>> 0).toString(36);
  return `${base}-${suffix}`.slice(0, 50);
}

function apiError(response, payload, stage) {
  return new FeishuRichMailError("Feishu API request was rejected", {
    status: Number(response?.status || 0),
    code: Number(payload?.code || 0),
    stage
  });
}
