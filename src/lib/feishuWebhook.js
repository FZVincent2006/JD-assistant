const FEISHU_ORIGIN = "https://open.feishu.cn";
const OUTLOOK_ENTRY_URL = "https://partner.outlook.cn/mail/";

export function validateFeishuWebhook(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.origin === FEISHU_ORIGIN &&
      /^\/open-apis\/bot\/v2\/hook\/[^/?#]+$/.test(url.pathname) &&
      !url.search &&
      !url.hash;
  } catch {
    return false;
  }
}

export async function generateFeishuSign(
  secret,
  timestamp,
  cryptoApi = globalThis.crypto
) {
  if (!String(secret || "")) throw new Error("缺少飞书机器人签名密钥。");
  if (!cryptoApi?.subtle) throw new Error("当前浏览器不支持飞书安全签名。");

  const encoder = new TextEncoder();
  const stringToSign = `${timestamp}\n${secret}`;
  const key = await cryptoApi.subtle.importKey(
    "raw",
    encoder.encode(stringToSign),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await cryptoApi.subtle.sign("HMAC", key, new Uint8Array());
  return bytesToBase64(new Uint8Array(signature));
}

export function buildSingleMailCard(mail) {
  const safe = sanitizeMail(mail);
  return interactiveCard(
    "收到新的非平台简历投递",
    [
      `**发件人：** ${senderLabel(safe)}`,
      `**主题：** ${escapeLarkMarkdown(safe.subject)}`,
      `**时间：** ${escapeLarkMarkdown(safe.receivedTime)}`,
      `**附件：** ${safe.hasAttachment ? "有" : "无"}`
    ].join("\n"),
    "blue"
  );
}

export function buildMailDigestCard(mails) {
  const safeMails = (mails || []).map(sanitizeMail);
  const sections = safeMails.map((mail, index) => [
    `**${index + 1}. ${escapeLarkMarkdown(mail.subject)}**`,
    `发件人：${senderLabel(mail)}`,
    `时间：${escapeLarkMarkdown(mail.receivedTime)} · 附件：${mail.hasAttachment ? "有" : "无"}`
  ].join("\n")).join("\n\n");

  return interactiveCard(
    `收到 ${safeMails.length} 封新的非平台简历投递`,
    sections,
    "blue"
  );
}

export async function sendFeishuWebhook(
  config,
  payload,
  {
    fetchFn = fetch,
    cryptoApi = globalThis.crypto,
    now = Date.now
  } = {}
) {
  const webhookUrl = String(config?.webhookUrl || "").trim();
  const secret = String(config?.secret || "");
  if (!validateFeishuWebhook(webhookUrl)) {
    return { ok: false, code: "INVALID_WEBHOOK", message: "飞书机器人 Webhook 地址无效。" };
  }
  if (!secret) {
    return { ok: false, code: "MISSING_SECRET", message: "尚未配置飞书机器人签名密钥。" };
  }

  const timestamp = Math.floor(now() / 1000);
  const sign = await generateFeishuSign(secret, timestamp, cryptoApi);

  try {
    const response = await fetchFn(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        timestamp: String(timestamp),
        sign,
        ...payload
      })
    });
    const result = await response.json().catch(() => ({}));
    if (response.ok && Number(result.code) === 0) {
      return { ok: true, code: 0, message: String(result.msg || "success") };
    }
    return {
      ok: false,
      code: result.code ?? response.status ?? "FEISHU_ERROR",
      message: "飞书机器人拒绝了请求。"
    };
  } catch {
    return { ok: false, code: "NETWORK", message: "暂时无法连接飞书机器人。" };
  }
}

function interactiveCard(title, markdown, template) {
  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: {
        template,
        title: { tag: "plain_text", content: title }
      },
      elements: [
        {
          tag: "div",
          text: { tag: "lark_md", content: markdown }
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
    }
  };
}

function sanitizeMail(mail) {
  return {
    senderName: sanitize(mail?.senderName, 120),
    senderEmail: sanitize(mail?.senderEmail, 254),
    subject: sanitize(mail?.subject, 240) || "（无主题）",
    receivedTime: sanitize(mail?.receivedTime, 80),
    hasAttachment: Boolean(mail?.hasAttachment)
  };
}

function senderLabel(mail) {
  const name = escapeLarkMarkdown(mail.senderName || "未知发件人");
  return mail.senderEmail
    ? `${name} <${escapeLarkMarkdown(mail.senderEmail)}>`
    : name;
}

function escapeLarkMarkdown(value) {
  return String(value || "").replace(/([\\`*_[\]()~>#+=|{}!])/g, "\\$1");
}

function sanitize(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
