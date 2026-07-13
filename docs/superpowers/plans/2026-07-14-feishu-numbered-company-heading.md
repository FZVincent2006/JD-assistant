# Feishu Numbered Company Heading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every newly inserted JD company a root Heading 1 with Feishu-managed automatic numbering while leaving append mode, Portfolio, Boss, and Maimai unchanged.

**Architecture:** Keep the company block as Heading 1 and set its Docx `TextStyle.sequence` to `"auto"` at render time. Expose the persisted heading sequence through the existing structural snapshot so the write verifier can reject a write that lost automatic numbering.

**Tech Stack:** JavaScript ES modules, Vitest, Vite, Chrome/Edge Manifest V3, Feishu Docx OpenAPI.

## Global Constraints

- Company number text must never be added to `draft.companyName`.
- Only a new JD company Heading 1 receives `style.sequence: "auto"`.
- Append mode must not create or modify a company heading.
- Portfolio, Boss, Maimai, and existing single-job behavior must remain unchanged.
- Sync to `/Users/vincwnt/Documents/Auto ZhenFund/飞书OpenAPI测试扩展` only after tests, build, and legacy integrity checks pass.

---

### Task 1: Render new-company Heading 1 with automatic numbering

**Files:**
- Modify: `tests/feishuBlockRenderer.test.js`
- Modify: `src/lib/feishuBlockRenderer.js`

**Interfaces:**
- Consumes: `renderJdDescendants(draft, plan, templates)`.
- Produces: the existing descendant request whose `jd-company-heading.heading1.style.sequence` is exactly `"auto"` in `new-company` mode.

- [ ] **Step 1: Write the failing renderer test**

Add these assertions to the new-company rendering test after `byId` is created:

```js
const companyHeading = byId.get("jd-company-heading");
expect(companyHeading.heading1.style.sequence).toBe("auto");
expect(blockText(companyHeading)).toBe(draft.companyName);
expect(blockText(companyHeading)).not.toMatch(/^\s*1[.、]/);
```

The existing append-mode test remains the regression assertion that no Heading 1 is emitted.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run tests/feishuBlockRenderer.test.js
```

Expected: FAIL because the fixture-derived style contains only `align` and `sequence` is `undefined`.

- [ ] **Step 3: Add the minimal renderer behavior**

Add an optional style override to `textBlock` and use it only for the JD company heading:

```js
addRoot(childrenId, descendants, textBlock(
  "jd-company-heading",
  templates.companyHeading,
  draft.companyName,
  draft.website,
  { sequence: "auto" }
));

function textBlock(id, template, content, link, styleOverrides = {}) {
  const field = fieldForBlockType(template.block_type);
  const property = template[field] ?? {};
  const elementStyle = property.elements?.find((element) => element?.text_run)?.text_run?.text_element_style ?? {};
  return {
    block_id: id,
    block_type: template.block_type,
    [field]: {
      style: {
        ...structuredClone(property.style ?? {}),
        ...structuredClone(styleOverrides)
      },
      elements: [makeTextRun(content, elementStyle, link)]
    },
    children: []
  };
}
```

- [ ] **Step 4: Run the focused renderer tests and verify GREEN**

Run:

```bash
npx vitest run tests/feishuBlockRenderer.test.js
```

Expected: all tests in `feishuBlockRenderer.test.js` pass.

- [ ] **Step 5: Commit the renderer change**

```bash
git add src/lib/feishuBlockRenderer.js tests/feishuBlockRenderer.test.js
git commit -m "fix: auto-number new JD company headings"
```

### Task 2: Read and verify the persisted automatic-numbering style

**Files:**
- Modify: `tests/feishuTemplateReader.test.js`
- Modify: `tests/feishuWriteVerifier.test.js`
- Modify: `tests/fixtures/feishu-structural-sample.json`
- Modify: `tests/helpers/feishuWriteScenario.js`
- Modify: `src/lib/feishuTemplateReader.js`
- Modify: `src/lib/feishuWriteVerifier.js`

**Interfaces:**
- Produces: every JD company snapshot includes `headingSequence`, copied from `companyHeading.heading1.style.sequence`.
- Consumes: `verifyJdWrite(snapshot, plan)` and requires `headingSequence === "auto"` only for `plan.mode === "new-company"`.

- [ ] **Step 1: Write failing reader and verifier tests**

Update the two fixture company headings to model the real document:

```json
"style": { "align": 1, "sequence": "auto" }
```

Assert the reader exposes the style:

```js
expect(result.jd.companies.map((company) => company.headingSequence)).toEqual(["auto", "auto"]);
```

Add a verifier regression test:

```js
it("requires Feishu automatic numbering on a newly inserted company Heading 1", () => {
  const { plan, jd } = successfulSnapshots();
  jd.jd.companies[0].headingSequence = "1";

  const result = verifyJdWrite(jd, plan);

  expect(result.ok).toBe(false);
  expect(result.errors.join(" ")).toContain("自动编号");
});
```

Set the successful new-company helper snapshot to:

```js
headingSequence: "auto",
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npx vitest run tests/feishuTemplateReader.test.js tests/feishuWriteVerifier.test.js
```

Expected: FAIL because company snapshots do not expose `headingSequence`, and the verifier does not reject a fixed sequence.

- [ ] **Step 3: Expose and verify the sequence**

Add the sequence to the company snapshot in `inspectJdCompany`:

```js
headingSequence: companyHeading.heading1?.style?.sequence,
```

Add the new-company verification immediately after the root Heading 1 check:

```js
if (plan.mode === "new-company" && company.headingSequence !== "auto") {
  errors.push(`公司“${plan.companyName}”的 Heading 1 未启用飞书自动编号。`);
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run tests/feishuTemplateReader.test.js tests/feishuWriteVerifier.test.js
```

Expected: both test files pass, including append mode without requiring a newly created heading.

- [ ] **Step 5: Run complete verification**

Run:

```bash
npm test
npm run build
git diff --check
```

Expected: legacy integrity passes, all Vitest tests pass, production build succeeds, and `git diff --check` prints no errors.

- [ ] **Step 6: Commit verification and fixture changes**

```bash
git add src/lib/feishuTemplateReader.js src/lib/feishuWriteVerifier.js tests/feishuTemplateReader.test.js tests/feishuWriteVerifier.test.js tests/fixtures/feishu-structural-sample.json tests/helpers/feishuWriteScenario.js
git commit -m "fix: verify numbered JD company headings"
```

### Task 3: Sync the verified build to the test extension

**Files:**
- Replace generated build contents in: `/Users/vincwnt/Documents/Auto ZhenFund/飞书OpenAPI测试扩展`

**Interfaces:**
- Consumes: verified `dist/` output from Task 2.
- Produces: the unpacked Edge/Chrome test extension used by extension ID `nnfieabngjmimnogokgbccekfpdifgdb`.

- [ ] **Step 1: Sync the already verified build**

Run:

```bash
rsync -a --delete dist/ "/Users/vincwnt/Documents/Auto ZhenFund/飞书OpenAPI测试扩展/"
```

This replaces generated files while preserving the destination directory itself, so the unpacked extension path remains stable.

- [ ] **Step 2: Verify the synced files match `dist/`**

Run:

```bash
diff -qr dist "/Users/vincwnt/Documents/Auto ZhenFund/飞书OpenAPI测试扩展"
```

Expected: no output and exit code 0.

- [ ] **Step 3: Record the clean implementation state**

Run:

```bash
git status --short
git log --oneline -4
```

Expected: the worktree is clean and the design, renderer, and verifier commits are visible.
