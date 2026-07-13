import { describe, expect, it, vi } from "vitest";
import { FeishuApiError } from "../src/background/feishuApiClient.js";
import { createFeishuOpenApiWriter } from "../src/background/feishuOpenApiWriter.js";
import { TEST_FEISHU_DOC_URL } from "../src/lib/feishuConfig.js";
import { draft, successfulSnapshots } from "./helpers/feishuWriteScenario.js";

function writerSetup({ snapshots, request } = {}) {
  const values = snapshots ?? successfulSnapshots();
  values.initial.documentId = "doc-test";
  values.jd.documentId = "doc-test";
  values.complete.documentId = "doc-test";
  const inspect = vi.fn()
    .mockResolvedValueOnce(values.initial)
    .mockResolvedValueOnce(values.jd)
    .mockResolvedValueOnce(values.complete);
  const client = { request: request ?? vi.fn().mockResolvedValue({}) };
  const wait = vi.fn().mockResolvedValue(undefined);
  return {
    values,
    inspect,
    client,
    wait,
    writer: createFeishuOpenApiWriter({ client, inspect, wait })
  };
}

describe("Feishu phased OpenAPI writer", () => {
  it("writes JD first, verifies it, then writes and verifies the summary with the fresh revision", async () => {
    const { writer, client, inspect, wait, values } = writerSetup();

    const result = await writer.write(draft);

    expect(result).toMatchObject({
      ok: true,
      status: "success",
      mode: "new-company",
      completedStages: ["jd", "summary"],
      failedStage: null,
      documentUrl: TEST_FEISHU_DOC_URL,
      companyName: draft.companyName,
      jobTitles: draft.jobs.map((job) => job.title)
    });
    expect(client.request).toHaveBeenCalledTimes(2);
    expect(client.request.mock.calls[0][1]).toMatchObject({
      method: "POST",
      query: { document_revision_id: values.initial.revisionId },
      body: { index: values.plan.jdTarget.index },
      stage: "jd-write"
    });
    expect(client.request.mock.calls[1][1]).toMatchObject({
      query: { document_revision_id: values.jd.revisionId },
      body: { index: values.plan.summaryTarget.index },
      stage: "summary-write"
    });
    expect(inspect).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenNthCalledWith(1, 400);
    expect(wait).toHaveBeenNthCalledWith(2, 400);
  });

  it("reports JD-only partial success when summary creation fails", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new FeishuApiError({ status: 403, code: 99991672, logId: "log-summary", stage: "summary-write", message: "rejected" }));
    const { writer } = writerSetup({ request });

    const result = await writer.write(draft);

    expect(result).toMatchObject({
      ok: false,
      status: "partial",
      completedStages: ["jd"],
      failedStage: "summary-write",
      errorCode: 99991672,
      logId: "log-summary"
    });
    expect(result.repairHint).toContain("Portfolio");
  });

  it("stops before summary when JD semantic verification fails", async () => {
    const values = successfulSnapshots();
    values.jd = structuredClone(values.initial);
    values.jd.documentId = "doc-test";
    const { writer, client } = writerSetup({ snapshots: values });

    const result = await writer.write(draft);

    expect(result).toMatchObject({ ok: false, completedStages: [], failedStage: "jd-verify" });
    expect(result.repairHint).toContain("岗位 JD");
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it.each([
    [403, 99991672],
    [409, 1770004],
    [429, 99991400]
  ])("does not retry a rejected JD write (%i)", async (status, code) => {
    const request = vi.fn().mockRejectedValue(new FeishuApiError({ status, code, stage: "jd-write", message: "rejected" }));
    const { writer, inspect } = writerSetup({ request });

    const result = await writer.write(draft);

    expect(result).toMatchObject({ ok: false, status: "failed", failedStage: "jd-write", errorCode: code });
    expect(request).toHaveBeenCalledTimes(1);
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it("classifies a timed-out JD edit as successful when exactly one read-back proves it persisted", async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new FeishuApiError({ status: 0, stage: "jd-write", message: "network" }))
      .mockResolvedValueOnce({});
    const { writer, inspect } = writerSetup({ request });

    const result = await writer.write(draft);

    expect(result.ok).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(inspect).toHaveBeenCalledTimes(3);
  });

  it("reports failure without retry when timeout read-back proves the JD edit is absent", async () => {
    const values = successfulSnapshots();
    values.jd = structuredClone(values.initial);
    values.jd.documentId = "doc-test";
    const request = vi.fn().mockRejectedValue(new FeishuApiError({ status: 0, stage: "jd-write", message: "network" }));
    const { writer, inspect } = writerSetup({ snapshots: values, request });

    const result = await writer.write(draft);

    expect(result).toMatchObject({ ok: false, status: "failed", failedStage: "jd-write" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(inspect).toHaveBeenCalledTimes(2);
  });

  it("reports unknown state when a timed-out edit cannot be read back", async () => {
    const { initial } = successfulSnapshots();
    initial.documentId = "doc-test";
    const inspect = vi.fn().mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error("unreadable"));
    const request = vi.fn().mockRejectedValue(new FeishuApiError({ status: 0, stage: "jd-write", message: "network" }));
    const writer = createFeishuOpenApiWriter({ client: { request }, inspect, wait: vi.fn() });

    const result = await writer.write(draft);

    expect(result).toMatchObject({ ok: false, status: "unknown", failedStage: "jd-write" });
    expect(result.repairHint).toContain("不要重复提交");
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not misclassify an unreadable post-success read-back as an API write rejection", async () => {
    const { initial } = successfulSnapshots();
    initial.documentId = "doc-test";
    const inspect = vi.fn().mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error("unreadable"));
    const request = vi.fn().mockResolvedValue({});
    const writer = createFeishuOpenApiWriter({ client: { request }, inspect, wait: vi.fn() });

    const result = await writer.write(draft);

    expect(result).toMatchObject({ ok: false, status: "unknown", failedStage: "jd-verify" });
    expect(result.repairHint).toContain("不要重复提交");
    expect(request).toHaveBeenCalledTimes(1);
    expect(inspect).toHaveBeenCalledTimes(2);
  });
});
