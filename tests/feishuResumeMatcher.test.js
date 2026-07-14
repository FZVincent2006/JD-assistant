import { describe, expect, it } from "vitest";
import { matchResumeCompany } from "../src/lib/feishuResumeMatcher.js";
import { draft, successfulSnapshots } from "./helpers/feishuWriteScenario.js";

function company() {
  return structuredClone(successfulSnapshots().unnumberedJd.jd.companies[0]);
}

describe("Feishu JD-only recovery matching", () => {
  it("accepts an exact semantic match with width and whitespace normalization", () => {
    const current = company();
    current.introTexts[0] = " 公司介绍。 ";
    current.jobs[0].location = "Ｓｈａｎｇｈａｉ";
    const normalizedDraft = structuredClone(draft);
    normalizedDraft.jobs[0].location = "Shanghai";

    expect(matchResumeCompany(current, normalizedDraft)).toEqual({ ok: true, errors: [] });
  });

  it.each([
    ["公司介绍", (current) => { current.introTexts[0] = "不同介绍"; }],
    ["岗位数量", (current) => { current.jobs.pop(); }],
    ["工作内容", (current) => { current.jobs[0].responsibilities[0] = "不同职责"; }],
    ["职位要求", (current) => { current.jobs[0].requirements.push("额外要求"); }],
    ["加分项", (current) => { current.jobs[0].bonuses.push("额外加分项"); }]
  ])("rejects a semantic mismatch in %s", (label, mutate) => {
    const current = company();
    mutate(current);

    const result = matchResumeCompany(current, draft);

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain(label);
  });
});
