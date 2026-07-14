const FEISHU_API_ORIGIN = "https://open.feishu.cn";

export class FeishuApiError extends Error {
  constructor({ message, status = 0, code = 0, logId = "", stage = "api" }) {
    super(message);
    this.name = "FeishuApiError";
    Object.assign(this, { status, code, logId, stage });
  }
}

export function createFeishuApiClient({ fetchImpl = fetch, getAccessToken }) {
  if (typeof getAccessToken !== "function") throw new TypeError("getAccessToken is required");

  async function request(path, {
    method = "GET",
    query = {},
    body,
    stage = "api"
  } = {}) {
    const token = await getAccessToken();
    const url = new URL(path, FEISHU_API_ORIGIN);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8"
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch {
      throw new FeishuApiError({ message: "Feishu API request failed", stage });
    }

    const payload = await response.json().catch(() => ({}));
    const code = Number(payload?.code ?? 0);
    if (!response.ok || code !== 0) {
      throw new FeishuApiError({
        message: "Feishu API request was rejected",
        status: response.status,
        code,
        logId: response.headers?.get?.("x-tt-logid") ?? "",
        stage
      });
    }
    return payload.data;
  }

  async function listAllBlocks(documentId, revisionId) {
    if (!documentId) throw new TypeError("documentId is required");
    const items = [];
    const seenPageTokens = new Set();
    let pageToken;

    do {
      const data = await request(
        `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks`,
        {
          query: {
            page_size: 500,
            page_token: pageToken,
            document_revision_id: revisionId
          },
          stage: "document-blocks-read"
        }
      );
      if (!Array.isArray(data?.items)) {
        throw new FeishuApiError({
          message: "Feishu block response is incomplete",
          stage: "document-blocks-read"
        });
      }
      items.push(...data.items);
      if (!data.has_more) break;
      const next = String(data.page_token ?? "");
      if (!next || seenPageTokens.has(next)) {
        throw new FeishuApiError({
          message: "Feishu block pagination is invalid",
          stage: "document-blocks-read"
        });
      }
      seenPageTokens.add(next);
      pageToken = next;
    } while (true);

    return items;
  }

  return { request, listAllBlocks };
}
