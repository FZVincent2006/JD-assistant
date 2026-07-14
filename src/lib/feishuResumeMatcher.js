export function matchResumeCompany(company = {}, draft = {}) {
  const errors = [];
  const expectedIntro = draft.companyIntro?.length ? draft.companyIntro : ["待补充"];
  compareArray(company.introTexts, expectedIntro, "公司介绍", errors);

  const actualJobs = company.jobs ?? [];
  const expectedJobs = draft.jobs ?? [];
  if (actualJobs.length !== expectedJobs.length) {
    errors.push("岗位数量不一致");
  }

  for (const [index, expected] of expectedJobs.entries()) {
    const actual = actualJobs[index];
    if (!actual) continue;
    const label = `岗位 ${index + 1}`;
    compareScalar(actual.ordinal, index + 1, `${label} 序号`, errors);
    compareScalar(actual.title, expected.title, `${label} 名称`, errors);
    compareScalar(actual.location, expected.location, `${label} 地点`, errors);
    compareScalar(actual.employment, expected.employment, `${label} 招聘类型`, errors);
    compareArray(actual.responsibilities, expected.responsibilities, `${label} 工作内容`, errors);
    compareArray(actual.requirements, expected.requirements, `${label} 职位要求`, errors);
    compareArray(actual.bonuses, expected.bonuses ?? [], `${label} 加分项`, errors);
  }
  return { ok: errors.length === 0, errors };
}

function compareScalar(actual, expected, label, errors) {
  if (normalizeText(actual) !== normalizeText(expected)) errors.push(`${label}不一致`);
}

function compareArray(actual = [], expected = [], label, errors) {
  const actualValues = Array.isArray(actual) ? actual.map(normalizeText) : [];
  const expectedValues = Array.isArray(expected) ? expected.map(normalizeText) : [];
  if (actualValues.length !== expectedValues.length
    || actualValues.some((value, index) => value !== expectedValues[index])) {
    errors.push(`${label}不一致`);
  }
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}
