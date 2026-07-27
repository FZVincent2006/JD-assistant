import { webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  buildMailDigestCard,
  buildSingleMailCard,
  generateFeishuSign,
  sendFeishuWebhook,
  validateFeishuWebhook
} from "../src/lib/feishuWebhook.js";

const webhookUrl = "https://open.feishu.cn/open-apis/bot/v2/hook/test-token_123";
const mail = {
  conversationId: "conv",
  dedupeKey: "hash",
  senderName: "Candidate",
  senderEmail: "candidate@example.com",
  subject: "Investment *intern* application",
  receivedTime: "2026-07-18T09:00:00+08:00",
  hasAttachment: true,
  preview: "private phone 13800000000",
  attachmentName: "private-resume.pdf"
};

describe("Feishu signing", () => {
  it("matches the documented empty-message HMAC-SHA256 algorithm", async () => {
    await expect(generateFeishuSign("secret", 1599360473, webcrypto))
      .resolves.toBe("q4jswNiMy51J5JuQV566yJat0/lQ/c+22kINzUgKsGU=");
  });

  it("accepts only a Feishu V2 custom-bot webhook", () => {
    expect(validateFeishuWebhook(webhookUrl)).toBe(true);
    expect(validateFeishuWebhook("http://open.feishu.cn/open-apis/bot/v2/hook/token")).toBe(false);
    expect(validateFeishuWebhook("https://evil.example/open-apis/bot/v2/hook/token")).toBe(false);
    expect(validateFeishuWebhook("https://open.feishu.cn/open-apis/bot/hook/old")).toBe(false);
  });
});

describe("Feishu mail cards", () => {
  it("includes only allowed fields and escapes Lark markdown", () => {
    const payload = buildSingleMailCard(mail);
    const text = JSON.stringify(payload);

    expect(payload.msg_type).toBe("interactive");
    expect(text).toContain("Candidate");
    expect(text).toContain("candidate@example.com");
    expect(text).toContain("Investment \\\\*intern\\\\* application");
    expect(text).toContain("打开 Recruiting 邮箱");
    expect(text).not.toMatch(/private phone|13800000000|private-resume\.pdf|conversationId|dedupeKey/);
  });

  it("builds one digest card without adding private fields", () => {
    const payload = buildMailDigestCard([
      mail,
      { ...mail, dedupeKey: "hash-2", subject: "IR internship application", hasAttachment: false }
    ]);
    const text = JSON.stringify(payload);

    expect(text).toContain("2 封");
    expect(text).toContain("IR internship application");
    expect(text).not.toContain("private-resume.pdf");
  });
});

describe("sendFeishuWebhook", () => {
  it("adds timestamp and signature and accepts Feishu code zero", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ code: 0, msg: "success" })
    });

    const result = await sendFeishuWebhook(
      { webhookUrl, secret: "secret" },
      buildSingleMailCard(mail),
      { fetchFn, cryptoApi: webcrypto, now: () => 1599360473000 }
    );

    expect(result).toEqual({ ok: true, code: 0, message: "success" });
    const [, request] = fetchFn.mock.calls[0];
    const body = JSON.parse(request.body);
    expect(body).toMatchObject({
      timestamp: "1599360473",
      sign: "q4jswNiMy51J5JuQV566yJat0/lQ/c+22kINzUgKsGU=",
      msg_type: "interactive"
    });
    expect(request.body).not.toContain("secret");
  });

  it("returns a redacted failure without throwing response details", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ code: 19021, msg: "sign match fail" })
    });

    await expect(sendFeishuWebhook(
      { webhookUrl, secret: "wrong-secret" },
      buildSingleMailCard(mail),
      { fetchFn, cryptoApi: webcrypto, now: () => 1599360473000 }
    )).resolves.toEqual({
      ok: false,
      code: 19021,
      message: "飞书机器人拒绝了请求。"
    });
  });
});
