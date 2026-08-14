import { FEISHU_NATIVE_HOST } from "./feishuNativeAuth.js";

const CHUNK_BYTES = 384 * 1024;

export class DownloadedFileReaderError extends Error {
  constructor(message, { stage = "outlook-native-downloaded-file" } = {}) {
    super(message);
    this.name = "DownloadedFileReaderError";
    this.stage = stage;
  }
}

export function createDownloadedFileReader({ chromeApi = chrome } = {}) {
  async function read({ path, name, expectedSize = 0 }) {
    const chunks = [];
    let offset = 0;
    let fileSize = 0;
    for (let part = 0; part < 100; part += 1) {
      const response = await sendNative({
        type: "READ_DOWNLOADED_FILE_CHUNK",
        path,
        offset,
        length: CHUNK_BYTES,
        expectedName: name,
        expectedSize: Number(expectedSize || 0)
      });
      if (!response?.ok || typeof response.fileChunkBase64 !== "string") {
        throw new DownloadedFileReaderError("The native helper rejected the downloaded file", {
          stage: "outlook-native-downloaded-file-read"
        });
      }
      const bytes = decodeBase64(response.fileChunkBase64);
      chunks.push(bytes);
      offset += bytes.byteLength;
      fileSize = Number(response.fileSize || fileSize);
      if (response.eof) break;
      if (!bytes.byteLength || offset > 30 * 1024 * 1024) {
        throw new DownloadedFileReaderError("The downloaded file chunks are incomplete");
      }
    }
    if (!fileSize || offset !== fileSize) {
      throw new DownloadedFileReaderError("The downloaded file size is incomplete");
    }
    const combined = new Uint8Array(fileSize);
    let cursor = 0;
    for (const chunk of chunks) {
      combined.set(chunk, cursor);
      cursor += chunk.byteLength;
    }
    return combined;
  }

  async function readAndDelete(options) {
    const combined = await read(options);
    const deleted = await sendNative({ type: "DELETE_DOWNLOADED_FILE", path: options.path });
    if (!deleted?.ok) {
      throw new DownloadedFileReaderError("The temporary downloaded file could not be removed", {
        stage: "outlook-native-downloaded-file-cleanup"
      });
    }
    return combined;
  }

  async function listRecent({ since, until }) {
    const response = await sendNative({
      type: "LIST_RECENT_DOWNLOADED_FILES",
      sinceMs: Math.trunc(Number(since || 0)),
      untilMs: Math.trunc(Number(until || 0))
    });
    if (!response?.ok || !Array.isArray(response.downloadedFiles)) {
      throw new DownloadedFileReaderError("The native helper could not inspect recent downloads", {
        stage: "outlook-native-downloaded-file-search"
      });
    }
    return response.downloadedFiles.map((file) => ({
      filename: String(file?.path || ""),
      totalBytes: Number(file?.size || 0),
      state: "complete",
      exists: true,
      startTime: new Date(Number(file?.modifiedAtMs || 0)).toISOString()
    }));
  }

  function sendNative(message) {
    return new Promise((resolve, reject) => {
      chromeApi.runtime.sendNativeMessage(FEISHU_NATIVE_HOST, message, (response) => {
        if (chromeApi.runtime.lastError) {
          reject(new DownloadedFileReaderError("The native helper is unavailable"));
          return;
        }
        resolve(response);
      });
    });
  }

  return { read, readAndDelete, listRecent };
}

function decodeBase64(value) {
  let binary;
  try {
    binary = atob(value);
  } catch {
    throw new DownloadedFileReaderError("The native file chunk is invalid");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
