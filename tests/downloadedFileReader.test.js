import { describe, expect, it, vi } from "vitest";
import { createDownloadedFileReader } from "../src/background/downloadedFileReader.js";

describe("native downloaded file reader", () => {
  it("assembles multiple native chunks and deletes the temporary file", async () => {
    const responses = [
      { ok: true, fileChunkBase64: "JVBE", fileSize: 5, eof: false },
      { ok: true, fileChunkBase64: "Ri0=", fileSize: 5, eof: true },
      { ok: true }
    ];
    const chromeApi = {
      runtime: {
        lastError: null,
        sendNativeMessage: vi.fn((_host, _message, callback) => callback(responses.shift()))
      }
    };
    const reader = createDownloadedFileReader({ chromeApi });

    const bytes = await reader.readAndDelete({
      path: "/Users/test/Downloads/Candidate.pdf",
      name: "Candidate.pdf",
      expectedSize: 5
    });

    expect(new TextDecoder().decode(bytes)).toBe("%PDF-");
    expect(chromeApi.runtime.sendNativeMessage.mock.calls.map((call) => call[1].type))
      .toEqual([
        "READ_DOWNLOADED_FILE_CHUNK",
        "READ_DOWNLOADED_FILE_CHUNK",
        "DELETE_DOWNLOADED_FILE"
      ]);
    expect(chromeApi.runtime.sendNativeMessage.mock.calls[1][1].offset).toBe(3);
  });

  it("can read a validated download without deleting the user's file", async () => {
    const chromeApi = {
      runtime: {
        lastError: null,
        sendNativeMessage: vi.fn((_host, _message, callback) => callback({
          ok: true,
          fileChunkBase64: "JVBERi0=",
          fileSize: 5,
          eof: true
        }))
      }
    };
    const reader = createDownloadedFileReader({ chromeApi });

    const bytes = await reader.read({
      path: "/Users/test/Downloads/Candidate.pdf",
      name: "Candidate.pdf",
      expectedSize: 5
    });

    expect(new TextDecoder().decode(bytes)).toBe("%PDF-");
    expect(chromeApi.runtime.sendNativeMessage.mock.calls.map((call) => call[1].type))
      .toEqual(["READ_DOWNLOADED_FILE_CHUNK"]);
  });

  it("lists recent validated files through the native helper", async () => {
    const chromeApi = {
      runtime: {
        lastError: null,
        sendNativeMessage: vi.fn((_host, _message, callback) => callback({
          ok: true,
          downloadedFiles: [{
            path: "/Users/test/Downloads/Candidate.pdf",
            name: "Candidate.pdf",
            size: 505_856,
            modifiedAtMs: 1_786_592_258_000
          }]
        }))
      }
    };
    const reader = createDownloadedFileReader({ chromeApi });

    const files = await reader.listRecent({
      since: 1_786_592_163_246,
      until: 1_786_593_963_246
    });

    expect(files).toEqual([expect.objectContaining({
      filename: "/Users/test/Downloads/Candidate.pdf",
      totalBytes: 505_856,
      state: "complete"
    })]);
    expect(chromeApi.runtime.sendNativeMessage.mock.calls[0][1]).toEqual({
      type: "LIST_RECENT_DOWNLOADED_FILES",
      sinceMs: 1_786_592_163_246,
      untilMs: 1_786_593_963_246
    });
  });
});
