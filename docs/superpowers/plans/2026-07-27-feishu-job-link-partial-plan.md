# Feishu Job-Link Partial-Safe Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow uniquely matched, unlinked Portfolio jobs to be repaired even when unrelated historical companies or jobs require manual review.

**Architecture:** `buildJobLinkRepairPlan` will separate blocking `errors` from non-blocking per-item `issues`, while retaining internal block IDs needed for post-write proof. The background boundary will expose only sanitized issue text and counts. The side panel will present a three-step workflow, safe company selection, and a collapsed manual-review list.

**Tech Stack:** JavaScript ES modules, React 19, Chrome Manifest V3, Vitest, Vite.

## Global Constraints

- Never fuzzy-match companies or jobs and never reorder or infer job fields.
- Never overwrite an existing unknown, external, or mixed link.
- Company matching remains normalized unique exact matching.
- Job matching remains normalized unique exact matching on title, location, and recruitment type.
- Only system-level failures belong in `errors`; item-level historical inconsistencies belong in `issues`.
- Write requests must remain revision-locked and selected-company scoped.
- Post-write verification must prove every selected block is now recognized as correctly linked.
- Boss, Maimai, Outlook, Feishu new-company, and Feishu append-job behavior must remain unchanged.

---

### Task 1: Split blocking errors from manual-review issues

**Files:**
- Modify: `src/lib/feishuJobLinks.js`
- Test: `tests/feishuJobLinks.test.js`

**Interfaces:**
- Consumes: `buildJobLinkRepairPlan(snapshot)`
- Produces: `{ ok, baseRevisionId, totalJobs, correctLinks, correctBlockIds, updates, issues, errors }`

- [ ] **Step 1: Write failing mixed-result tests**

Add tests that create one unsafe existing link and one valid missing link:

```js
it("keeps safe updates executable while reporting unrelated manual issues", () => {
  const snapshot = initialSnapshot();
  snapshot.portfolio.companies[0].jobs[0].elements[0].text_run.text_element_style = {
    link: { url: "https://example.com/legacy" }
  };

  const plan = buildJobLinkRepairPlan(snapshot);

  expect(plan).toMatchObject({
    ok: true,
    totalJobs: 2,
    correctLinks: 0,
    errors: []
  });
  expect(plan.updates.map((item) => item.blockId)).toEqual(["summary-job-b1"]);
  expect(plan.issues).toHaveLength(1);
  expect(plan.issues[0].message).toContain("已有链接");
  expect(plan.issues[0].blockId).toBe("summary-job-a1");
});
```

Add a zero-safe-update case and retain a batch-limit blocking case:

```js
expect(plan.ok).toBe(true);
expect(plan.updates).toEqual([]);
expect(plan.issues.length).toBeGreaterThan(0);
expect(plan.errors).toEqual([]);
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npx vitest run tests/feishuJobLinks.test.js
```

Expected: the mixed-result assertions fail because item problems are still stored in `errors` and `ok` is false.

- [ ] **Step 3: Implement the partial-safe plan model**

In `buildJobLinkRepairPlan`, create `issues` and `correctBlockIds`. Replace each per-company or per-job `errors.push(message)` with:

```js
issues.push({
  companyName,
  jobText: safeJobText(portfolioJob),
  blockId: String(portfolioJob.blockId ?? ""),
  message
});
```

Keep invalid revision and batch-limit failures in `errors`. When a canonical or accepted selection link is found:

```js
correctLinks += 1;
correctBlockIds.push(String(portfolioJob.blockId ?? ""));
```

Return:

```js
return {
  ok: errors.length === 0,
  baseRevisionId: revisionId,
  totalJobs,
  correctLinks,
  correctBlockIds,
  updates,
  issues,
  errors
};
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run tests/feishuJobLinks.test.js
```

Expected: all job-link plan tests pass, including the existing 200-update safety limit.

- [ ] **Step 5: Commit**

```bash
git add src/lib/feishuJobLinks.js tests/feishuJobLinks.test.js
git commit -m "feat: plan safe job links around manual issues"
```

---

### Task 2: Preserve safety through the background boundary and write verification

