import { describe, expect, it, vi } from "vitest";
import { FeishuApiError } from "../src/background/feishuApiClient.js";
import { createFeishuJobLinkRepairer } from "../src/background/feishuJobLinkRepairer.js";
import { PRODUCTION_FEISHU_DOC_URL } from "../src/lib/feishuConfig.js";
import { initialSnapshot } from "./helpers/feishuWriteScenario.js";

function linkedSnapshot(revisionId = 8) {
  const snapshot = initialSnapshot();
  snapshot.revisionId = revisionId;
  snapshot.documentId = "doc-test";
  for (const [companyIndex, company] of snapshot.portfolio.companies.entries()) {
    const target = snapshot.jd.companies[companyIndex].jobs[0];
    const url = `${PRODUCTION_FEISHU_DOC_URL}#${target.blockId}`;
    company.jobs[0].linkUrl = url;
    company.jobs[0].elements = [{
      text_run: {
        content: company.jobs[0].text,
        text_element_style: { link: { url } }
      }
    }];
  }
  return snapshot;
}

function partialSnapshot({ revisionId = 7, selectedLink = "" } = {}) {
  const snapshot = initialSnapshot();
  snapshot.revisionId = revisionId;
  snapshot.documentId = "doc-test";
  snapshot.portfolio.companies[0].jobs[0].elements[0].text_run.text_element_style = {
    link: { url: "https://example.com/legacy" }
  };
  if (selectedLink) {
    snapshot.portfolio.companies[1].jobs[0].elements[0].text_run.text_element_style = {
      link: { url: selectedLink }
    };
  }
  return snapshot;
}

function setup({
  snapshots = [Object.assign(initialSnapshot(), { documentId: "doc-test" }), linkedSnapshot()],
  request = vi.fn().mockResolvedValue({})
} = {}) {
  const inspect = vi.fn();
  for (const snapshot of snapshots) inspect.mockResolvedValueOnce(snapshot);
  const wait = vi.fn().mockResolvedValue(undefined);
  const repairer = createFeishuJobLinkRepairer({
    client: { request },
    inspect,
    wait
  });
  return { repairer, request, inspect, wait };
}

