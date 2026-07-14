# Feishu OpenAPI Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing JD assistant so four macOS Chrome/Edge users can write company and job blocks into the fixed Feishu test document at the correct structural positions, with semantic read-back verification and no regression to Boss/Maimai.

**Architecture:** Keep the existing parser and Boss/Maimai form filler byte-identical. Run Feishu OAuth and OpenAPI calls in the extension service worker, model the document as a block tree, derive styles from an existing complete company, create nested Heading/Callout/QuoteContainer blocks, and verify the persisted block tree after each write phase. Start with secretless PKCE; if the real Feishu v2 token exchange rejects public clients, execute the separate native-helper fallback plan before continuing end-to-end work.

**Tech Stack:** JavaScript ES modules, React 19, Chrome Manifest V3 APIs, Vitest/jsdom, Vite 7, Feishu Wiki v2 and Docx v1 OpenAPI.

## Global Constraints

- All development and end-to-end writes target only `https://zhenfund.feishu.cn/wiki/LlhrwSLIvilANZk1opwcQGlUnNv?fromScene=spaceOverview`.
- The formal document has no write entry until test-copy acceptance passes.
- `src/lib/jdParser.js` and `src/content/formFiller.js` remain byte-identical to commit `635bd38`.
- Boss/Maimai fields, messages, routing, diagnostics, and fill behavior remain unchanged.
- Never put a Feishu App Secret, authorization code, PKCE verifier, access token, refresh token, full JD, or company introduction in logs.
- Do not request `offline_access`; store the short-lived access token only in `chrome.storage.session`.
- Do not use Feishu DOM scanning, synthetic paste, clipboard permissions, or `chrome.debugger`.
- Do not retry write requests or automatically undo them. A possibly-completed timeout gets one read-only semantic verification.
- A write is successful only when a fresh block-tree read proves the expected position, block types, company name, job titles, and counts.
- The native-helper fallback is a separate subsystem described in `docs/superpowers/plans/2026-07-13-feishu-native-auth-helper.md` and is executed only if the Task 2 PKCE probe fails.

---

## File Map

**Create**

- `scripts/verify-legacy-integrity.mjs`: hash gate for protected Boss/Maimai core files.
- `src/lib/feishuPkce.js`: pure PKCE, state, URL, and callback parsing helpers.
- `src/background/feishuAuth.js`: interactive OAuth and session-token storage.
- `src/background/feishuApiClient.js`: authenticated OpenAPI transport and normalized errors.
- `src/background/feishuWikiResolver.js`: fixed Wiki token to Docx document resolution.
- `src/lib/feishuBlockModel.js`: block constants, text extraction, tree indexing, and fixture sanitization.
- `src/lib/feishuTemplateReader.js`: target-section and style-template discovery.
- `src/lib/feishuOpenApiPlan.js`: immutable new-company/append-jobs plan.
- `src/lib/feishuBlockRenderer.js`: nested-block request rendering.
- `src/lib/feishuWriteVerifier.js`: semantic persisted-state verification.
- `src/background/feishuOpenApiWriter.js`: phased JD then summary execution.
- `src/background/feishuMessages.js`: service-worker message orchestration.
- `tests/fixtures/feishu-structural-sample.json`: sanitized structural contract fixture.
- Focused tests matching each module above.

**Modify**

- `package.json`: run the legacy hash gate before tests/build.
- `src/background.js`: register async Feishu service-worker messages.
- `src/lib/feishuConfig.js`: fixed target token, headings, scopes, and public App ID configuration.
- `src/lib/feishuPlan.js`: re-export the OpenAPI planner for compatibility or remove only after imports/tests migrate.
- `src/sidepanel/fillPage.js`: change only Feishu requests from tab messaging to runtime messaging.
- `src/sidepanel/App.jsx`: add auth/inspect/plan/write state to the existing Feishu branch only.
- `src/sidepanel/feishuUi.js`: phase-aware status formatting.
- `src/sidepanel/styles.css`: Feishu-only status and plan styles.
- `public/manifest.json`: identity/storage/API hosts and removal of obsolete Feishu DOM permissions/match.
- `scripts/verify-extension-build.mjs`: verify the final manifest and background bundle.
- `README.md`: setup, permissions, Chrome/Edge installation, and recovery instructions.

**Do not modify**

- `src/lib/jdParser.js`
- `src/content/formFiller.js`
- Existing Boss/Maimai assertions except adding regression cases that call the same public interfaces.

---

### Task 1: Lock the Boss/Maimai Baseline

