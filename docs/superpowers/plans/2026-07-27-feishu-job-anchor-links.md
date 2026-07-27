# Feishu Portfolio Job Anchor Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically link every Portfolio job bullet to its matching JD job heading and safely backfill missing or incorrect links in the fixed production document.

**Architecture:** A pure matching module derives canonical block-anchor URLs and immutable update plans from inspected Feishu block snapshots. The existing phased writer resolves real JD block IDs only after JD read-back, then renders and verifies linked Portfolio bullets; a separate background repair service previews and batch-patches historical bullets with revision gating and read-back verification.

**Tech Stack:** JavaScript ES modules, React side panel, Chrome Manifest V3 service worker, Feishu Docx OpenAPI, Vitest, Vite.

## Global Constraints

- Only operate on `https://zhenfund.feishu.cn/wiki/RTWjwVZjri4uCUk0J8wcn2K3n6d`.
- Do not add clipboard, debugger, Feishu page host, content-script, or macOS Accessibility permissions.
- Preserve Boss, Maimai, single-job parsing, company website links, and the current Feishu template.
- Match jobs by normalized company name, title, location, and employment; never guess ambiguous matches.
- Preview every historical repair before mutation and reject stale document revisions.
- Update historical bullets in place; never delete and recreate them.
- Do not expose document IDs, block IDs, raw rich-text elements, anchor URLs, tokens, or secrets to the side panel.
- Treat API success as incomplete until a semantic read-back passes.

---

### Task 1: Inspect Portfolio rich text and derive job anchors

**Files:**
- Create: `src/lib/feishuJobLinks.js`
- Modify: `src/lib/feishuTemplateReader.js`
- Test: `tests/feishuJobLinks.test.js`
- Test: `tests/feishuTemplateReader.test.js`

**Interfaces:**
- Produces: `buildJobAnchorUrl(blockId) -> string`
- Produces: `resolvePlannedJobLinks(snapshot, plan) -> {ok, jobs, errors}`
- Produces: `buildJobLinkRepairPlan(snapshot) -> repairPlan`
- Snapshot Portfolio jobs add `location`, `employment`, `elements`, and `linkUrl`.

- [ ] **Step 1: Write failing inspection and matching tests**

Add literal fixture tests proving that a Portfolio bullet exposes its location/employment and detects a single consistent link. Add pure matching tests for:

```js
expect(buildJobAnchorUrl("jd-company-a-job-1")).toBe(
  `${PRODUCTION_FEISHU_DOC_URL}#jd-company-a-job-1`
);
expect(resolvePlannedJobLinks(snapshot, plan).jobs[0].linkUrl).toBe(
  `${PRODUCTION_FEISHU_DOC_URL}#new-job-1`
);
```

Also cover missing company, duplicate JD job, full-width separators, a correct existing link, a wrong link, and a non-text rich element.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npx vitest run tests/feishuJobLinks.test.js tests/feishuTemplateReader.test.js
```

Expected: failure because `feishuJobLinks.js` and the new snapshot fields do not exist.

- [ ] **Step 3: Implement snapshot extraction and pure plans**

Implement:

```js
export function buildJobAnchorUrl(blockId) {
  const id = String(blockId ?? "").trim();
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid Feishu job block ID");
  return `${PRODUCTION_FEISHU_DOC_URL}#${id}`;
}
```

Parse Portfolio text into exactly three normalized fields. Deep-clone raw text elements, derive one consistent full-line link, and fail repair planning if any text-bearing element is not a `text_run`.

`buildJobLinkRepairPlan` must return:

```js
{
  ok,
  baseRevisionId,
  totalJobs,
  correctLinks,
  updates: [{ companyName, jobText, blockId, linkUrl, elements }],
  errors
}
```

Each update's `elements` must preserve content/style and set the same anchor link on every text run. Reject more than 200 updates.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same focused Vitest command. Expected: all tests pass.

- [ ] **Step 5: Commit the pure link model**

```bash
git add src/lib/feishuJobLinks.js src/lib/feishuTemplateReader.js tests/feishuJobLinks.test.js tests/feishuTemplateReader.test.js
git commit -m "feat: derive Feishu job anchor links"
```

### Task 2: Link all newly created Portfolio jobs

**Files:**
- Modify: `src/lib/feishuBlockRenderer.js`
- Modify: `src/lib/feishuWriteVerifier.js`
- Modify: `src/background/feishuOpenApiWriter.js`
- Modify: `tests/helpers/feishuWriteScenario.js`
- Test: `tests/feishuBlockRenderer.test.js`
- Test: `tests/feishuWriteVerifier.test.js`
- Test: `tests/feishuOpenApiWriter.test.js`

**Interfaces:**
- Consumes: `resolvePlannedJobLinks(snapshot, plan)`.
- `renderSummaryDescendants` consumes resolved plan jobs containing `linkUrl`.
- `verifySummaryWrite` requires persisted Portfolio `linkUrl` equality.

- [ ] **Step 1: Write failing renderer, verifier, and orchestration tests**

Assert that:

```js
const run = summaryJob.bullet.elements[0].text_run;
expect(run.text_element_style.link.url).toBe(
  `${PRODUCTION_FEISHU_DOC_URL}#new-job-1`
);
```

Mutation cases removing or changing the persisted Portfolio link must fail summary verification. Writer tests must prove the second request is rendered after the JD read-back and contains the read-back job block IDs for new-company, append-jobs, and resume-new-company.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npx vitest run tests/feishuBlockRenderer.test.js tests/feishuWriteVerifier.test.js tests/feishuOpenApiWriter.test.js
```

