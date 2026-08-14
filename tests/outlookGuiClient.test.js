import { describe, expect, it, vi } from "vitest";
import {
  createOutlookGuiClient,
  validateDownloadedAttachment
} from "../src/lib/outlookGuiClient.js";

const validPdfBytes = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n%%EOF");

function createChromeEvent() {
  const listeners = new Set();
  return {
    addListener: vi.fn((listener) => listeners.add(listener)),
    removeListener: vi.fn((listener) => listeners.delete(listener)),
    emit: (...args) => [...listeners].forEach((listener) => listener(...args))
  };
}

function createDownloadCapableChrome({ detail, filename, startedAt, id = 77 }) {
  const onCreated = createChromeEvent();
  const onChanged = createChromeEvent();
  const downloadItem = {
    id,
    filename,
    state: "complete",
    exists: true,
    startTime: new Date(startedAt).toISOString()
  };
  const chromeApi = {
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 42 }]),
      sendMessage: vi.fn()
        .mockResolvedValueOnce({ ok: true, detail })
        .mockImplementationOnce(async () => {
          onCreated.emit({ ...downloadItem, state: "in_progress" });
          onChanged.emit({ id, state: { current: "complete" } });
          return { ok: true };
        })
    },
    downloads: {
      onCreated,
      onChanged,
      search: vi.fn().mockResolvedValue([downloadItem]),
      erase: vi.fn().mockResolvedValue([id])
    }
  };
  return { chromeApi, onCreated, onChanged };
}