**Files:**
- Create: `scripts/verify-legacy-integrity.mjs`
- Create: `tests/legacyIntegrity.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `verifyLegacyIntegrity(rootUrl): Promise<void>` and CLI exit code 0/1.
- Protects: exact SHA-256 values recorded in the approved design.

- [ ] **Step 1: Write the failing integrity test**

```js
import { describe, expect, it } from "vitest";
import { verifyLegacyIntegrity } from "../scripts/verify-legacy-integrity.mjs";

describe("legacy integrity", () => {
  it("keeps the Boss/Maimai parser and filler byte-identical", async () => {
    await expect(verifyLegacyIntegrity(new URL("../", import.meta.url))).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `npx vitest run tests/legacyIntegrity.test.js`

Expected: FAIL because `scripts/verify-legacy-integrity.mjs` does not exist.

- [ ] **Step 3: Implement the exact hash gate**

```js
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const LEGACY_HASHES = {
  "src/lib/jdParser.js": "709e2fa1d89f300fa0d9085069827e0d5cbfd85b5d85c90035178b9a5ac32b28",
  "src/content/formFiller.js": "7d5578d8526c6ca1bf01976efa54ee1a92f9b5c94534c6e7c70d142bd1925215"
};

export async function verifyLegacyIntegrity(rootUrl = new URL("../", import.meta.url)) {
  for (const [path, expected] of Object.entries(LEGACY_HASHES)) {
    const content = await readFile(new URL(path, rootUrl));
    const actual = createHash("sha256").update(content).digest("hex");
    if (actual !== expected) throw new Error(`${path} changed: ${actual}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyLegacyIntegrity();
}
```

Update scripts so both gates run automatically:

```json
{
  "scripts": {
    "verify:legacy": "node scripts/verify-legacy-integrity.mjs",
    "test": "npm run verify:legacy && vitest run",
    "build": "npm run verify:legacy && vite build && node scripts/verify-extension-build.mjs"
  }
}
```

- [ ] **Step 4: Verify the gate and all existing behavior**

Run: `npm test && npm run build`

Expected: legacy verification exits 0; all existing 96 tests plus the new integrity test pass; build exits 0.

- [ ] **Step 5: Commit the regression gate**

```bash
git add package.json scripts/verify-legacy-integrity.mjs tests/legacyIntegrity.test.js
git commit -m "test: lock Boss and Maimai legacy behavior"
```

---

### Task 2: Implement and Probe Secretless PKCE

**Files:**
- Create: `src/lib/feishuPkce.js`
- Create: `src/background/feishuAuth.js`
- Create: `tests/feishuPkce.test.js`
- Create: `tests/feishuAuth.test.js`
- Modify: `src/lib/feishuConfig.js`

**Interfaces:**
- Produces: `createPkcePair(cryptoApi)`, `createOAuthState(cryptoApi)`, `buildAuthorizeUrl(options)`, `parseOAuthCallback(url, expectedState)`.
- Produces: `createFeishuAuth({ chromeApi, fetchImpl, appId })` with `status()`, `authorize()`, `getAccessToken()`, and `clear()`.
- Storage key: `feishuAuthSession` with `{ accessToken, expiresAt, grantedScopes }` only.

- [ ] **Step 1: Add failing pure-PKCE tests**

```js
it("builds an S256 authorization URL without a secret", async () => {
  const pair = await createPkcePair(fakeCrypto);
  const url = new URL(buildAuthorizeUrl({
    appId: "cli_public",
    redirectUri: "https://extension.chromiumapp.org/feishu",
    scopes: ["wiki:wiki:readonly", "docx:document:readonly", "docx:document:write_only"],
    state: "state-1",
    challenge: pair.challenge
  }));
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.has("client_secret")).toBe(false);
});

it("rejects a callback whose state differs", () => {
  expect(() => parseOAuthCallback("https://callback/?code=x&state=wrong", "right"))
    .toThrow("OAuth state mismatch");
});
```

- [ ] **Step 2: Run the tests and verify missing exports**

Run: `npx vitest run tests/feishuPkce.test.js tests/feishuAuth.test.js`

Expected: FAIL because the PKCE/auth modules do not exist.

- [ ] **Step 3: Implement the pure helpers and injected auth adapter**

```js
export function createFeishuAuth({ chromeApi, fetchImpl, appId }) {
  const redirectUri = chromeApi.identity.getRedirectURL("feishu");
  return {
    async authorize() {
      const state = createOAuthState(globalThis.crypto);
      const { verifier, challenge } = await createPkcePair(globalThis.crypto);
      const callback = await chromeApi.identity.launchWebAuthFlow({
        url: buildAuthorizeUrl({ appId, redirectUri, scopes: FEISHU_SCOPES, state, challenge }),
        interactive: true
      });
      const code = parseOAuthCallback(callback, state).code;
      const token = await exchangeCode({ fetchImpl, appId, code, verifier, redirectUri });
      await chromeApi.storage.session.set({
        feishuAuthSession: {
          accessToken: token.access_token,
          expiresAt: Date.now() + token.expires_in * 1000,
          grantedScopes: token.scope.split(" ")
        }
      });
      return { status: "authorized", expiresAt: Date.now() + token.expires_in * 1000 };
    }
  };
}
```

`exchangeCode` sends exactly `grant_type`, `client_id`, `code`, `code_verifier`, and `redirect_uri`; it never sends `client_secret`.

- [ ] **Step 4: Configure the real Feishu app without committing credentials**

Create or select the self-built Feishu app, enable the three approved scopes, publish the permission change, and add both values returned by `chrome.identity.getRedirectURL("feishu")` from Chrome and Edge to the app redirect allowlist. Build with the public value `VITE_FEISHU_APP_ID` set in `.env.local`; `.env.local` remains ignored.

- [ ] **Step 5: Run the unit tests**

Run: `npx vitest run tests/feishuPkce.test.js tests/feishuAuth.test.js`

Expected: PASS, including cancellation, expired-session, malformed callback, token endpoint error, and storage tests.

- [ ] **Step 6: Perform the real PKCE compatibility probe**

Load the development build in Chrome, invoke `authorize()`, approve the scopes, and inspect only the normalized result shown by the extension. Do not copy or log the returned token.

Success criterion: `authorize()` stores a session with an expiry and `getAccessToken()` returns a non-empty token to the service worker.

Failure criterion: the v2 token endpoint reports missing/invalid `client_secret` or otherwise rejects the public-client exchange.

- [ ] **Step 7: Follow the fixed decision rule**

- On success, commit this task and continue to Task 3.
- On failure, retain the pure PKCE tests and adapter interface, execute `docs/superpowers/plans/2026-07-13-feishu-native-auth-helper.md`, then continue Task 3 using the same `getAccessToken()` interface.

- [ ] **Step 8: Commit the accepted auth adapter**

```bash
git add src/lib/feishuConfig.js src/lib/feishuPkce.js src/background/feishuAuth.js tests/feishuPkce.test.js tests/feishuAuth.test.js
git commit -m "feat: add Feishu user authorization"
```

---

### Task 3: Add the OpenAPI Client and Fixed Wiki Resolver

**Files:**
- Create: `src/background/feishuApiClient.js`
- Create: `src/background/feishuWikiResolver.js`
- Create: `tests/feishuApiClient.test.js`
- Create: `tests/feishuWikiResolver.test.js`

**Interfaces:**
- `createFeishuApiClient({ fetchImpl, getAccessToken })` produces `request(path, options)` and `listAllBlocks(documentId)`.
- `FeishuApiError` exposes `status`, `code`, `logId`, `stage`, and `message` without sensitive response bodies.
- `resolveFixedTestDocument(client)` returns `{ wikiToken, documentId, spaceId, title, revisionId }`.

- [ ] **Step 1: Write failing transport and resolver tests**

```js
it("paginates all document blocks in order", async () => {
  const client = createFeishuApiClient({ fetchImpl: twoPageFetch, getAccessToken: async () => "u-token" });
  await expect(client.listAllBlocks("doc-1")).resolves.toEqual([blockA, blockB]);
});

it("rejects a fixed wiki target that is not docx", async () => {
  await expect(resolveFixedTestDocument(fakeClientReturningSheet)).rejects.toThrow("not a docx document");
});
```

- [ ] **Step 2: Run and observe missing-module failures**

Run: `npx vitest run tests/feishuApiClient.test.js tests/feishuWikiResolver.test.js`

Expected: FAIL because both modules are missing.

- [ ] **Step 3: Implement sanitized errors and pagination**

```js
export class FeishuApiError extends Error {
  constructor({ message, status, code, logId, stage }) {
    super(message);
    Object.assign(this, { status, code, logId, stage });
  }
}

export function createFeishuApiClient({ fetchImpl, getAccessToken }) {
  async function request(path, { method = "GET", query = {}, body, stage = "api" } = {}) {
    const token = await getAccessToken();
    const url = new URL(path, "https://open.feishu.cn");
    for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));
    const response = await fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.code) throw toFeishuApiError(response, payload, stage);
    return payload.data;
  }
  return { request, listAllBlocks: (documentId) => listAllBlocks(request, documentId) };
}
```

Do not add an automatic retry loop.

- [ ] **Step 4: Implement fixed target resolution**

Resolve `LlhrwSLIvilANZk1opwcQGlUnNv` with `/open-apis/wiki/v2/spaces/get_node`, require `obj_type === "docx"`, then fetch document metadata and all blocks. Reject any caller-supplied document token.

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run tests/feishuApiClient.test.js tests/feishuWikiResolver.test.js`

