import { describe, expect, it, vi } from "vitest";
import {
  buildRichMailCard,
  createFeishuRichMailDelivery,
  validateFeishuChatId
} from "../src/lib/feishuRichMail.js";

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    headers: { get: vi.fn(() => "") },
    json: vi.fn().mockResolvedValue(payload)
  };
}

const chatId = "oc_a676db7b8ae16f5ca23a9dd9b15ed3ca";
const mail = {
  dedupeKey: "1234567890abcdef1234567890abcdef1234567890abcdef",
  senderName: "Candidate",
  senderEmail: "candidate@example.com",
  subject: "Investment *intern* application",
  receivedTime: "2026-07-18T09:00:00+08:00",
  hasAttachment: true
};
const detail = {
  body: "Hello team\nPlease see my resume.",
  bodyTruncated: false,
  attachments: [{
    id: "attachment-1",
    name: "Candidate Resume.pdf",
    contentType: "application/pdf",
    size: 3,
    bytes: new Uint8Array([1, 2, 3])
  }],
  skippedAttachments: []
};

describe("Feishu rich recruiting mail", () => {
  it("builds a card with mail body and attachment names but not attachment bytes", () => {
    const card = buildRichMailCard(mail, detail);
    const text = JSON.stringify(card);
    expect(text).toContain("Hello team");
    expect(text).toContain("Candidate Resume.pdf");
    expect(text).toContain("Investment \\\\*intern\\\\* application");
    expect(text).not.toContain("1,2,3");
  });

  it("uploads each resume and sends it as a file after the body card", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ code: 0, msg: "success", data: { message_id: "om-card" } }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, msg: "success", data: { file_key: "file-key" } }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, msg: "success", data: { message_id: "om-file" } }));
    const delivery = createFeishuRichMailDelivery({
      fetchImpl,
      getAccessToken: vi.fn().mockResolvedValue("tenant-token")
    });
    const progressUpdates = [];

    const result = await delivery.deliver({
      chatId,
      mail,
      detail,
      completedParts: [],
      onProgress: async (parts) => progressUpdates.push([...parts])
    });

    expect(result.ok).toBe(true);
    expect(result.completedParts).toEqual(["card", "attachment:attachment-1"]);
    expect(progressUpdates).toEqual([["card"], ["card", "attachment:attachment-1"]]);
    expect(String(fetchImpl.mock.calls[0][0])).toContain("/open-apis/im/v1/messages");
    expect(String(fetchImpl.mock.calls[1][0])).toContain("/open-apis/im/v1/files");
    expect(fetchImpl.mock.calls[1][1].body).toBeInstanceOf(FormData);
    const fileMessage = JSON.parse(fetchImpl.mock.calls[2][1].body);
    expect(fileMessage).toMatchObject({
      receive_id: chatId,
      msg_type: "file",
      content: "{\"file_key\":\"file-key\"}"
    });
  });

  it("skips already delivered parts when a retry resumes", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({ code: 0, data: { file_key: "file-key" } })
    ).mockResolvedValueOnce(
      jsonResponse({ code: 0, data: { message_id: "om-file" } })
    );
    const delivery = createFeishuRichMailDelivery({
      fetchImpl,
      getAccessToken: vi.fn().mockResolvedValue("tenant-token")
    });

    await delivery.deliver({
      chatId,
      mail,
      detail,
      completedParts: ["card"],
      onProgress: vi.fn()
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("accepts only Feishu chat identifiers", () => {
    expect(validateFeishuChatId(chatId)).toBe(true);
    expect(validateFeishuChatId("https://evil.example/oc_test")).toBe(false);
  });
});
