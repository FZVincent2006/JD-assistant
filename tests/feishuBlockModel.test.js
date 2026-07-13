import { describe, expect, it } from "vitest";
import fixture from "./fixtures/feishu-structural-sample.json";
import {
  BLOCK,
  buildBlockModel,
  sanitizeStructuralFixture,
  textOfBlock
} from "../src/lib/feishuBlockModel.js";

describe("Feishu block model", () => {
  it("uses each parent's children array as the only sibling order", () => {
    const model = buildBlockModel(fixture.items, fixture.revision_id);

    expect(model.rootId).toBe("page");
    expect(model.revisionId).toBe(7);
    expect(model.childrenByParent.get("page").slice(0, 4)).toEqual([
      "portfolio-heading",
      "portfolio-callout",
      "jd-heading",
      "jd-company-a"
    ]);
    expect(model.preorder.indexOf("summary-company-a")).toBeLessThan(model.preorder.indexOf("jd-heading"));
    expect(textOfBlock(model.blocks.get("jd-company-a-job-1"))).toBe("（1）示例岗位甲｜上海｜社招");
  });

  it("rejects missing child references and cycles", () => {
    const missing = structuredClone(fixture.items);
    missing[0].children.push("missing-block");
    expect(() => buildBlockModel(missing, 1)).toThrow("missing child");

    const cyclic = structuredClone(fixture.items);
    cyclic.find((block) => block.block_id === "jd-company-a-intro-bullet").children = ["page"];
    expect(() => buildBlockModel(cyclic, 1)).toThrow("cycle");
  });

  it("sanitizes IDs and prose while preserving structural labels and styles", () => {
    const raw = structuredClone(fixture.items);
    raw.find((block) => block.block_id === "jd-company-a-intro-bullet").bullet.elements[0].text_run.content =
      "原始公司介绍正文 user_123";

    const sanitized = sanitizeStructuralFixture(raw);
    const serialized = JSON.stringify(sanitized);

    expect(serialized).not.toContain("原始公司介绍正文");
    expect(serialized).not.toContain("user_123");
    expect(serialized).not.toContain("jd-company-a-intro-bullet");
    expect(serialized).toContain("Portfolio开放岗位汇总");
    expect(serialized).toContain("示例公司甲");
    expect(sanitized.some((block) => block.block_type === BLOCK.QUOTE_CONTAINER)).toBe(true);
  });
});