Expected: PASS for pagination, 401/403, 429, 5xx, timeout, log ID, non-docx, and wrong fixed token.

```bash
git add src/background/feishuApiClient.js src/background/feishuWikiResolver.js tests/feishuApiClient.test.js tests/feishuWikiResolver.test.js
git commit -m "feat: read the fixed Feishu document through OpenAPI"
```

---

### Task 4: Model the Real Block Tree and Extract Templates

**Files:**
- Create: `src/lib/feishuBlockModel.js`
- Create: `src/lib/feishuTemplateReader.js`
- Create: `tests/feishuBlockModel.test.js`
- Create: `tests/feishuTemplateReader.test.js`
- Create: `tests/fixtures/feishu-structural-sample.json`

**Interfaces:**
- `buildBlockModel(items, revisionId)` returns `{ revisionId, rootId, blocks, childrenByParent, preorder }`.
- `textOfBlock(block)` returns normalized visible text from text-run elements.
- `inspectRecruitingDocument(model)` returns `{ revisionId, portfolio, jd, templates, companies }`.
- `sanitizeStructuralFixture(items)` replaces IDs and non-structural prose while preserving block types, styles, hierarchy, target headings, sample company names, and sample job titles.

- [ ] **Step 1: Write a minimal structural fixture and failing tests**

