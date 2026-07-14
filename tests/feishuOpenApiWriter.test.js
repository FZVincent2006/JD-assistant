import { describe, expect, it, vi } from "vitest";
import { FeishuApiError } from "../src/background/feishuApiClient.js";
import { createFeishuOpenApiWriter } from "../src/background/feishuOpenApiWriter.js";
import { PRODUCTION_FEISHU_DOC_URL } from "../src/lib/feishuConfig.js";
import { buildFeishuOpenApiPlan } from "../src/lib/feishuOpenApiPlan.js";
import { draft, initialSnapshot, successfulSnapshots } from "./helpers/feishuWriteScenario.js";

function writerSetup({ snapshots, request } = {}) {
  const values = snapshots ?? successfulSnapshots();
  values.initial.documentId = "doc-test";
  values.unnumberedJd.documentId = "doc-test";
  values.complete.documentId = "doc-test";
  const inspect = vi.fn()
    .mockResolvedValueOnce(values.initial)
    .mockResolvedValueOnce(values.unnumberedJd)
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
  it("writes JD, verifies it, then writes the summary without page interaction", async () => {
    const { writer, client, inspect, wait, values } = writerSetup();

    const result = await writer.write(draft);

    expect(result).toMatchObject({
      ok: true,
      status: "success",
      mode: "new-company",
      completedStages: ["jd", "summary"],
      failedStage: null,
      documentUrl: PRODUCTION_FEISHU_DOC_URL,
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
      query: { document_revision_id: values.unnumberedJd.revisionId },
      body: { index: values.plan.summaryTarget.index },
      stage: "summary-write"
    });
    const serializedRequests = JSON.stringify(client.request.mock.calls);
    expect(serializedRequests).not.toContain('"PATCH"');
    expect(serializedRequests).not.toContain("update_text_style");
    expect(inspect).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenNthCalledWith(1, 400);
    expect(wait).toHaveBeenNthCalledWith(2, 400);
  });

  it("resumes an exact JD-only write without creating the JD twice", async () => {
    const values = successfulSnapshots();
    for (const snapshot of [values.unnumberedJd, values.complete]) {
      snapshot.documentId = "doc-test";
    }
    const inspect = vi.fn()
      .mockResolvedValueOnce(values.unnumberedJd)
      .mockResolvedValueOnce(values.complete);
    const request = vi.fn().mockResolvedValue({});
    const writer = createFeishuOpenApiWriter({
      client: { request },
      inspect,
      wait: vi.fn().mockResolvedValue(undefined)
    });

    const result = await writer.write(draft);

    expect(result).toMatchObject({
      ok: true,
      status: "success",
      mode: "resume-new-company",
      completedStages: ["jd", "summary"]
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]).toMatchObject({
      query: { document_revision_id: values.unnumberedJd.revisionId },
      body: { index: values.plan.summaryTarget.index },
      stage: "summary-write"
    });
    expect(inspect).toHaveBeenCalledTimes(2);
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
      httpStatus: 403,
      logId: "log-summary"
    });
    expect(result.repairHint).toContain("Portfolio");
  });

  it("appends jobs through OpenAPI without page interaction", async () => {
    const current = initialSnapshot();
    current.documentId = "doc-test";
    const companyName = current.jd.companies[0].name;
    current.portfolio.companies[0].name = companyName;
    const appendDraft = { ...draft, companyName, jobs: [{ ...draft.jobs[0], title: "新增岗位" }] };
    const plan = buildFeishuOpenApiPlan(current, appendDraft);
    const afterJd = structuredClone(current);
    afterJd.revisionId += 1;
    afterJd.jd.companies[0].jobs.push({
      title: "新增岗位",
      ordinal: plan.jobs[0].ordinal,
      text: `（${plan.jobs[0].ordinal}）新增岗位｜上海｜社招`,
      blockId: "append-job",
      blockType: 5,
      quoteBlockId: "append-quote",
      index: plan.jdTarget.index
    });
    const complete = structuredClone(afterJd);
    complete.revisionId += 1;
    complete.portfolio.companies[0].jobs.push({
      title: "新增岗位",
      text: "新增岗位｜上海｜社招",
      blockId: "append-summary",
      blockType: 12,
      index: plan.summaryTarget.index
    });
    const inspect = vi.fn()
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(afterJd)
      .mockResolvedValueOnce(complete);
    const writer = createFeishuOpenApiWriter({
      client: { request: vi.fn().mockResolvedValue({}) },
      inspect,
      wait: vi.fn().mockResolvedValue(undefined)
    });

    await expect(writer.write(appendDraft)).resolves.toMatchObject({ ok: true, mode: "append-jobs" });
  });

  it("stops before summary when JD semantic verification fails", async () => {
    const values = successfulSnapshots();
    values.unnumberedJd = structuredClone(values.initial);
    values.unnumberedJd.documentId = "doc-test";
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
    values.unnumberedJd = structuredClone(values.initial);
    values.unnumberedJd.documentId = "doc-test";
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
    const writer = createFeishuOpenApiWriter({
      client: { request },
      inspect,
      wait: vi.fn()
    });

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
    const writer = createFeishuOpenApiWriter({
      client: { request },
      inspect,
      wait: vi.fn()
    });

    const result = await writer.write(draft);

    expect(result).toMatchObject({ ok: false, status: "unknown", failedStage: "jd-verify" });
    expect(result.repairHint).toContain("不要重复提交");
    expect(request).toHaveBeenCalledTimes(1);
    expect(inspect).toHaveBeenCalledTimes(2);
  });
});