Expected: links are absent and the verifier accepts missing links.

- [ ] **Step 3: Implement linked rendering after JD read-back**

Move summary rendering out of preflight. After `verifyJdWrite(afterJd, plan)` succeeds:

```js
const resolved = resolvePlannedJobLinks(afterJd, plan);
if (!resolved.ok) return failed jd-verify result;
const linkedPlan = { ...plan, jobs: resolved.jobs };
const summaryRequest = renderSummaryDescendants(
  draft,
  linkedPlan,
  afterJd.templates.portfolio
);
```

Pass `job.linkUrl` to `textBlock` for every summary job. Verify the persisted link as part of `verifySummaryWrite`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the focused Vitest command. Expected: all pass.

- [ ] **Step 5: Commit automatic links**

```bash
git add src/lib/feishuBlockRenderer.js src/lib/feishuWriteVerifier.js src/background/feishuOpenApiWriter.js tests/helpers/feishuWriteScenario.js tests/feishuBlockRenderer.test.js tests/feishuWriteVerifier.test.js tests/feishuOpenApiWriter.test.js
git commit -m "feat: link new Portfolio jobs to JD headings"
```

### Task 3: Add revision-safe historical link repair

**Files:**
- Create: `src/background/feishuJobLinkRepairer.js`
- Modify: `src/background/feishuMessages.js`
- Test: `tests/feishuJobLinkRepairer.test.js`
- Test: `tests/feishuBackgroundMessages.test.js`

**Interfaces:**
- Produces: `createFeishuJobLinkRepairer({client, inspect, wait})`.
- Background messages: `FEISHU_JOB_LINK_PLAN`, `FEISHU_JOB_LINK_WRITE`.
- Write payload: `{baseRevisionId: integer}`.

- [ ] **Step 1: Write failing repair service tests**

Cover:

- plan is read-only;
- stale revision rejects before PATCH;
- zero updates succeeds without PATCH;
- updates use one `PATCH /blocks/batch_update` request with the current revision;
- explicit API rejection is not retried;
- ambiguous network result is accepted only when one read-back proves every link;
- accepted update plus unreadable read-back returns `unknown`;
- failed read-back verification returns `failed`;
- public plan and result contain no block IDs, links, raw elements, or document ID.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npx vitest run tests/feishuJobLinkRepairer.test.js tests/feishuBackgroundMessages.test.js
```

Expected: missing repairer and unsupported message types.

- [ ] **Step 3: Implement plan and batch update service**

Use:

```js
client.request(
  `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/batch_update`,
  {
    method: "PATCH",
    query: { document_revision_id: plan.baseRevisionId },
    body: {
      requests: plan.updates.map(({ blockId, elements }) => ({
        block_id: blockId,
        update_text_elements: { elements }
      }))
    },
    stage: "job-link-write"
  }
);
```

Re-inspect once and require a valid repair plan with `updates.length === 0`.
Return safe `success`, `failed`, or `unknown` results with counts and whitelisted diagnostics.

- [ ] **Step 4: Register safe messages**

Expose only:

```js
{
  ok,
  plan: {
    ok, baseRevisionId, totalJobs, correctLinks, updateCount,
    updates: [{companyName, jobText}], errors
  }
}
```

Never expose internal IDs, URLs, or elements.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the same focused Vitest command. Expected: all pass.

- [ ] **Step 6: Commit historical repair**

```bash
git add src/background/feishuJobLinkRepairer.js src/background/feishuMessages.js tests/feishuJobLinkRepairer.test.js tests/feishuBackgroundMessages.test.js
git commit -m "feat: repair historical Portfolio job links"
```

### Task 4: Add a low-clutter maintenance UI

**Files:**
- Modify: `src/sidepanel/App.jsx`
- Modify: `src/sidepanel/feishuUi.js`
- Modify: `src/sidepanel/styles.css`
- Modify: `src/sidepanel/fillPage.js`
- Test: `tests/feishuUi.test.js`
- Test: `tests/feishuProductionCopy.test.js`

**Interfaces:**
- Sends `FEISHU_JOB_LINK_PLAN`.
- Sends `FEISHU_JOB_LINK_WRITE` with `{baseRevisionId}`.
- Produces helpers `canRepairJobLinks`, `describeJobLinkPlan`, and `formatJobLinkRepairStatus`.

- [ ] **Step 1: Write failing UI behavior tests**

Assert that a valid non-empty current plan enables repair, a stale/empty/error plan does not, and status copy distinguishes success, explicit failure, and unknown state. Assert the side-panel source includes a collapsed `维护已有岗位链接` section and does not add a normal-flow mandatory step.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npx vitest run tests/feishuUi.test.js tests/feishuProductionCopy.test.js
```