The fixture must include Page(1), Heading1(3), Heading2(4), Bullet(12), Callout(19), QuoteContainer(34), two companies, and the exact target headings.

```js
it("finds the first JD company as a root-level heading1 after 岗位JD整理", () => {
  const snapshot = inspectRecruitingDocument(buildBlockModel(fixture.items, 7));
  expect(snapshot.jd.companies[0]).toMatchObject({ name: "示例公司甲", headingBlockId: "b-jd-company-a" });
});

it("copies callout and quote styles but not source prose", () => {
  const snapshot = inspectRecruitingDocument(buildBlockModel(fixture.items, 7));
  expect(snapshot.templates.callout).toMatchObject({ block_type: 19 });
  expect(JSON.stringify(snapshot.templates)).not.toContain("原始公司介绍正文");
});
```

- [ ] **Step 2: Run and verify failures**

Run: `npx vitest run tests/feishuBlockModel.test.js tests/feishuTemplateReader.test.js`

Expected: FAIL because the model and inspector do not exist.

- [ ] **Step 3: Implement block constants and text extraction**

```js
export const BLOCK = Object.freeze({ PAGE: 1, TEXT: 2, HEADING1: 3, HEADING2: 4, BULLET: 12, CALLOUT: 19, QUOTE_CONTAINER: 34 });

export function textOfBlock(block) {
  const key = ({ 1: "page", 2: "text", 3: "heading1", 4: "heading2", 12: "bullet" })[block.block_type];
  return (block[key]?.elements ?? [])
    .map((element) => element.text_run?.content ?? "")
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}
```

Build child order from each parent block's `children` array; never infer sibling order from API page boundaries.

- [ ] **Step 4: Implement strict section and template discovery**

Require exactly one target heading each. A valid JD company template has Heading1 company, Heading2 `公司介绍`, Callout, Heading2 `开放岗位`, a job title block, and QuoteContainer before the next Heading1. A valid summary template has a company text block followed by at least one Bullet. Stop if no unique complete template exists.

- [ ] **Step 5: Capture and sanitize a read-only real fixture**

After Task 2 authorization, call only GET endpoints for the test copy, pass the response through `sanitizeStructuralFixture`, inspect the sanitized JSON for leaked prose/user IDs/tokens, then replace the hand-built structural fixture with the sanitized structure. Never commit the raw response.

- [ ] **Step 6: Run tests and commit**

Run: `npx vitest run tests/feishuBlockModel.test.js tests/feishuTemplateReader.test.js`

Expected: PASS for nested containers, unique headings, incomplete templates, sibling ordering, style extraction, and sanitization.

```bash
git add src/lib/feishuBlockModel.js src/lib/feishuTemplateReader.js tests/feishuBlockModel.test.js tests/feishuTemplateReader.test.js tests/fixtures/feishu-structural-sample.json
git commit -m "feat: inspect Feishu recruiting block structure"
```

---

### Task 5: Generate Exact New-Company and Append Plans

**Files:**
- Create: `src/lib/feishuOpenApiPlan.js`
- Create: `tests/feishuOpenApiPlan.test.js`
- Modify: `src/lib/feishuPlan.js`

**Interfaces:**
- `buildFeishuOpenApiPlan(snapshot, draft)` returns `{ ok, mode, baseRevisionId, companyName, jobs, jdTarget, summaryTarget, expected, errors }`.
- Targets contain `{ parentBlockId, index }` and no DOM nodes.