**Files:**
- Modify: `src/background/feishuMessages.js`
- Modify: `src/background/feishuJobLinkRepairer.js`
- Test: `tests/feishuBackgroundMessages.test.js`
- Test: `tests/feishuJobLinkRepairer.test.js`

**Interfaces:**
- Consumes: Task 1 plan with internal `issues[].blockId` and `correctBlockIds`
- Produces public plan `{ ok, baseRevisionId, totalJobs, correctLinks, updateCount, manualIssueCount, updates, issues, errors }`

- [ ] **Step 1: Write failing serialization and writer tests**

Assert the public message preserves sanitized issue text but omits block IDs:

```js
expect(planned.plan).toMatchObject({
  ok: true,
  updateCount: 1,
  manualIssueCount: 1,
  issues: ["公司“示例公司甲”的岗位需要人工检查。"]
});
expect(JSON.stringify(planned.plan)).not.toContain("private-block-id");
```

Add a writer scenario where one selected safe update succeeds while an unrelated issue remains after read-back:

```js
expect(result).toMatchObject({
  ok: true,
  status: "success",
  updatedLinks: 1
});
expect(request.mock.calls[0][1].body.requests).toHaveLength(1);
```

Add a verification failure where the selected block disappears from `updates` by becoming an issue instead of appearing in `correctBlockIds`.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npx vitest run tests/feishuBackgroundMessages.test.js tests/feishuJobLinkRepairer.test.js
```

Expected: public issues are absent, and partial-plan verification either rejects harmless issues or can falsely accept an unresolved selected block.

- [ ] **Step 3: Serialize only safe public issue data**

Extend `publicJobLinkPlan`:

```js
manualIssueCount: Array.isArray(plan.issues) ? plan.issues.length : 0,
issues: (plan.issues ?? []).map((issue) => String(issue.message ?? issue)),
```

Do not serialize `blockId`, `elements`, `linkUrl`, or `correctBlockIds`.

- [ ] **Step 4: Verify selected blocks explicitly after writing**

Replace the “no remaining updates” proof with:

```js
const correctBlockIds = new Set(verification.correctBlockIds ?? []);
const selectedVerified = selection.updates.every((update) =>
  correctBlockIds.has(update.blockId)
);
```

Fail verification when `selectedVerified` is false, when total job count changes, or when the rebuilt plan has blocking errors. Do not fail merely because `verification.issues` contains unrelated historical items.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run tests/feishuBackgroundMessages.test.js tests/feishuJobLinkRepairer.test.js
```

Expected: all message and write tests pass; only selected safe blocks are patched and proven linked.

- [ ] **Step 6: Commit**

```bash
git add src/background/feishuMessages.js src/background/feishuJobLinkRepairer.js \
  tests/feishuBackgroundMessages.test.js tests/feishuJobLinkRepairer.test.js
git commit -m "feat: verify partial job-link repairs safely"
```

---

### Task 3: Make the three-step side-panel workflow explicit

**Files:**
- Modify: `src/sidepanel/feishuUi.js`
- Modify: `src/sidepanel/App.jsx`
- Modify: `src/sidepanel/styles.css`
- Test: `tests/feishuUi.test.js`

**Interfaces:**
- Consumes public plan from Task 2
- Produces `describeJobLinkPlan(plan)` with safe-update, correct-link, and manual-review summaries

- [ ] **Step 1: Write failing UI-state tests**

Add assertions for a mixed plan:

```js
expect(describeJobLinkPlan({
  ok: true,
  totalJobs: 20,
  correctLinks: 8,
  updateCount: 7,
  manualIssueCount: 5,
  issues: ["人工项 A"],
  updates: []
})).toMatchObject({
  title: "可安全补全 7 个岗位链接",
  manualIssueCount: 5,
  issues: ["人工项 A"]
});
```

Add a zero-update/manual-issue plan and a true all-correct plan. The former must not say “全部岗位链接已正确”.

- [ ] **Step 2: Run the UI tests and verify RED**

Run:

```bash
npx vitest run tests/feishuUi.test.js
```

Expected: current copy treats zero updates as fully correct and has no manual issue fields.

- [ ] **Step 3: Implement result descriptions**

Return:

```js
{
  title,
  detail,
  updates,
  issues: [...(plan.issues ?? [])],
  manualIssueCount: plan.manualIssueCount ?? 0
}
```

Use these title rules:

- `updateCount > 0`: `可安全补全 N 个岗位链接`
- `updateCount === 0 && manualIssueCount > 0`: `没有可安全自动补全的岗位`
- both zero: `全部岗位链接已正确`

- [ ] **Step 4: Render the guided workflow**

Inside `FeishuAccessPanel`, render:

```jsx
<ol className="linkSteps">
  <li>点击“检查岗位链接”（只读）</li>
  <li>勾选“可安全补全”中的公司</li>
  <li>确认补全已选岗位链接</li>
</ol>
```

Keep company checkboxes under “可安全补全”。Render manual issues in:

```jsx
<details className="manualIssues">
  <summary>需人工检查 {linkDescription.manualIssueCount} 项</summary>
  <ul>{linkDescription.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
</details>
```

The confirmation button remains disabled until at least one company is selected. Manual issues never receive a write action.

- [ ] **Step 5: Add scoped styles**

Add compact styles for `.linkSteps` and `.manualIssues` without changing shared Boss, Maimai, or Outlook selectors.

- [ ] **Step 6: Run focused tests and build**

Run:

```bash
npx vitest run tests/feishuUi.test.js
VITE_FEISHU_AUTH_MODE=native npm run build
```

Expected: tests and build pass; built UI contains “需人工检查” and “可安全补全”.

- [ ] **Step 7: Commit**

```bash
git add src/sidepanel/feishuUi.js src/sidepanel/App.jsx src/sidepanel/styles.css tests/feishuUi.test.js
git commit -m "feat: guide partial job-link maintenance"
```

---

### Task 4: Regression, documentation, release, and local installation

**Files:**
- Modify: `README.md`
- Modify: `public/manifest.json`
- Modify: `tests/manifest.test.js`
- Modify: `tests/feishuProductionCopy.test.js`
- Modify after release: `distribution/release-channel.json`
- Modify after release: `tests/releaseChannel.test.js`
- Modify after release: `tests/codexInstaller.test.js`

**Interfaces:**
- Consumes the completed partial-safe implementation
- Produces a verified release package and updated local Edge-loaded `dist`

- [ ] **Step 1: Document the partial-safe workflow**

Update the historical link section to state that safe updates proceed while manual issues remain unchanged. Document the three UI steps and explicitly state that the plugin never fuzzy-matches or overwrites unknown links.

- [ ] **Step 2: Bump the extension patch version**

Set the next unused patch version in `public/manifest.json` and update its exact assertions in `tests/manifest.test.js` and `tests/feishuProductionCopy.test.js`.

- [ ] **Step 3: Run final verification**

Run:

```bash
npm test
VITE_FEISHU_AUTH_MODE=native npm run build
```

Expected: zero failures; the build verifier confirms the public Feishu App ID, native messaging, Outlook content script, Feishu job-link messages, and absence of the retired test document.

- [ ] **Step 4: Verify built copy**

Check built JavaScript contains:

```text
可安全补全
需人工检查
Outlook 提醒
正式招聘文档
```

and does not contain:

```text
飞书测试副本
LlhrwSLIvilANZk1opwcQGlUnNv
```

- [ ] **Step 5: Commit and publish through the existing GitHub release workflow**

Commit documentation and version changes, push the feature branch, create and merge a PR to `main`, tag the merge commit, and run `.github/workflows/release-colleague-package.yml`.

- [ ] **Step 6: Pin the verified release channel**

Use the release asset URL, SHA-256 digest, extension version, and tagged build commit returned by GitHub. Update the channel tests, run:

```bash
npx vitest run tests/releaseChannel.test.js tests/codexInstaller.test.js tests/distribution.test.js
```

Commit, push, and merge the channel update.

- [ ] **Step 7: Install locally without replacing the Keychain secret**

Run:

```bash
bash scripts/install-from-github.sh --browser edge
```

Back up the current root `dist`, copy the verified stable `Extension` directory to the root `dist`, and confirm version, fixed extension ID, public App ID, native messaging, Outlook, production target, and partial-safe job-link copy.

