import { describe, expect, it } from "vitest";
import {
  PRODUCTION_FEISHU_DOC_URL,
  PRODUCTION_FEISHU_WIKI_TOKEN,
  isProductionFeishuDocument
} from "../src/lib/feishuConfig.js";

describe("production Feishu document target", () => {
  it("allows only the fixed production wiki document", () => {
    expect(PRODUCTION_FEISHU_DOC_URL).toBe(
      "https://zhenfund.feishu.cn/wiki/RTWjwVZjri4uCUk0J8wcn2K3n6d"
    );
    expect(PRODUCTION_FEISHU_WIKI_TOKEN).toBe("RTWjwVZjri4uCUk0J8wcn2K3n6d");
    expect(
      isProductionFeishuDocument(
        `${PRODUCTION_FEISHU_DOC_URL}?fromScene=spaceOverview#block`
      )
    ).toBe(true);
    expect(
      isProductionFeishuDocument(
        "https://zhenfund.feishu.cn/wiki/LlhrwSLIvilANZk1opwcQGlUnNv"
      )
    ).toBe(false);
  });
});