- [ ] **Step 1: Write failing plan tests**

```js
it("inserts a new company before the first company in both sections", () => {
  const plan = buildFeishuOpenApiPlan(snapshot, coFANCYDraft);
  expect(plan).toMatchObject({
    ok: true,
    mode: "new-company",
    jdTarget: { index: snapshot.jd.firstCompanyIndex },
    summaryTarget: { index: snapshot.portfolio.firstCompanyIndex },
    jobs: [{ ordinal: 1 }, { ordinal: 2 }]
  });
});

it("stops when the same normalized job already exists", () => {
  const plan = buildFeishuOpenApiPlan(snapshotWithCoFANCYBrandDesign, coFANCYDraft);
  expect(plan.ok).toBe(false);
  expect(plan.errors.join(" ")).toContain("品牌设计");
});
```

- [ ] **Step 2: Run and verify missing-module failure**

Run: `npx vitest run tests/feishuOpenApiPlan.test.js`

Expected: FAIL because the OpenAPI planner is absent.

- [ ] **Step 3: Implement normalization and targets**

Normalize Unicode width, whitespace, `-` variants, `｜`/`|`, and case. Require company presence to agree across both sections. For append mode, derive the next ordinal from parsed existing `（n）` titles, not from array length.

Require the Portfolio section to precede the JD section in their shared parent order. This guarantees that adding JD siblings cannot invalidate the earlier summary insertion index; otherwise preflight stops.

```js
return {
  ok: errors.length === 0,
  mode,
  baseRevisionId: snapshot.revisionId,
  companyName,
  jobs,
  jdTarget,
  summaryTarget,
  expected: { companyName, jobTitles: jobs.map((job) => job.title), totalJdJobs, totalSummaryJobs },
  errors
};
```

- [ ] **Step 4: Preserve the existing import surface**

Make `src/lib/feishuPlan.js` re-export `buildFeishuOpenApiPlan` so UI imports can migrate without affecting Boss/Maimai modules.

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run tests/feishuOpenApiPlan.test.js tests/companyJdParser.test.js`

Expected: PASS for new company, append, non-contiguous numbering, duplicate company, duplicate input job, duplicate stored job, and one-section-only company.

```bash
git add src/lib/feishuOpenApiPlan.js src/lib/feishuPlan.js tests/feishuOpenApiPlan.test.js
git commit -m "feat: plan structural Feishu document updates"
```

---

### Task 6: Render Nested Heading, Callout, and Quote Blocks

**Files:**
- Create: `src/lib/feishuBlockRenderer.js`
- Create: `tests/feishuBlockRenderer.test.js`

**Interfaces:**
- `renderJdDescendants(draft, plan, templates)` returns `{ children_id, descendants }`.
- `renderSummaryDescendants(draft, plan, templates)` returns the same shape.
- `makeTextRun(content, style, link?)` accepts only sanitized text and `http:`/`https:` links.

- [ ] **Step 1: Write failing renderer tests**

```js
it("renders a new company as H1, H2, Callout, H2, job title and QuoteContainer", () => {
  const request = renderJdDescendants(coFANCYDraft, newCompanyPlan, templates);
  expect(request.descendants.map((block) => block.block_type)).toEqual(expect.arrayContaining([3, 4, 19, 34, 12]));
  expect(childTypes(request, "company-heading")).not.toContain(3);
  expect(texts(request)).toContain("（1）品牌设计｜上海｜社招");
});

it("omits the bonus heading when bonuses are empty", () => {
  expect(texts(renderJdDescendants(noBonusDraft, plan, templates))).not.toContain("加分项：");
});
```

- [ ] **Step 2: Run and verify failures**

Run: `npx vitest run tests/feishuBlockRenderer.test.js`

Expected: FAIL because the renderer does not exist.

- [ ] **Step 3: Implement deterministic temporary IDs and text blocks**

```js
function textBlock(id, type, field, content, blockStyle, elementStyle = {}) {
  return {
    block_id: id,
    block_type: type,
    [field]: {
      style: structuredClone(blockStyle ?? {}),
      elements: [{ text_run: { content: sanitizeText(content), text_element_style: structuredClone(elementStyle) } }]
    },
    children: []
  };
}
```

Use block type 3 for company, 4 for the two gray subheadings, 19 for Callout, 34 for QuoteContainer, and 12 for bullets. Copy only style objects from templates. For a missing introduction render one `待补充` Bullet. For an append plan render only new job title/quote descendants.

- [ ] **Step 4: Enforce hierarchy and URL safety**

The root `children_id` contains only siblings inserted at the target index. Callout children are introduction Bullets. QuoteContainer children are Text labels followed by Bullets. Reject `javascript:`, `data:`, control characters, and cyclic/missing descendant IDs.

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run tests/feishuBlockRenderer.test.js`

