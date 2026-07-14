import { describe, expect, it, vi } from "vitest";
import { FeishuApiError } from "../src/background/feishuApiClient.js";
import { createFeishuOpenApiWriter } from "../src/background/feishuOpenApiWriter.js";
import { TEST_FEISHU_DOC_URL } from "../src/lib/feishuConfig.js";
import { buildFeishuOpenApiPlan } from "../src/lib/feishuOpenApiPlan.js";
import { draft, initialSnapshot, successfulSnapshots } from "./helpers/feishuWriteScenario.js";

function writerSetup({ snapshots, request, numberHeading = vi.fn().mockResolvedValue({ ok: true }) } = {}) {
  const values = snapshots ?? successfulSnapshots();
  values.initial.documentId = "doc-test";
  values.unnumberedJd.documentId = "doc-test";
  values.jd.documentId = "doc-test";
  values.complete.documentId = "doc-test";
  const inspect = vi.fn()
    .mockResolvedValueOnce(values.initial)
    .mockResolvedValueOnce(values.unnumberedJd)
    .mockResolvedValueOnce(values.jd)
    .mockResolvedValueOnce(values.complete);
  const client = { request: request ?? vi.fn().mockResolvedValue({}) };
  const wait = vi.fn().mockResolvedValue(undefined);
  return {
    values,
    inspect,
    client,
    numberHeading,
    wait,
    writer: createFeishuOpenApiWriter({ client, inspect, numberHeading, wait })
  };
}

function pageNumberingError(reason) {
  return Object.assign(new Error(`page numbering failed: ${reason}`), {
    stage: "jd-numbering-page",
    reason,
    status: 0,
    code: 0,
    logId: ""
  });
}

describe("Feishu phased OpenAPI writer", () => {
  it("writes JD, numbers its heading on the page, verifies it, then writes the summary", async () => {
    const { writer, client, inspect, numberHeading, wait, values } = writerSetup();

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
    expect(numberHeading).toHaveBeenCalledOnce();
    expect(numberHeading).toHaveBeenCalledWith(draft.companyName);
    expect(client.request.mock.calls[1][1]).toMatchObject({
      query: { document_revision_id: values.jd.revisionId },
      body: { index: values.plan.summaryTarget.index },
      stage: "summary-write"
    });
    const serializedRequests = JSON.stringify(client.request.mock.calls);
    expect(serializedRequests).not.toContain('"PATCH"');
    expect(serializedRequests).not.toContain("update_text_style");
    expect(inspect).toHaveBeenCalledTimes(4);
    expect(wait).toHaveBeenNthCalledWith(1, 400);
    expect(wait).toHaveBeenNthCalledWith(2, 400);
  });

  it.each([
    "wrong-document",
    "heading-missing",
    "heading-duplicate",
    "already-numbered",
    "not-editable"
  ])("classifies deterministic page-numbering failure %s as partial", async (reason) => {
    const numberHeading = vi.fn().mockRejectedValue(pageNumberingError(reason));
    const { writer, client, inspect } = writerSetup({
      numberHeading
    });

    const result = await writer.write(draft);

    expect(result).toMatchObject({
      ok: false,
      status: "partial",
      completedStages: [],
      failedStage: "jd-numbering-page"
    });
    expect(numberHeading).toHaveBeenCalledOnce();
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(inspect).toHaveBeenCalledTimes(2);
  });

  it.each([
    "shortcut-rejected",
    "page-unavailable"
  ])("classifies ambiguous page-numbering failure %s as unknown", async (reason) => {
    const numberHeading = vi.fn().mockRejectedValue(pageNumberingError(reason));
    const { writer, client, inspect } = writerSetup({
      numberHeading
    });

    const result = await writer.write(draft);

    expect(result).toMatchObject({
      ok: false,
      status: "unknown",
      completedStages: [],
      failedStage: "jd-numbering-page"
    });
    expect(result.repairHint).toContain("不要重复提交");
    expect(result.repairHint).toContain("测试副本");
    expect(numberHeading).toHaveBeenCalledOnce();
    expect(client.request).toHaveBeenCalledTimes(1);
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
      logId: "log-summary"
    });
    expect(result.repairHint).toContain("Portfolio");
  });

  it("polls read-only at most five times after one shortcut and stops before Portfolio", async () => {
    const values = successfulSnapshots();
    values.initial.documentId = "doc-test";
    values.unnumberedJd.documentId = "doc-test";
    const stale = Array.from({ length: 5 }, (_, index) => ({
      ...structuredClone(values.unnumberedJd),
      revisionId: values.unnumberedJd.revisionId + index
    }));
    const inspect = vi.fn()
      .mockResolvedValueOnce(values.initial)
      .mockResolvedValueOnce(values.unnumberedJd);
    for (const snapshot of stale) inspect.mockResolvedValueOnce(snapshot);
    const request = vi.fn().mockResolvedValue({});
    const numberHeading = vi.fn().mockResolvedValue({ ok: true });
    const wait = vi.fn().mockResolvedValue(undefined);
    const writer = createFeishuOpenApiWriter({ client: { request }, inspect, numberHeading, wait });

    const result = await writer.write(draft);

    expect(result).toMatchObject({
      ok: false,
      status: "partial",
      completedStages: [],
      failedStage: "jd-numbering-verify"
    });
    expect(numberHeading).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(inspect).toHaveBeenCalledTimes(7);
  });

  it("never invokes page numbering when appending jobs", async () => {
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
    const numberHeading = vi.fn();
    const writer = createFeishuOpenApiWriter({
      client: { request: vi.fn().mockResolvedValue({}) },
      inspect,
      numberHeading,
      wait: vi.fn().mockResolvedValue(undefined)
    });

    await expect(writer.write(appendDraft)).resolves.toMatchObject({ ok: true, mode: "append-jobs" });
    expect(numberHeading).not.toHaveBeenCalled();
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
    expect(inspect).toHaveBeenCalledTimes(4);
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
      numberHeading: vi.fn().mockResolvedValue({ ok: true }),
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
      numberHeading: vi.fn().mockResolvedValue({ ok: true }),
      wait: vi.fn()
    });

    const result = await writer.write(draft);

    expect(result).toMatchObject({ ok: false, status: "unknown", failedStage: "jd-verify" });
    expect(result.repairHint).toContain("不要重复提交");
    expect(request).toHaveBeenCalledTimes(1);
    expect(inspect).toHaveBeenCalledTimes(2);
  });
});
