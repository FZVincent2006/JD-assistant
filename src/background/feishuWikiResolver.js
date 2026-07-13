import { TEST_FEISHU_WIKI_TOKEN } from "../lib/feishuConfig.js";

export async function resolveFixedTestDocument(client) {
  const wiki = await client.request("/open-apis/wiki/v2/spaces/get_node", {
    query: { token: TEST_FEISHU_WIKI_TOKEN },
    stage: "wiki-resolve"
  });
  const node = wiki?.node;
  if (node?.obj_type !== "docx") {
    throw new Error("The fixed Feishu Wiki target is not a docx document");
  }
  if (!node.obj_token || !node.space_id) {
    throw new Error("Feishu Wiki node metadata is incomplete");
  }

  const documentId = node.obj_token;
  const metadata = await client.request(
    `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}`,
    { stage: "document-metadata" }
  );
  const document = metadata?.document;
  if (
    document?.document_id !== documentId
    || !Number.isFinite(document?.revision_id)
    || !(document.title || node.title)
  ) {
    throw new Error("Feishu document metadata is incomplete");
  }

  const revisionId = document.revision_id;
  const blocks = await client.listAllBlocks(documentId, revisionId);
  return {
    wikiToken: TEST_FEISHU_WIKI_TOKEN,
    documentId,
    spaceId: node.space_id,
    title: document.title || node.title,
    revisionId,
    blocks
  };
}