Expected: PASS for exact hierarchy, order, links, missing website, missing intro, missing bonuses, HTML-like input as plain text, control characters, and invalid URL schemes.

```bash
git add src/lib/feishuBlockRenderer.js tests/feishuBlockRenderer.test.js
git commit -m "feat: render native Feishu recruiting blocks"
```

---

### Task 7: Write in Phases and Verify Persisted Semantics

**Files:**
- Create: `src/lib/feishuWriteVerifier.js`
- Create: `src/background/feishuOpenApiWriter.js`
- Create: `tests/feishuWriteVerifier.test.js`
- Create: `tests/feishuOpenApiWriter.test.js`

**Interfaces:**
- `verifyJdWrite(snapshot, plan)` and `verifySummaryWrite(snapshot, plan)` return `{ ok, errors }`.
- `createFeishuOpenApiWriter({ client, inspect, wait })` exposes `write(draft)`.
- Result shape: `{ ok, status, mode, completedStages, failedStage, documentUrl, companyName, jobTitles, errorCode, logId, repairHint }`.

- [ ] **Step 1: Write failing semantic-verification tests**

```js
it("rejects a company nested under the previous company", () => {
  const result = verifyJdWrite(snapshotWithCoFANCYNestedUnderPreviousCompany, plan);
  expect(result.ok).toBe(false);
  expect(result.errors.join(" ")).toContain("Heading 1");
});

it("reports JD-only partial success when summary creation fails", async () => {
  const result = await writerWithSummaryFailure.write(coFANCYDraft);
  expect(result).toMatchObject({ ok: false, status: "partial", completedStages: ["jd"], failedStage: "summary-write" });
});
```

- [ ] **Step 2: Run and verify failures**

Run: `npx vitest run tests/feishuWriteVerifier.test.js tests/feishuOpenApiWriter.test.js`

Expected: FAIL because verifier/writer modules are missing.

- [ ] **Step 3: Implement strict semantic verification**

JD verification requires the company Heading1 at the planned sibling position, Heading2 labels, Callout, all expected job-title siblings, each job's QuoteContainer, correct ordinals, and expected total job count. Summary verification requires the company at the planned position and all expected Bullet texts. API success alone never returns `ok: true`.

- [ ] **Step 4: Implement phased writes with revision checks**

```js
async function write(draft) {
  const initial = await inspect();
  const plan = buildFeishuOpenApiPlan(initial, draft);
  if (!plan.ok) return failed("preflight", plan.errors.join("；"));
  const jdRequest = renderJdDescendants(draft, plan, initial.templates);
  await client.request(descendantPath(plan.jdTarget), {
    method: "POST",
    query: { document_revision_id: plan.baseRevisionId },
    body: { index: plan.jdTarget.index, ...jdRequest },
    stage: "jd-write"
  });
  await wait(400);
  const afterJd = await inspect();
  requireVerified(verifyJdWrite(afterJd, plan), "jd-verify");
  // Write summary using afterJd.revisionId, then read and verify again.
}
```

Serialize writes and wait at least 400 ms between edit calls. Never retry an edit. On a network timeout, perform exactly one `inspect()` and use semantic verification to classify success/failure/unknown.

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run tests/feishuWriteVerifier.test.js tests/feishuOpenApiWriter.test.js`

Expected: PASS for correct write, wrong heading level, wrong sibling position, nested previous company, missing callout, missing quote, count mismatch, revision conflict, 429, 403, timeout verified present, timeout verified absent, and unreadable unknown state.

```bash
git add src/lib/feishuWriteVerifier.js src/background/feishuOpenApiWriter.js tests/feishuWriteVerifier.test.js tests/feishuOpenApiWriter.test.js
git commit -m "feat: verify persisted Feishu document writes"
```

---

### Task 8: Move Feishu Messaging to the Service Worker

**Files:**
- Create: `src/background/feishuMessages.js`
- Create: `tests/feishuBackgroundMessages.test.js`
- Modify: `src/background.js`
- Modify: `src/sidepanel/fillPage.js`
- Modify: `tests/fillPage.test.js`

**Interfaces:**
- Runtime messages: `FEISHU_AUTH_STATUS`, `FEISHU_AUTHORIZE`, `FEISHU_INSPECT`, `FEISHU_PLAN`, `FEISHU_WRITE`, `FEISHU_CLEAR_AUTH`.
- Sidepanel helper: `sendFeishuRuntimeRequest(type, payload, chromeApi)`.

- [ ] **Step 1: Write failing message-routing tests**

```js
it("routes Feishu inspect through runtime messaging without an active Feishu tab", async () => {
  const chromeApi = { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true }) } };
  await sendFeishuInspectRequest(chromeApi);
  expect(chromeApi.runtime.sendMessage).toHaveBeenCalledWith({ type: "FEISHU_INSPECT" });
});

