import { describe, expect, it, vi } from "vitest";
import { handleFeishuMessage } from "../src/content/feishuMessages.js";
import { TEST_FEISHU_DOC_URL } from "../src/lib/feishuConfig.js";

describe("handleFeishuMessage", () => {
  it("returns a full document snapshot for inspection", async () => {
    const snapshot = { editable: true, portfolioHeadingCount: 1, jdHeadingCount: 1 };
    const scan = vi.fn().mockResolvedValue(snapshot);
    await expect(handleFeishuMessage(
      { type: "FEISHU_INSPECT" },
      { root: {}, url: TEST_FEISHU_DOC_URL, scan }
    )).resolves.toEqual({ ok: true, snapshot });
  });

  it("delegates writes with the message payload", async () => {
    const write = vi.fn().mockResolvedValue({ ok: true, completed: ["jd", "summary"] });
    const draft = { companyName: "Test" };
    const result = await handleFeishuMessage(
      { type: "FEISHU_WRITE", payload: draft },
      { root: {}, url: TEST_FEISHU_DOC_URL, write }
    );
    expect(write).toHaveBeenCalledWith({ root: {}, url: TEST_FEISHU_DOC_URL, draft }, expect.any(Object));
    expect(result.ok).toBe(true);
  });
});
