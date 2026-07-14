import { describe, expect, it, vi } from "vitest";
import { handleFeishuHeadingNumberingMessage } from "../src/content/feishuHeadingMessages.js";
import { TEST_FEISHU_DOC_URL } from "../src/lib/feishuConfig.js";

describe("Feishu heading numbering content messages", () => {
  it("passes only the fixed message payload to the page numberer", async () => {
    const apply = vi.fn().mockResolvedValue({ ok: true });
    await expect(handleFeishuHeadingNumberingMessage(
      { type: "FEISHU_APPLY_HEADING_NUMBERING", companyName: "CoFANCY 可糖", ignored: "secret" },
      { root: {}, url: TEST_FEISHU_DOC_URL, apply }
    )).resolves.toEqual({ ok: true });
    expect(apply).toHaveBeenCalledWith({ root: {}, url: TEST_FEISHU_DOC_URL, companyName: "CoFANCY 可糖" });
  });

  it("ignores unrelated messages", async () => {
    const apply = vi.fn();
    await expect(handleFeishuHeadingNumberingMessage({ type: "FEISHU_WRITE" }, { apply }))
      .resolves.toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });
});
