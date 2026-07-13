import { describe, expect, it, vi } from "vitest";
import { TEST_FEISHU_WIKI_TOKEN } from "../src/lib/feishuConfig.js";
import { resolveFixedTestDocument } from "../src/background/feishuWikiResolver.js";

describe("fixed Feishu Wiki resolver", () => {
  it("resolves only the fixed Wiki token to document metadata and blocks", async () => {
    const blocks = [{ block_id: "root", block_type: 1 }];
    const client = {
      request: vi.fn(async (path, options) => {
        if (path === "/open-apis/wiki/v2/spaces/get_node") {
          expect(options).toMatchObject({ query: { token: TEST_FEISHU_WIKI_TOKEN }, stage: "wiki-resolve" });
          return {
            node: {
              space_id: "space-1",
              obj_type: "docx",
              obj_token: "doc-1",
              title: "测试文档"
            }
          };
        }
        expect(path).toBe("/open-apis/docx/v1/documents/doc-1");
        return { document: { document_id: "doc-1", revision_id: 42, title: "测试文档" } };
      }),
      listAllBlocks: vi.fn(async (documentId, revisionId) => {
        expect({ documentId, revisionId }).toEqual({ documentId: "doc-1", revisionId: 42 });
        return blocks;
      })
    };

    await expect(resolveFixedTestDocument(client)).resolves.toEqual({
      wikiToken: TEST_FEISHU_WIKI_TOKEN,
      documentId: "doc-1",
      spaceId: "space-1",
      title: "测试文档",
      revisionId: 42,
      blocks
    });
  });

  it("rejects a fixed Wiki target that is not docx", async () => {
    const client = {
      request: vi.fn(async () => ({
        node: { space_id: "space-1", obj_type: "sheet", obj_token: "sheet-1", title: "Wrong" }
      })),
      listAllBlocks: vi.fn()
    };

    await expect(resolveFixedTestDocument(client)).rejects.toThrow("not a docx document");
    expect(client.listAllBlocks).not.toHaveBeenCalled();
  });

  it("rejects missing document identity or revision metadata", async () => {
    const client = {
      request: vi.fn()
        .mockResolvedValueOnce({ node: { space_id: "space-1", obj_type: "docx", obj_token: "doc-1" } })
        .mockResolvedValueOnce({ document: { document_id: "doc-1", title: "Missing revision" } }),
      listAllBlocks: vi.fn()
    };

    await expect(resolveFixedTestDocument(client)).rejects.toThrow("metadata is incomplete");
  });
});