describe("Outlook GUI client", () => {
  it("sends the card data and marks an attachment for retry when download monitoring is unavailable", async () => {
    const chromeApi = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 42 }]),
        sendMessage: vi.fn().mockResolvedValue({
          ok: true,
          detail: {
            body: "Full candidate email body",
            bodyTruncated: false,
            attachments: [{
              id: "attachment-1",
              name: "Resume.pdf",
              size: validPdfBytes.byteLength
            }],
            skippedAttachments: [{ name: "malware.exe", size: 3 }]
          }
        })
      }
    };
    const client = createOutlookGuiClient({ chromeApi });

    await expect(client.loadMail({
      conversationId: "conv-1",
      subject: "Investment internship application",
      hasAttachment: true
    })).resolves.toMatchObject({
      body: "Full candidate email body",
      attachments: [],
      skippedAttachments: [
        {
          name: "Resume.pdf",
          reason: "download-failed",
          stage: "outlook-browser-download-unavailable"
        },
        { name: "malware.exe", reason: "unsupported" }
      ],
      retryableAttachmentFailure: true
    });
  });

  it("does not block the card when the mail row has a paperclip but no control is found", async () => {
    const chromeApi = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 42 }]),
        sendMessage: vi.fn().mockResolvedValue({
          ok: true,
          detail: {
            body: "Candidate body",
            attachments: [],
            skippedAttachments: []
          }
        })
      }
    };
    const client = createOutlookGuiClient({ chromeApi });

    await expect(client.loadMail({
      conversationId: "conv-paperclip",
      subject: "Candidate",
      hasAttachment: true
    })).resolves.toMatchObject({
      body: "Candidate body",
      attachments: [],
      skippedAttachments: [{
        name: "邮件中的简历附件",
        reason: "control-not-found",
        stage: "outlook-gui-attachment-control"
      }],
      retryableAttachmentFailure: true
    });
  });

  it("uses a visible filename as metadata for the independent download flow", async () => {
    const chromeApi = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 42 }]),
        sendMessage: vi.fn().mockResolvedValue({
          ok: true,
          detail: {
            body: "Candidate body",
            attachments: [],
            skippedAttachments: [{ name: "Candidate.pdf", reason: "no-download-url", size: 494 * 1024 }]
          }
        })
      }
    };
    const client = createOutlookGuiClient({ chromeApi });

    await expect(client.loadMail({
      conversationId: "conv-file-name",
      subject: "Candidate",
      hasAttachment: true
    })).resolves.toMatchObject({
      body: "Candidate body",
      attachments: [],
      skippedAttachments: [{
        name: "Candidate.pdf",
        reason: "download-failed",
        stage: "outlook-browser-download-unavailable"
      }],
      retryableAttachmentFailure: true
    });
  });

  it("rejects an HTML placeholder captured under a PDF filename", () => {
    expect(() => validateDownloadedAttachment({
      name: "Candidate.pdf",
      bytes: new TextEncoder().encode("<html>Sign in</html>"),
      expectedSize: 494 * 1024,
      contentType: "text/html"
    })).toThrow(expect.objectContaining({ stage: "outlook-gui-attachment-content" }));
  });

  it("rejects a tiny captured PDF when Outlook displays a much larger file", () => {
    expect(() => validateDownloadedAttachment({
      name: "Candidate.pdf",
      bytes: validPdfBytes,
      expectedSize: 494 * 1024,
      contentType: "application/pdf"
    })).toThrow(expect.objectContaining({ stage: "outlook-gui-attachment-size-mismatch" }));
  });

  it("accepts a PNG resume image", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    expect(() => validateDownloadedAttachment({
      name: "Candidate.png",
      bytes: png,
      contentType: "image/png"
    })).not.toThrow();
  });

  it("listens before triggering Outlook and reads the completed real PDF", async () => {
    const realPdf = new Uint8Array(494 * 1024);
    realPdf.set(new TextEncoder().encode("%PDF-1.7\n"));
    const startedAt = Date.parse("2026-08-11T20:00:00+08:00");
    const downloadedFileReader = {
      readAndDelete: vi.fn().mockResolvedValue(realPdf)
    };
    const mail = {
      conversationId: "conv-real-download",
      subject: "Candidate",
      hasAttachment: true
    };
    const { chromeApi, onCreated, onChanged } = createDownloadCapableChrome({
      detail: {
        body: "Candidate body",
        attachments: [],
        skippedAttachments: [{
          name: "Candidate.pdf",
          reason: "no-download-url",
          size: realPdf.byteLength
        }]
      },
      filename: "/Users/test/Downloads/Candidate.pdf",
      startedAt
    });
    const client = createOutlookGuiClient({
      chromeApi,
      downloadedFileReader,
      now: () => startedAt
    });

    const result = await client.loadMail(mail);

    expect(result).toMatchObject({
      body: "Candidate body",
      attachments: [{ name: "Candidate.pdf", size: realPdf.byteLength }],
      skippedAttachments: [],
      retryableAttachmentFailure: false
    });
    expect([...result.attachments[0].bytes.slice(0, 8)])
      .toEqual([...realPdf.slice(0, 8)]);
    expect(chromeApi.tabs.sendMessage.mock.calls).toEqual([
      [42, { type: "OUTLOOK_READ_MAIL_DETAIL", mail }],
      [42, { type: "OUTLOOK_TRIGGER_ATTACHMENT_DOWNLOAD", mail, name: "Candidate.pdf" }]
    ]);
    expect(onCreated.addListener.mock.invocationCallOrder[0])
      .toBeLessThan(chromeApi.tabs.sendMessage.mock.invocationCallOrder[1]);
    expect(onChanged.addListener.mock.invocationCallOrder[0])
      .toBeLessThan(chromeApi.tabs.sendMessage.mock.invocationCallOrder[1]);
    expect(downloadedFileReader.readAndDelete).toHaveBeenCalledWith({
      path: "/Users/test/Downloads/Candidate.pdf",
      name: "Candidate.pdf",
      expectedSize: realPdf.byteLength
    });
    expect(chromeApi.downloads.erase).not.toHaveBeenCalled();
  });

  it("recovers a completed PDF from Chrome search when the live download event was missed", async () => {
    const realPdf = new Uint8Array(506 * 1024);
    realPdf.set(new TextEncoder().encode("%PDF-1.7\n"));
    const startedAt = Date.parse("2026-08-11T20:43:00+08:00");
    const onCreated = createChromeEvent();
    const onChanged = createChromeEvent();
    const item = {
      id: 88,
      filename: "/Users/test/Downloads/Candidate (5).pdf",
      state: "complete",
      startTime: new Date(startedAt + 500).toISOString()
    };
    const chromeApi = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 42 }]),
        sendMessage: vi.fn()
          .mockResolvedValueOnce({
            ok: true,
            detail: {
              body: "Candidate body",
              attachments: [],
              skippedAttachments: [{
                name: "Candidate.pdf",
                reason: "no-download-url",
                size: realPdf.byteLength
              }]
            }
          })
          .mockResolvedValueOnce({ ok: true })
      },
      downloads: {
        onCreated,
        onChanged,
        search: vi.fn().mockResolvedValue([item]),
        erase: vi.fn().mockResolvedValue([88])
      }
    };
    const downloadedFileReader = {
      readAndDelete: vi.fn().mockResolvedValue(realPdf)
    };
    const client = createOutlookGuiClient({
      chromeApi,
      downloadedFileReader,
      now: () => startedAt
    });

    await expect(client.loadMail({
      conversationId: "conv-search-fallback",
      subject: "Candidate",
      hasAttachment: true
    })).resolves.toMatchObject({
      attachments: [{ name: "Candidate.pdf", size: realPdf.byteLength }],
      retryableAttachmentFailure: false
    });
    expect(downloadedFileReader.readAndDelete).toHaveBeenCalledWith({
      path: "/Users/test/Downloads/Candidate (5).pdf",
      name: "Candidate.pdf",
      expectedSize: realPdf.byteLength
    });
  });

  it("binds an Outlook-generated image filename to the new download event by id and type", async () => {
    const png = new Uint8Array(185_675);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const startedAt = Date.parse("2026-08-12T12:00:00+08:00");
    const onCreated = createChromeEvent();
    const onChanged = createChromeEvent();
    const downloadItem = {
      id: 93,
      filename: "/Users/test/Downloads/BD73D418@F600D213.png",
      state: "complete",
      exists: true,
      totalBytes: png.byteLength,
      startTime: new Date(startedAt + 100).toISOString()
    };
    const chromeApi = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 42 }]),
        sendMessage: vi.fn()
          .mockResolvedValueOnce({
            ok: true,
            detail: {
              body: "Candidate body",
              attachments: [],
              skippedAttachments: [{
                id: "inline-image-1",
                name: "邮件图片简历-1.png",
                reason: "inline-image",
                kind: "inline-image"
              }]
            }
          })
          .mockImplementationOnce(async () => {
            onCreated.emit({ ...downloadItem, state: "in_progress" });
            onChanged.emit({ id: downloadItem.id, state: { current: "complete" } });
            return { ok: true, size: png.byteLength };
          })
      },
      downloads: {
        onCreated,
        onChanged,
        search: vi.fn(async (query) => query?.id === downloadItem.id ? [downloadItem] : [])
      }
    };
    const downloadedFileReader = { read: vi.fn().mockResolvedValue(png) };
    const client = createOutlookGuiClient({
      chromeApi,
      downloadedFileReader,
      now: () => startedAt
    });

    const result = await client.loadMail({
      conversationId: "conv-live-image",
      subject: "实习生 - 上海交大",
      hasAttachment: true
    });

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toMatchObject({
      name: "邮件图片简历-1.png",
      size: png.byteLength,
      contentType: "image/png"
    });
    expect(downloadedFileReader.read).toHaveBeenCalledWith({
      path: downloadItem.filename,
      name: "邮件图片简历-1.png",
      expectedSize: png.byteLength
    });
  });

  it("reuses a recent validated PDF on attachment-only retry without clicking Outlook again", async () => {
    const realPdf = new Uint8Array(506 * 1024);
    realPdf.set(new TextEncoder().encode("%PDF-1.7\n"));
    const now = Date.parse("2026-08-11T20:49:00+08:00");
    const item = {
      id: 89,
      filename: "/Users/test/Downloads/Candidate (5).pdf",
      state: "complete",
      exists: true,
      totalBytes: realPdf.byteLength,
      startTime: new Date(now - 6 * 60 * 1000).toISOString()
    };
    const chromeApi = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 42 }]),
        sendMessage: vi.fn().mockResolvedValue({
          ok: true,
          detail: {
            body: "Candidate body",
            attachments: [],
            skippedAttachments: [{
              name: "Candidate.pdf",
              reason: "no-download-url",
              size: 494 * 1024
            }]
          }
        })
      },
      downloads: {
        onCreated: createChromeEvent(),
        onChanged: createChromeEvent(),
        search: vi.fn().mockResolvedValue([item]),
        erase: vi.fn().mockResolvedValue([89])
      }
    };
    const downloadedFileReader = {
      readAndDelete: vi.fn().mockResolvedValue(realPdf)
    };
    const client = createOutlookGuiClient({
      chromeApi,
      downloadedFileReader,
      now: () => now
    });

    await expect(client.loadMail({
      conversationId: "conv-retry-existing-download",
      subject: "Candidate",
      hasAttachment: true,
      reuseRecentAttachmentDownload: true
    })).resolves.toMatchObject({
      attachments: [{ name: "Candidate.pdf", size: realPdf.byteLength }],
      retryableAttachmentFailure: false
    });
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledTimes(1);
    expect(downloadedFileReader.readAndDelete).toHaveBeenCalledWith({
      path: "/Users/test/Downloads/Candidate (5).pdf",
      name: "Candidate.pdf",
      expectedSize: 494 * 1024
    });
  });

  it("recovers the only recent image download when Outlook no longer exposes attachment metadata", async () => {
    const png = new Uint8Array(185_675);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const now = Date.parse("2026-08-12T11:20:00+08:00");
    const item = {
      id: 90,
      filename: "/Users/test/Downloads/BD73D418@F600D213.01D57B6A00000000.png",
      state: "complete",
      exists: true,
      totalBytes: png.byteLength,
      startTime: new Date(now - 16 * 60 * 1000).toISOString()
    };
    const chromeApi = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 42 }]),
        sendMessage: vi.fn().mockResolvedValue({
          ok: true,
          detail: { body: "Candidate body", attachments: [], skippedAttachments: [] }
        })
      },
      downloads: {
        onCreated: createChromeEvent(),
        onChanged: createChromeEvent(),
        search: vi.fn().mockResolvedValue([item]),
        erase: vi.fn()
      }
    };
    const downloadedFileReader = {
      read: vi.fn().mockResolvedValue(png),
      readAndDelete: vi.fn()
    };
    const client = createOutlookGuiClient({ chromeApi, downloadedFileReader, now: () => now });

    await expect(client.loadMail({
      conversationId: "conv-image-recovery",
      subject: "实习生 - 上海交大",
      hasAttachment: true,
      reuseRecentAttachmentDownload: true
    })).resolves.toMatchObject({
      attachments: [{
        name: "BD73D418@F600D213.01D57B6A00000000.png",
        size: png.byteLength,
        contentType: "image/png"
      }],
      skippedAttachments: [],
      retryableAttachmentFailure: false
    });
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledTimes(1);
    expect(downloadedFileReader.read).toHaveBeenCalledWith({
      path: item.filename,
      name: "BD73D418@F600D213.01D57B6A00000000.png",
      expectedSize: png.byteLength
    });
  });

  it("recovers a resume from the native Downloads folder when Chrome history returns nothing", async () => {
    const pdf = new Uint8Array(418_720);
    pdf.set(new TextEncoder().encode("%PDF-1.7\n"));
    const createdAt = Date.parse("2026-08-13T11:36:03+08:00");
    const item = {
      filename: "/Users/test/Downloads/林诗青_简历_大使(1).pdf",
      state: "complete",
      exists: true,
      totalBytes: pdf.byteLength,
      startTime: new Date(createdAt + 95_000).toISOString()
    };
    const chromeApi = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 42 }]),
        sendMessage: vi.fn().mockResolvedValue({
          ok: true,
          detail: { body: "获取 Outlook for Mac", attachments: [], skippedAttachments: [] }
        })
      },
      downloads: {
        onCreated: createChromeEvent(),
        onChanged: createChromeEvent(),
        search: vi.fn().mockResolvedValue([])
      }
    };
    const downloadedFileReader = {
      listRecent: vi.fn().mockResolvedValue([item]),
      read: vi.fn().mockResolvedValue(pdf)
    };
    const client = createOutlookGuiClient({ chromeApi, downloadedFileReader });

    const result = await client.loadMail({
      conversationId: "conv-lin",
      subject: "实习简历投递",
      hasAttachment: true,
      reuseRecentAttachmentDownload: true,
      attachmentSearchSince: createdAt,
      attachmentSearchUntil: createdAt + 30 * 60_000
    });

    expect(result).toMatchObject({
      attachments: [{ name: "林诗青_简历_大使(1).pdf", size: pdf.byteLength }],
      retryableAttachmentFailure: false
    });
    expect(downloadedFileReader.listRecent).toHaveBeenCalledWith({
      since: createdAt,
      until: createdAt + 30 * 60_000
    });
  });

  it("recovers multiple attachment types and deduplicates retry copies", async () => {
    const docx = new Uint8Array(54_178);
    docx.set([0x50, 0x4b, 0x03, 0x04]);
    const pdf = new Uint8Array(125_910);
    pdf.set(new TextEncoder().encode("%PDF-1.7\n"));
    const createdAt = Date.parse("2026-08-13T16:36:02+08:00");
    const downloads = [{
      filename: "/Users/test/Downloads/姜婕-西南大学-招聘 2026.8.pdf",
      state: "complete",
      exists: true,
      totalBytes: pdf.byteLength,
      startTime: new Date(createdAt + 25_000).toISOString()
    }, {
      filename: "/Users/test/Downloads/姜婕-西南大学-招聘 2026.8 (1).docx",
      state: "complete",
      exists: true,
      totalBytes: docx.byteLength,
      startTime: new Date(createdAt + 24_000).toISOString()
    }, {
      filename: "/Users/test/Downloads/姜婕-西南大学-招聘 2026.8.docx",
      state: "complete",
      exists: true,
      totalBytes: docx.byteLength,
      startTime: new Date(createdAt + 4_000).toISOString()
    }];
    const chromeApi = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 42 }]),
        sendMessage: vi.fn().mockResolvedValue({
          ok: true,
          detail: { body: "Candidate body", attachments: [], skippedAttachments: [] }
        })
      },
      downloads: {
        onCreated: createChromeEvent(),
        onChanged: createChromeEvent(),
        search: vi.fn().mockResolvedValue([])
      }
    };
    const downloadedFileReader = {
      listRecent: vi.fn().mockResolvedValue(downloads),
      read: vi.fn(async ({ name }) => name.endsWith(".pdf") ? pdf : docx)
    };
    const client = createOutlookGuiClient({ chromeApi, downloadedFileReader });

    const result = await client.loadMail({
      conversationId: "conv-jiang",
      subject: "姜婕-西南大学-招聘",
      hasAttachment: true,
      reuseRecentAttachmentDownload: true,
      attachmentSearchSince: createdAt,
      attachmentSearchUntil: createdAt + 30 * 60_000
    });

    expect(result.retryableAttachmentFailure).toBe(false);
    expect(result.attachments).toHaveLength(2);
    expect(result.attachments.map((attachment) => attachment.name)).toEqual([
      "姜婕-西南大学-招聘 2026.8.pdf",
      "姜婕-西南大学-招聘 2026.8 (1).docx"
    ]);
    expect(downloadedFileReader.read).toHaveBeenCalledTimes(2);
  });

  it("uses the real recent filename when Outlook exposes only a generated inline-image name", async () => {
    const png = new Uint8Array(185_675);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const now = Date.parse("2026-08-12T11:20:00+08:00");
    const item = {
      id: 91,
      filename: "/Users/test/Downloads/BD73D418@F600D213.01D57B6A00000000.png",
      state: "complete",
      exists: true,
      totalBytes: png.byteLength,
      startTime: new Date(now - 16 * 60 * 1000).toISOString()
    };
    const chromeApi = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 42 }]),
        sendMessage: vi.fn().mockResolvedValue({
          ok: true,
          detail: {
            body: "Candidate body",
            attachments: [],
            skippedAttachments: [{
              id: "inline-image-1",
              name: "邮件图片简历-1.png",
              reason: "inline-image",
              kind: "inline-image"
            }]
          }
        })
      },
      downloads: {
        onCreated: createChromeEvent(),
        onChanged: createChromeEvent(),
        search: vi.fn().mockResolvedValue([item]),
        erase: vi.fn()
      }
    };
    const downloadedFileReader = {
      read: vi.fn().mockResolvedValue(png),
      readAndDelete: vi.fn()
    };
    const client = createOutlookGuiClient({ chromeApi, downloadedFileReader, now: () => now });

    await expect(client.loadMail({
      conversationId: "conv-generated-image-name",
      subject: "实习生 - 上海交大",
      hasAttachment: true,
      reuseRecentAttachmentDownload: true
    })).resolves.toMatchObject({
      attachments: [{ name: "BD73D418@F600D213.01D57B6A00000000.png" }],
      retryableAttachmentFailure: false
    });
    expect(downloadedFileReader.readAndDelete).not.toHaveBeenCalled();
  });

  it("restores a prepared attachment from its durable local reference without using Outlook", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const downloadedFileReader = { read: vi.fn().mockResolvedValue(png) };
    const chromeApi = { tabs: { query: vi.fn(), sendMessage: vi.fn() } };
    const client = createOutlookGuiClient({ chromeApi, downloadedFileReader });

    await expect(client.restorePreparedDetail({
      body: "Saved candidate body",
      bodyTruncated: false,
      skippedAttachments: [],
      attachmentRefs: [{
        id: "image-ref",
        path: "/Users/test/Downloads/BD73D418.png",
        name: "Candidate.png",
        contentType: "image/png",
        expectedSize: png.byteLength
      }]
    })).resolves.toMatchObject({
      body: "Saved candidate body",
      attachments: [{ name: "Candidate.png", size: png.byteLength }]
    });
    expect(chromeApi.tabs.query).not.toHaveBeenCalled();
  });
});
