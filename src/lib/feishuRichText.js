export function renderPortfolioFragment(draft, plan) {
  const jobLines = draft.jobs.map(formatJobTitle);
  const companyHtml = draft.website
    ? `<a href="${escapeHtml(draft.website)}">${escapeHtml(draft.companyName)}</a>`
    : escapeHtml(draft.companyName);
  const jobsHtml = `<ul>${jobLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`;

  return {
    html: plan.mode === "new-company" ? `<p>${companyHtml}</p>${jobsHtml}` : jobsHtml,
    text: plan.mode === "new-company"
      ? [draft.companyName, ...jobLines.map((line) => `- ${line}`)].join("\n")
      : jobLines.map((line) => `- ${line}`).join("\n")
  };
}

export function renderJdFragment(draft, plan) {
  const intro = draft.companyIntro.length ? draft.companyIntro : ["待补充"];
  const jobHtml = draft.jobs.map((job, index) => renderJobHtml(job, plan.jobs[index].ordinal)).join("");
  const jobText = draft.jobs.map((job, index) => renderJobText(job, plan.jobs[index].ordinal)).join("\n");
  const companyBodyHtml = [
    `<h3>公司介绍</h3><ul>${intro.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`,
    "<h3>开放岗位</h3>",
    jobHtml
  ].join("");
  const companyBodyText = [
    "公司介绍",
    ...intro.map((line) => `- ${line}`),
    "开放岗位",
    jobText
  ].join("\n");

  if (plan.mode === "append-jobs") return { html: jobHtml, text: jobText };
  return {
    html: `<ol><li><h2>${escapeHtml(draft.companyName)}</h2>${companyBodyHtml}</li></ol>`,
    text: `${draft.companyName}\n${companyBodyText}`
  };
}

function renderJobHtml(job, ordinal) {
  const sections = [
    renderSectionHtml("工作内容：", job.responsibilities),
    renderSectionHtml("职位要求：", job.requirements),
    job.bonuses.length ? renderSectionHtml("加分项：", job.bonuses) : ""
  ].join("");
  return `<h3>（${ordinal}）${escapeHtml(formatJobTitle(job))}</h3>${sections}`;
}

function renderSectionHtml(label, lines) {
  return `<h3>${label}</h3><ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`;
}

function renderJobText(job, ordinal) {
  const sections = [
    renderSectionText("工作内容：", job.responsibilities),
    renderSectionText("职位要求：", job.requirements),
    job.bonuses.length ? renderSectionText("加分项：", job.bonuses) : ""
  ].filter(Boolean);
  return [`（${ordinal}）${formatJobTitle(job)}`, ...sections].join("\n");
}

function renderSectionText(label, lines) {
  return [label, ...lines.map((line) => `- ${line}`)].join("\n");
}

function formatJobTitle(job) {
  return `${job.title}｜${job.location}｜${job.employment}`;
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