it("leaves RECRUITING_ASSISTANT_FILL tab messaging unchanged", async () => {
  // Keep the existing Boss/Maimai assertion byte-for-byte and rerun it.
});
```

- [ ] **Step 2: Run focused tests**

Run: `npx vitest run tests/feishuBackgroundMessages.test.js tests/fillPage.test.js`

Expected: FAIL because Feishu still uses active-tab content messaging.

- [ ] **Step 3: Implement an async service-worker listener**

```js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type?.startsWith("FEISHU_")) return false;
  handleFeishuBackgroundMessage(message, { sender })
    .then(sendResponse)
    .catch((error) => sendResponse(toPublicError(error)));
  return true;
});
```

The handler creates auth/client/resolver/inspector/writer dependencies once per service-worker lifetime. It never returns tokens or raw blocks to the sidepanel.

- [ ] **Step 4: Change only the Feishu sidepanel request path**

`sendFillRequest`, diagnostics, frame fallback, and recording functions stay unchanged. Replace only `sendFeishuRequest` with `chromeApi.runtime.sendMessage(message)`.

- [ ] **Step 5: Run routing and legacy tests, then commit**

Run: `npx vitest run tests/feishuBackgroundMessages.test.js tests/fillPage.test.js tests/formFiller.test.js`

Expected: PASS, including all existing Boss/Maimai cases.

```bash
git add src/background.js src/background/feishuMessages.js src/sidepanel/fillPage.js tests/feishuBackgroundMessages.test.js tests/fillPage.test.js
git commit -m "feat: run Feishu automation in the extension background"
```

---

### Task 9: Add Authorization, Plan Preview, and Phase Results to the Feishu UI

**Files:**
- Modify: `src/sidepanel/App.jsx`
- Modify: `src/sidepanel/feishuUi.js`
- Modify: `src/sidepanel/styles.css`
- Modify: `tests/feishuUi.test.js`

**Interfaces:**
- UI state: `authStatus`, `inspection`, `writePlan`, `writeResult`, `writing`.
- `formatFeishuWriteStatus(result)` must distinguish success, partial, failed, and unknown.

- [ ] **Step 1: Add failing formatter and state-transition tests**

```js
it("formats unknown timeout without claiming failure or success", () => {
  expect(formatFeishuWriteStatus({ status: "unknown", failedStage: "jd-write", repairHint: "检查 JD 区" }))
    .toContain("结果未知");
});