Expected: missing UI helpers and maintenance copy.

- [ ] **Step 3: Implement maintenance state and controls**

Add a collapsed `<details>` inside the authorized Feishu access panel:

- `检查岗位链接`;
- a concise count card;
- a list of company/job labels scheduled for update;
- `确认补全 N 个岗位链接`.

Before write, show:

```js
window.confirm(
  `将原位更新正式招聘文档中的 ${updateCount} 个 Portfolio 岗位链接，不修改岗位 JD。确认继续？`
)
```

Clear the preview after success; preserve the result copy for the user.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same focused Vitest command. Expected: all pass.

- [ ] **Step 5: Commit the maintenance UI**

```bash
git add src/sidepanel/App.jsx src/sidepanel/feishuUi.js src/sidepanel/styles.css src/sidepanel/fillPage.js tests/feishuUi.test.js tests/feishuProductionCopy.test.js
git commit -m "feat: add Portfolio link maintenance UI"
```

### Task 5: Document, regress, build, and package

**Files:**
- Modify: `README.md`
- Modify: `docs/testing/2026-07-13-feishu-openapi-acceptance.md`
- Modify: `tests/feishuDocumentation.test.js`
- Modify: generated `dist/**`
- Modify: distribution/release artifacts only through existing project scripts

**Interfaces:**
- No new runtime interface.

- [ ] **Step 1: Write the failing documentation behavior test**

Extend the documentation test to require user-facing guidance for automatic new-job links, the collapsed historical repair workflow, revision conflict behavior, and no new browser/macOS permissions.

- [ ] **Step 2: Run the documentation test and verify RED**

```bash
npx vitest run tests/feishuDocumentation.test.js
```

Expected: README lacks the new workflow.

- [ ] **Step 3: Update documentation and acceptance checklist**

Document normal automatic links, historical repair preview/confirmation, strict ambiguity handling, rerun idempotency, and the manual formal-document acceptance steps from the design spec.

- [ ] **Step 4: Run full regression**

```bash
npm test
```

Expected: every test passes, including `verify:legacy` and all Boss/Maimai form-filler tests.

- [ ] **Step 5: Build and verify the extension**

```bash
npm run build
```

Expected: Vite and `verify-extension-build.mjs` succeed; `dist` contains the updated side panel and background worker.

- [ ] **Step 6: Run a legacy integrity diff**

```bash
npm run verify:legacy
git diff -- src/lib/jdParser.js src/content/formFiller.js tests/jdParser.test.js tests/formFiller.test.js
```

Expected: integrity passes and no unrelated Boss/Maimai changes appear.

- [ ] **Step 7: Commit docs and generated artifacts**

```bash
git add README.md docs/testing/2026-07-13-feishu-openapi-acceptance.md tests/feishuDocumentation.test.js dist
git commit -m "docs: document Feishu job link maintenance"
```

- [ ] **Step 8: Perform final completion audit**

Confirm each design acceptance item has direct test/build evidence. Inspect `git status --short`, `git log --oneline -5`, and the final diff for secrets, test-copy URLs, leaked block IDs, or unrelated changes.
