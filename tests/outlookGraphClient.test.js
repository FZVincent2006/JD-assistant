import { describe, expect, it, vi } from "vitest";
import {
  createOutlookGraphClient,
  htmlToPlainText,
  isAllowedResumeAttachment
} from "../src/lib/outlookGraphClient.js";

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(payload)
  };
}

describe("Outlook Graph client", () => {
  it("converts HTML mail bodies to bounded readable text", () => {
    expect(htmlToPlainText("<p>Hello&nbsp;Candidate</p><p>Second<br>line</p><script>bad()</script>"))
      .toBe("Hello Candidate\n\nSecond\nline");
  });

  it("allows resume documents and rejects inline, oversized, or executable attachments", () => {
    expect(isAllowedResumeAttachment({ name: "resume.pdf", size: 10, isInline: false })).toBe(true);
    expect(isAllowedResumeAttachment({ name: "resume.docx", size: 10, isInline: false })).toBe(true);
    expect(isAllowedResumeAttachment({ name: "logo.pdf", size: 10, isInline: true })).toBe(false);
    expect(isAllowedResumeAttachment({ name: "resume.exe", size: 10, isInline: false })).toBe(false);
    expect(isAllowedResumeAttachment({ name: "resume.pdf", size: 31 * 1024 * 1024, isInline: false })).toBe(false);
  });

  it("finds the matching China-cloud message and downloads allowed attachment bytes", async () => {
    const attachmentBytes = new Uint8Array([1, 2, 3]).buffer;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ value: [{ id: "folder-1", displayName: "个人投递（需提醒）" }] }))
      .mockResolvedValueOnce(jsonResponse({
        value: [{
          id: "message-1",
          subject: "Investment internship application",
          receivedDateTime: "2026-07-18T01:00:00Z",
          from: { emailAddress: { name: "Candidate", address: "candidate@example.com" } },
          body: { contentType: "html", content: "<p>Hello team</p><p>Please see my resume.</p>" },
          hasAttachments: true
        }]
      }))
      .mockResolvedValueOnce(jsonResponse({
        value: [
          {
            "@odata.type": "#microsoft.graph.fileAttachment",
            id: "attachment-1",
            name: "Candidate Resume.pdf",
            contentType: "application/pdf",
            size: 3,
            isInline: false
          },
          {
            "@odata.type": "#microsoft.graph.fileAttachment",
            id: "attachment-2",
            name: "malware.exe",
            contentType: "application/octet-stream",
            size: 3,
            isInline: false
          }
        ]
      }))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: vi.fn().mockResolvedValue(attachmentBytes)
      });
    const client = createOutlookGraphClient({
      fetchImpl,
      getAccessToken: vi.fn().mockResolvedValue("graph-token")
    });

    const result = await client.loadMail({
      senderEmail: "candidate@example.com",
      subject: "Investment internship application",
      receivedTime: "2026-07-18T09:00:00+08:00"
    });

    expect(result).toMatchObject({
      messageId: "message-1",
      body: "Hello team\n\nPlease see my resume.",
      attachments: [{
        id: "attachment-1",
        name: "Candidate Resume.pdf",
        contentType: "application/pdf",
        size: 3
      }],
      skippedAttachments: [{ name: "malware.exe", reason: "unsupported" }]
    });
    expect([...result.attachments[0].bytes]).toEqual([1, 2, 3]);
    for (const [url, options] of fetchImpl.mock.calls) {
      expect(String(url)).toContain("https://microsoftgraph.chinacloudapi.cn/v1.0/");
      expect(options.headers.Authorization).toBe("Bearer graph-token");
    }
    expect(fetchImpl.mock.calls[3][1].headers.Accept).toBe("*/*");
  });
});
