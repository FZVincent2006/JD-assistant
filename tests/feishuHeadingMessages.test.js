import { describe, expect, it, vi } from "vitest";
import { handleFeishuHeadingNumberingMessage } from "../src/content/feishuHeadingMessages.js";
import { PRODUCTION_FEISHU_DOC_URL } from "../src/lib/feishuConfig.js";

describe("Feishu heading numbering content messages", () => {
  it("passes only the fixed message payload to the page preparer", async () => {
    const prepare = vi.fn().mockResolvedValue({ ok: true, state: "prepared" });
    await expect(handleFeishuHeadingNumberingMessage(
      { type: "FEISHU_PREPARE_HEADING_NUMBERING", companyName: "CoFANCY 可糖", ignored: "secret" },
      { root: {}, url: PRODUCTION_FEISHU_DOC_URL, prepare }
    )).resolves.toEqual({ ok: true, state: "prepared" });
    expect(prepare).toHaveBeenCalledWith({ root: {}, url: PRODUCTION_FEISHU_DOC_URL, companyName: "CoFANCY 可糖" });
  });

  it("ignores unrelated messages", async () => {
    const prepare = vi.fn();
    await expect(handleFeishuHeadingNumberingMessage({ type: "FEISHU_WRITE" }, { prepare }))
      .resolves.toBeNull();
    expect(prepare).not.toHaveBeenCalled();
  });
});