it("requires a current plan before enabling write", () => {
  expect(canWriteFeishu({ authStatus: "authorized", plan: null, errors: [] })).toBe(false);
});
```

- [ ] **Step 2: Run and verify failures**

Run: `npx vitest run tests/feishuUi.test.js`

Expected: FAIL for missing phase/status behavior.

- [ ] **Step 3: Implement Feishu-only UI controls**

Add `授权飞书`, `重新授权`, `检查测试副本`, `生成写入计划`, `确认并写入测试副本`, and `打开文档检查`. Display the fixed document URL, plan mode, insertion positions in human terms, new job ordinals, warnings, and phase status. Disable write until authorization, inspection, valid editable draft, and a matching plan revision all exist.

- [ ] **Step 4: Preserve the recruiting branch exactly**

Do not alter `parseJd`, `fillCurrentPage`, the Boss/Maimai fields, their disabled conditions, or their button handlers. All new state and rendering remains behind `platform === "feishu"`.

- [ ] **Step 5: Run UI and parser tests, then commit**

Run: `npx vitest run tests/feishuUi.test.js tests/jdParser.test.js tests/companyJdParser.test.js`

Expected: PASS for authorization states, plan invalidation after edits, partial/unknown results, and existing parser behavior.

```bash
git add src/sidepanel/App.jsx src/sidepanel/feishuUi.js src/sidepanel/styles.css tests/feishuUi.test.js
git commit -m "feat: preview and report Feishu OpenAPI writes"
```

---

### Task 10: Tighten Manifest, Build Verification, and Documentation

**Files:**
- Modify: `public/manifest.json`
- Modify: `scripts/verify-extension-build.mjs`
- Modify: `tests/manifest.test.js`
- Modify: `README.md`

**Interfaces:**
- Production manifest includes `identity`, `storage`, Feishu account/API hosts, and unchanged Boss/Maimai hosts.
- Production manifest excludes `clipboardRead`, `clipboardWrite`, `debugger`, and Feishu content-script matches.

- [ ] **Step 1: Write failing manifest assertions**

```js
expect(manifest.permissions).toEqual(expect.arrayContaining(["identity", "storage"]));
expect(manifest.permissions).not.toEqual(expect.arrayContaining(["clipboardRead", "clipboardWrite", "debugger"]));
expect(manifest.host_permissions).toEqual(expect.arrayContaining([
  "https://accounts.feishu.cn/*",
  "https://open.feishu.cn/*"
]));
expect(manifest.content_scripts[0].matches.some((match) => match.includes("feishu.cn"))).toBe(false);
```

- [ ] **Step 2: Run and verify the expected failure**

Run: `npx vitest run tests/manifest.test.js`

Expected: FAIL against the current clipboard/Feishu-DOM manifest.

- [ ] **Step 3: Update manifest and build verification**

Keep all existing Zhipin/Kanzhun/Maimai hosts and content matches. Add API hosts and auth/storage permissions. Make `verify-extension-build.mjs` load `dist/manifest.json`, reject forbidden permissions/matches, and verify `dist/background.js` contains the Feishu message types.

- [ ] **Step 4: Update user documentation**

Document Feishu app setup, three scopes, Chrome/Edge redirect URLs, test-only target, authorization-on-use, correct-format acceptance criteria, partial-success recovery, four-user installation, and rollback branch `codex/pre-feishu-openapi-baseline`.

- [ ] **Step 5: Run full verification and commit**

Run: `npm test && npm run build`

Expected: all tests pass, legacy hashes pass, production build exits 0, and final manifest contains no old Feishu DOM permissions.

```bash
git add public/manifest.json scripts/verify-extension-build.mjs tests/manifest.test.js README.md
git commit -m "chore: finalize Feishu OpenAPI extension permissions"
```

---

### Task 11: Prove Correct Placement in Chrome and Edge

**Files:**
- Modify: `tests/fixtures/feishu-structural-sample.json` only if the sanitized real structure exposes a missing contract case.
- Modify: the exact module/test responsible for any observed mismatch.
- Create: `docs/testing/2026-07-13-feishu-openapi-acceptance.md`

**Interfaces:**
- Acceptance record contains no tokens, Secret, raw private prose, or screenshots with sensitive content.
- Completion requires fresh API read-back, not visual appearance alone.

- [ ] **Step 1: Run the complete automated gate before any write**

Run: `npm test && npm run build && git diff --check`

Expected: exit 0; legacy protected hashes unchanged; no uncommitted formatting errors.

- [ ] **Step 2: Perform a read-only inspection in Chrome**

Authorize, inspect the fixed copy, and confirm the API reports exactly one target heading each, a complete template, and no stored CoFANCY company. If CoFANCY exists, use a unique acceptance company name rather than deleting or overwriting it.

- [ ] **Step 3: Write the two-job CoFANCY draft as a new company**

Use the user-provided CoFANCY text. Confirm the preview says `new-company`, then execute one write. Require read-back to prove:

- CoFANCY is the first company in both target sections.
- Company is a Heading1 sibling, not a child of the previous company.
- `公司介绍` and `开放岗位` are Heading2.
- Introduction is inside Callout.
- Both job titles are outside QuoteContainer and their details are inside QuoteContainer.
- Summary contains exactly two job Bullets.

- [ ] **Step 4: Append one unique third job**

Confirm the preview says `append-jobs`, ordinal 3, and no duplicate company. Require read-back to prove one CoFANCY Heading1, three JD job titles, and three summary Bullets.

- [ ] **Step 5: Repeat authorization and a real append write in Edge**

Install the same built extension in macOS Edge, authorize with its registered redirect URI, inspect the test copy, append a fourth unique acceptance-only job, and require semantic read-back proving one CoFANCY Heading1, four JD job titles, and four summary Bullets.

- [ ] **Step 6: Smoke-test Boss and Maimai**

On one existing Boss page and one existing Maimai page, parse a known JD and invoke the current fill button. Record filled/missing fields and confirm behavior matches baseline. Do not publish the jobs.

- [ ] **Step 7: Record evidence and fix any mismatch with red-green tests**

For each mismatch: add a failing sanitized fixture test, confirm it fails, implement the smallest fix, confirm the focused test passes, commit the focused module and its focused test, rerun the full gate, then repeat the affected real acceptance step. Never patch the live document manually to disguise a structural failure.

- [ ] **Step 8: Final verification and commit**

Run: `npm test && npm run build && git diff --check && git status --short`

Expected: all tests/build pass; only the intended acceptance record is uncommitted before commit.

```bash
git add docs/testing/2026-07-13-feishu-openapi-acceptance.md tests/fixtures/feishu-structural-sample.json
git commit -m "test: verify Feishu OpenAPI writes end to end"
```

The implementation is complete only after both new-company and append-jobs acceptance steps pass with API read-back and the Boss/Maimai smoke tests remain unchanged.