describe("Feishu historical Portfolio job-link repairer", () => {
  it("builds a read-only plan without calling a mutation API", async () => {
    const { repairer, request, inspect } = setup({ snapshots: [
      Object.assign(initialSnapshot(), { documentId: "doc-test" })
    ] });

    const plan = await repairer.plan();

    expect(plan).toMatchObject({
      ok: true,
      baseRevisionId: 7,
      totalJobs: 2,
      correctLinks: 0,
      updates: [
        { companyName: "示例公司甲", jobText: "示例岗位甲｜上海｜社招" },
        { companyName: "示例公司乙", jobText: "示例岗位乙｜深圳｜社招" }
      ]
    });
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects a stale preview before making any mutation request", async () => {
    const current = Object.assign(initialSnapshot(), { documentId: "doc-test", revisionId: 9 });
    const { repairer, request } = setup({ snapshots: [current] });

    const result = await repairer.write({ baseRevisionId: 7 });

    expect(result).toMatchObject({
      ok: false,
      status: "failed",
      failedStage: "job-link-preflight"
    });
    expect(result.repairHint).toContain("重新检查");
    expect(request).not.toHaveBeenCalled();
  });

  it("returns an idempotent success without PATCH when every link is already correct", async () => {
    const current = linkedSnapshot(9);
    const { repairer, request } = setup({ snapshots: [current] });

    const result = await repairer.write({ baseRevisionId: 9 });

    expect(result).toMatchObject({
      ok: true,
      status: "success",
      updatedLinks: 0,
      totalJobs: 2
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("batch-patches the previewed bullets at the exact document revision and verifies once", async () => {
    const initial = Object.assign(initialSnapshot(), { documentId: "doc-test" });
    const after = linkedSnapshot(8);
    const { repairer, request, inspect, wait } = setup({ snapshots: [initial, after] });

    const result = await repairer.write({ baseRevisionId: 7 });

    expect(result).toMatchObject({
      ok: true,
      status: "success",
      failedStage: null,
      updatedLinks: 2,
      totalJobs: 2
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe(
      "/open-apis/docx/v1/documents/doc-test/blocks/batch_update"
    );
    expect(request.mock.calls[0][1]).toMatchObject({
      method: "PATCH",
      query: { document_revision_id: 7 },
      stage: "job-link-write",
      body: {
        requests: [
          {
            block_id: "summary-job-a1",
            update_text_elements: {
              elements: [{
                text_run: {
                  content: "示例岗位甲｜上海｜社招",
                  text_element_style: {
                    link: {
                      url: `${PRODUCTION_FEISHU_DOC_URL}#jd-company-a-job-1`
                    }
                  }
                }
              }]
            }
          },
          expect.objectContaining({ block_id: "summary-job-b1" })
        ]
      }
    });
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(400);
  });

  it("patches only the selected company and leaves other missing links for a later batch", async () => {
    const initial = Object.assign(initialSnapshot(), { documentId: "doc-test" });
    const after = initialSnapshot();
    after.documentId = "doc-test";
    after.revisionId = 8;
    const target = after.jd.companies[0].jobs[0];
    const url = `${PRODUCTION_FEISHU_DOC_URL}#${target.blockId}`;
    after.portfolio.companies[0].jobs[0].linkUrl = url;
    after.portfolio.companies[0].jobs[0].elements[0].text_run.text_element_style = {
      link: { url }
    };
    const { repairer, request } = setup({ snapshots: [initial, after] });

    const result = await repairer.write({
      baseRevisionId: 7,
      companyNames: ["示例公司甲"]
    });

    expect(result).toMatchObject({
      ok: true,
      status: "success",
      updatedLinks: 1,
      totalJobs: 2
    });
    expect(request.mock.calls[0][1].body.requests).toEqual([
      expect.objectContaining({ block_id: "summary-job-a1" })
    ]);
  });

  it("writes and verifies a selected safe update while unrelated manual issues remain", async () => {
    const initial = partialSnapshot();
    const target = initial.jd.companies[1].jobs[0];
    const after = partialSnapshot({
      revisionId: 8,
      selectedLink: `${PRODUCTION_FEISHU_DOC_URL}#${target.blockId}`
    });
    const { repairer, request } = setup({ snapshots: [initial, after] });

    const result = await repairer.write({
      baseRevisionId: 7,
      companyNames: ["示例公司乙"]
    });

    expect(result).toMatchObject({
      ok: true,
      status: "success",
      updatedLinks: 1,
      totalJobs: 2
    });
    expect(request.mock.calls[0][1].body.requests).toEqual([
      expect.objectContaining({ block_id: "summary-job-b1" })
    ]);
  });

  it("fails verification when a selected update becomes a manual issue instead of a correct link", async () => {
    const initial = partialSnapshot();
    const after = partialSnapshot({
      revisionId: 8,
      selectedLink: "https://example.com/wrong-target"
    });
    const { repairer } = setup({ snapshots: [initial, after] });

    const result = await repairer.write({
      baseRevisionId: 7,
      companyNames: ["示例公司乙"]
    });

    expect(result).toMatchObject({
      ok: false,
      status: "failed",
      failedStage: "job-link-verify"
    });
  });

  it("rejects a selected company that is not in the current preview", async () => {
    const initial = Object.assign(initialSnapshot(), { documentId: "doc-test" });
    const { repairer, request } = setup({ snapshots: [initial] });

    const result = await repairer.write({
      baseRevisionId: 7,
      companyNames: ["不存在的公司"]
    });

    expect(result).toMatchObject({
      ok: false,
      status: "failed",
      failedStage: "job-link-preflight"
    });
    expect(result.repairHint).toContain("重新检查");
    expect(request).not.toHaveBeenCalled();
  });

  it("does not retry an explicit API rejection", async () => {
    const initial = Object.assign(initialSnapshot(), { documentId: "doc-test" });
    const request = vi.fn().mockRejectedValue(new FeishuApiError({
      status: 403,
      code: 99991672,
      logId: "safe-log",
      stage: "job-link-write",
      message: "private rejection"
    }));
    const { repairer, inspect } = setup({ snapshots: [initial], request });

    const result = await repairer.write({ baseRevisionId: 7 });

    expect(result).toMatchObject({
      ok: false,
      status: "failed",
      failedStage: "job-link-write",
      errorCode: 99991672,
      httpStatus: 403,
      logId: "safe-log"
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it("accepts an ambiguous network result only when read-back proves every link", async () => {
    const initial = Object.assign(initialSnapshot(), { documentId: "doc-test" });
    const request = vi.fn().mockRejectedValue(new FeishuApiError({
      status: 0,
      code: 0,
      stage: "job-link-write",
      message: "network"
    }));
    const { repairer, inspect } = setup({
      snapshots: [initial, linkedSnapshot(8)],
      request
    });

    const result = await repairer.write({ baseRevisionId: 7 });

    expect(result).toMatchObject({ ok: true, status: "success", updatedLinks: 2 });
    expect(request).toHaveBeenCalledTimes(1);
    expect(inspect).toHaveBeenCalledTimes(2);
  });

  it("reports unknown when an accepted update cannot be read back", async () => {
    const initial = Object.assign(initialSnapshot(), { documentId: "doc-test" });
    const inspect = vi.fn()
      .mockResolvedValueOnce(initial)
      .mockRejectedValueOnce(new Error("private unreadable"));
    const repairer = createFeishuJobLinkRepairer({
      client: { request: vi.fn().mockResolvedValue({}) },
      inspect,
      wait: vi.fn()
    });

    const result = await repairer.write({ baseRevisionId: 7 });

    expect(result).toMatchObject({
      ok: false,
      status: "unknown",
      failedStage: "job-link-verify"
    });
    expect(result.repairHint).toContain("不要重复提交");
  });

  it("fails verification when read-back still contains missing links", async () => {
    const initial = Object.assign(initialSnapshot(), { documentId: "doc-test" });
    const unchanged = Object.assign(initialSnapshot(), { documentId: "doc-test", revisionId: 8 });
    const { repairer } = setup({ snapshots: [initial, unchanged] });

    const result = await repairer.write({ baseRevisionId: 7 });

    expect(result).toMatchObject({
      ok: false,
      status: "failed",
      failedStage: "job-link-verify"
    });
    expect(result.repairHint).toContain("校验");
  });

  it("fails verification when a Portfolio job disappears during the update", async () => {
    const initial = Object.assign(initialSnapshot(), { documentId: "doc-test" });
    const after = linkedSnapshot(8);
    after.portfolio.companies.pop();
    const { repairer } = setup({ snapshots: [initial, after] });

    const result = await repairer.write({ baseRevisionId: 7 });

    expect(result).toMatchObject({
      ok: false,
      status: "failed",
      failedStage: "job-link-verify",
      totalJobs: 2
    });
  });
});
