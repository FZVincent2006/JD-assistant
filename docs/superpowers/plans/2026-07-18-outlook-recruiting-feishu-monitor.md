# Outlook Recruiting Feishu Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing recruiting Chrome extension so that, while Chrome and the China-cloud Outlook tab are running, new mail in `个人投递（需提醒）` is deduplicated and announced in one configured four-person Feishu group.

**Architecture:** A dedicated Outlook content script reads only the visible mail-list metadata from `partner.outlook.cn` and sends sanitized scan results to the extension service worker. The worker owns baseline state, 90-day deduplication, retry state, alarms, and signed Feishu webhook delivery; the side panel owns configuration and explicit enable/test actions. Existing server-side Outlook rules remain the primary platform classifier, while the extension applies a fixed four-platform sender-domain guard before notifying.

**Tech Stack:** Manifest V3, Chrome `storage`/`alarms`/`notifications` APIs, browser Web Crypto, React 19, Vite 7, Vitest 3, Feishu custom-bot V2 webhook.

## Global Constraints

- Target mailbox is exactly `recruiting@zhenfund.com` on `https://partner.outlook.cn/mail/`.
- Monitor only the Outlook folder named `个人投递（需提醒）`.
- Never open a mail row or change read, selection, move, category, or delete state.
- Persist and transmit only sender name, sender email, subject, received time, attachment boolean, and hashed dedupe key.
- Never persist or transmit body preview, attachment name/content, full DOM, full `aria-label`, or webhook/secret logs.
- Exclude `maimai.cn`, `lietou-edm.com`, `shixiseng.com`, and `bosszhipin.com` as defense in depth.
- Webhook and signing secret live only in `chrome.storage.local`.
- First enable establishes a baseline and sends no historical mail.
- Poll every 10 minutes; retry due webhook jobs every minute with 1, 5, 15, then 30-minute delays for at most 24 hours.
- All existing tests plus `npm run build` must remain green.

---

### Task 1: Outlook page extraction and manifest wiring

**Files:**
- Create: `src/content/outlookMonitor.js`
- Create: `tests/outlookMonitor.test.js`
- Modify: `src/content/index.js`
- Modify: `public/manifest.json`
- Modify: `vite.config.js`
- Modify: `tests/manifest.test.js`

**Interfaces:**
- Produces: `extractOutlookMailRows(root): SanitizedMail[]`
- Produces: `getOutlookPageState(root, url): OutlookPageState`
- Produces: `startOutlookMonitor({ root, location, chromeApi, mutationObserver, setTimer }): stop`
- Produces content messages `OUTLOOK_SCAN_RESULT` and handles `OUTLOOK_SCAN_REQUEST`.

- [ ] **Step 1: Write failing extraction and manifest tests**

```js
it("extracts only allowed fields and drops preview text", () => {
  document.body.innerHTML = outlookFixture;
  expect(extractOutlookMailRows(document)).toEqual([{
    conversationId: "conv-1",
    senderName: "Candidate",
    senderEmail: "candidate@example.com",
    subject: "Investment internship application",
    receivedTime: "2026-07-18T09:00:00+08:00",
    hasAttachment: true
  }]);
  expect(JSON.stringify(extractOutlookMailRows(document))).not.toContain("private preview");
});
```

```js
expect(manifest.permissions).toEqual(expect.arrayContaining(["storage", "alarms", "notifications"]));
expect(manifest.host_permissions).toContain("https://partner.outlook.cn/*");
expect(manifest.host_permissions).toContain("https://open.feishu.cn/*");
expect(manifest.content_scripts.some((script) =>
  script.matches.includes("https://partner.outlook.cn/mail/*") &&
  script.js.includes("outlook.js")
)).toBe(true);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/outlookMonitor.test.js tests/manifest.test.js`

Expected: FAIL because `outlookMonitor.js` and the Outlook manifest entry do not exist.

- [ ] **Step 3: Implement the minimal privacy-preserving extractor and listener**

```js
export function extractOutlookMailRows(root) {
  return [...root.querySelectorAll('[role="option"][data-convid]')]
    .map(extractOneRow)
    .filter(Boolean);
}

export function getOutlookPageState(root, url) {
  return {
    supported: new URL(url).origin === "https://partner.outlook.cn",
    mailbox: findMailbox(root),
    folder: findSelectedFolder(root),
    loggedIn: Boolean(findMailbox(root))
  };
}
```

The row parser must immediately trim fallback accessibility text and return a newly allocated object containing only the six allowed fields. `startOutlookMonitor` must debounce mutation scans for three seconds and never call `.click()`.

- [ ] **Step 4: Wire a separate `outlook.js` content entry**

Add `outlook: "src/content/outlookMonitor.js"` to Vite inputs and return `outlook.js` from `entryFileNames`. Add a top-frame-only Outlook content script and the required permissions/hosts to the manifest.

- [ ] **Step 5: Run focused and full tests**

Run: `npm test -- tests/outlookMonitor.test.js tests/manifest.test.js`

Expected: PASS.

Run: `npm test`

Expected: 96 existing tests plus the new extractor/manifest tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/content/outlookMonitor.js tests/outlookMonitor.test.js public/manifest.json vite.config.js tests/manifest.test.js
git commit -m "feat: add privacy-safe Outlook mail scanner"
```

### Task 2: Baseline, filtering, deduplication, and retention core

**Files:**
- Create: `src/lib/outlookMonitorCore.js`
- Create: `tests/outlookMonitorCore.test.js`

**Interfaces:**
- Consumes: `SanitizedMail` from Task 1.
- Produces: `hashMailVersion(mail, cryptoApi): Promise<string>`
- Produces: `isExcludedPlatformMail(mail, rules?): boolean`
- Produces: `planScan(state, mails, now): Promise<ScanPlan>`
- Produces: `applySuccessfulDelivery(state, keys, deliveredAt): MonitorState`
- Produces: `pruneMonitorState(state, now): MonitorState`

- [ ] **Step 1: Write failing behavioral tests**

```js
it("uses conversation plus received time so a new reply can alert again", async () => {
  const first = await hashMailVersion({ conversationId: "c1", receivedTime: "t1" });
  const reply = await hashMailVersion({ conversationId: "c1", receivedTime: "t2" });
  expect(first).not.toBe(reply);
});

it("establishes the first baseline without notifications", async () => {
  const plan = await planScan(emptyMonitorState(), [mail], now);
  expect(plan.notifications).toEqual([]);
  expect(plan.nextState.baselineComplete).toBe(true);
});

it.each(["mail.maimai.cn", "mail7.lietou-edm.com", "notice.shixiseng.com", "service.bosszhipin.com"])(
  "excludes %s",
  (domain) => expect(isExcludedPlatformMail({ senderEmail: `noreply@${domain}` })).toBe(true)
);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/outlookMonitorCore.test.js`

Expected: FAIL because the monitor core does not exist.

- [ ] **Step 3: Implement immutable state transitions**

Use SHA-256 over `${conversationId}\n${normalizedReceivedTime}`. `planScan` must:

1. Reject scans for the wrong mailbox/folder before calling it.
2. On the first valid scan, write all hashes as baseline entries with `status: "baseline"`.
3. On later scans, skip stored hashes and fixed platform domains.
4. Return unseen personal mail as `notifications` without marking it delivered.
5. Retain only 90 days of hash records.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- tests/outlookMonitorCore.test.js`

Expected: PASS with baseline, dedupe, reply-version, filtering, and retention cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/outlookMonitorCore.js tests/outlookMonitorCore.test.js
git commit -m "feat: add Outlook monitor dedupe core"
```

### Task 3: Signed Feishu delivery and retry queue

**Files:**
- Create: `src/lib/feishuWebhook.js`
- Create: `src/lib/outlookDeliveryQueue.js`
- Create: `tests/feishuWebhook.test.js`
- Create: `tests/outlookDeliveryQueue.test.js`

**Interfaces:**
- Produces: `validateFeishuWebhook(url): boolean`
- Produces: `generateFeishuSign(secret, timestamp, cryptoApi): Promise<string>`
- Produces: `buildSingleMailCard(mail): object`
- Produces: `buildMailDigestCard(mails): object`
- Produces: `sendFeishuWebhook(config, payload, deps): Promise<DeliveryResult>`
- Produces: `enqueueNotifications(queue, mails, now): DeliveryJob[]`
- Produces: `markDeliveryFailure(job, now): DeliveryJob`
- Produces: `getDueJobs(queue, now): DeliveryJob[]`

- [ ] **Step 1: Write failing signature, privacy, card, and retry tests**

```js
it("matches the Feishu documented empty-message HMAC", async () => {
  expect(await generateFeishuSign("secret", 1599360473, nodeWebCrypto))
    .toBe(referenceSignature);
});

it("never puts preview or attachment filename into a card", () => {
  const card = buildSingleMailCard({ ...mail, preview: "private", attachmentName: "resume.pdf" });
  expect(JSON.stringify(card)).not.toMatch(/private|resume\.pdf/);
});

it("uses 1, 5, 15, then 30 minute retry delays and expires at 24 hours", () => {
  expect(retryDelayMs(0)).toBe(60_000);
  expect(retryDelayMs(1)).toBe(300_000);
  expect(retryDelayMs(2)).toBe(900_000);
  expect(retryDelayMs(3)).toBe(1_800_000);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/feishuWebhook.test.js tests/outlookDeliveryQueue.test.js`

Expected: FAIL because the webhook and queue modules do not exist.

- [ ] **Step 3: Implement Feishu V2 webhook support**

Validate only `https://open.feishu.cn/open-apis/bot/v2/hook/<non-empty-token>`. Compute the signature by importing `timestamp + "\n" + secret` as the HMAC-SHA256 key and signing an empty byte array, then Base64-encoding the result. Send `timestamp`, `sign`, `msg_type: "interactive"`, and a classic interactive card with an Outlook entry button.

- [ ] **Step 4: Implement durable retry job transitions**

Jobs store only sanitized mail fields, hash key, attempt count, created time, next attempt time, and last error code. Five or fewer new messages remain individual jobs; more than five may be grouped for transport while retaining one hash key per mail.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npm test -- tests/feishuWebhook.test.js tests/outlookDeliveryQueue.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/feishuWebhook.js src/lib/outlookDeliveryQueue.js tests/feishuWebhook.test.js tests/outlookDeliveryQueue.test.js
git commit -m "feat: add signed Feishu mail alerts"
```

### Task 4: Service worker orchestration and status API

**Files:**
- Create: `src/lib/outlookMonitorService.js`
- Create: `tests/outlookMonitorService.test.js`
- Modify: `src/background.js`

**Interfaces:**
- Consumes: scan messages from Task 1 and core/delivery functions from Tasks 2-3.
- Produces: `createOutlookMonitorService(deps)` with `handleMessage`, `handleScanAlarm`, `handleRetryAlarm`, `initialize`.
- Produces runtime message API:
  - `OUTLOOK_MONITOR_GET`
  - `OUTLOOK_MONITOR_SAVE_CONFIG`
  - `OUTLOOK_MONITOR_TEST_FEISHU`
  - `OUTLOOK_MONITOR_SET_ENABLED`
  - `OUTLOOK_MONITOR_REBASELINE`
  - `OUTLOOK_SCAN_RESULT`

- [ ] **Step 1: Write failing service tests with fake Chrome storage/tabs**

```js
it("requires a successful test and confirmed rules before enabling", async () => {
  const result = await service.handleMessage({ type: "OUTLOOK_MONITOR_SET_ENABLED", enabled: true });
  expect(result).toEqual({ ok: false, error: expect.stringContaining("测试提醒") });
});

it("queries the China Outlook tab every ten minutes and asks it to scan", async () => {
  await service.handleScanAlarm();
  expect(chrome.tabs.query).toHaveBeenCalledWith({ url: "https://partner.outlook.cn/mail/*" });
  expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(42, { type: "OUTLOOK_SCAN_REQUEST", reason: "alarm" });
});

it("marks hashes delivered only after a successful Feishu response", async () => {
  // Arrange one unseen personal mail and a successful webhook.
  // Assert stored dedupe status is "delivered" only after the webhook resolves with code 0.
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/outlookMonitorService.test.js`

Expected: FAIL because the service module does not exist.

- [ ] **Step 3: Implement the injectable monitor service**

Use one `chrome.storage.local` document with schema version, redacted configuration, monitor state, queue, and up to 20 privacy-safe events. `initialize` creates `outlook-monitor-scan` (10 minutes) and `outlook-monitor-retry` (1 minute). Missing/invalid Outlook pages update status without deleting the dedupe boundary.

- [ ] **Step 4: Keep `src/background.js` as a thin event adapter**

Register `onInstalled`, `onStartup`, `onAlarm`, and `onMessage`. Return `true` for async responses. Do not log message payloads or configuration secrets.

- [ ] **Step 5: Run focused and full tests**

Run: `npm test -- tests/outlookMonitorService.test.js`

Expected: PASS.

Run: `npm test`

Expected: all suites pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/outlookMonitorService.js tests/outlookMonitorService.test.js src/background.js
git commit -m "feat: orchestrate local Outlook monitoring"
```

### Task 5: Non-technical side-panel setup and controls

**Files:**
- Create: `src/sidepanel/outlookMonitorApi.js`
- Create: `src/sidepanel/OutlookMonitorPanel.jsx`
- Create: `src/sidepanel/outlookMonitorUi.js`
- Create: `tests/outlookMonitorApi.test.js`
- Create: `tests/outlookMonitorUi.test.js`
- Modify: `src/sidepanel/App.jsx`
- Modify: `src/sidepanel/styles.css`

**Interfaces:**
- Produces: `sendOutlookMonitorRequest(type, payload, chromeApi)`
- Produces: `formatOutlookMonitorStatus(snapshot): string`
- Produces React panel with masked webhook/secret fields, rule confirmation, test, enable/pause, and status.

- [ ] **Step 1: Write failing API and status-format tests**

```js
it("sends monitor configuration only to the service worker", async () => {
  await saveOutlookMonitorConfig({ webhookUrl: "https://...", secret: "x" }, chromeApi);
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
    type: "OUTLOOK_MONITOR_SAVE_CONFIG",
    payload: { webhookUrl: "https://...", secret: "x" }
  });
});

it("explains when the personal-delivery folder is not open", () => {
  expect(formatOutlookMonitorStatus({ status: "wrong_folder" }))
    .toContain("个人投递（需提醒）");
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/outlookMonitorApi.test.js tests/outlookMonitorUi.test.js`

Expected: FAIL because the side-panel monitor modules do not exist.

- [ ] **Step 3: Implement API helpers and the Outlook panel**

Add an `Outlook 提醒` top-level tab. The panel must show:

- fixed target mailbox and folder;
- Outlook tab/login/folder state;
- password inputs for replacement webhook and secret;
- four fixed excluded platforms;
- checkbox confirming the server-side rules;
- buttons for save, test message, establish baseline/enable, and pause;
- recent scan/notification times, queue count, and up to 20 redacted events.

Do not render stored webhook or secret plaintext. Display only “已配置/未配置”.

- [ ] **Step 4: Integrate with the existing side panel without changing JD modes**

Update the platform switch to four columns and render the Outlook panel instead of the JD editor when selected.

- [ ] **Step 5: Run focused and full tests**

Run: `npm test -- tests/outlookMonitorApi.test.js tests/outlookMonitorUi.test.js`

Expected: PASS.

Run: `npm test`

Expected: all suites pass.

- [ ] **Step 6: Commit**

```bash
git add src/sidepanel/outlookMonitorApi.js src/sidepanel/OutlookMonitorPanel.jsx src/sidepanel/outlookMonitorUi.js tests/outlookMonitorApi.test.js tests/outlookMonitorUi.test.js src/sidepanel/App.jsx src/sidepanel/styles.css
git commit -m "feat: add Outlook reminder setup panel"
```

### Task 6: Build verification, documentation, and manual handoff

**Files:**
- Modify: `README.md`
- Modify: `scripts/verify-extension-build.mjs`
- Modify: `docs/superpowers/specs/2026-07-17-outlook-recruiting-feishu-monitor-design.md`

**Interfaces:**
- Consumes all prior tasks.
- Produces a build that includes `dist/outlook.js`, required permissions, and a documented local setup flow.

- [ ] **Step 1: Write the failing build-artifact assertion**

Extend `scripts/verify-extension-build.mjs` to read both `dist/content.js` and `dist/outlook.js`, reject ESM imports in either, and reject obvious webhook literals such as `/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]{16,}/`.

- [ ] **Step 2: Run the build and verify RED if `outlook.js` is missing**

Run: `npm run build`

Expected before Task 1 wiring is present: FAIL because `dist/outlook.js` is missing. After Tasks 1-5 it should progress to the privacy assertions.

- [ ] **Step 3: Document installation and the one required user configuration**

Update README with:

1. Build and reload the extension.
2. Keep `https://partner.outlook.cn/mail/` signed in to `recruiting@zhenfund.com` with `个人投递（需提醒）` selected.
3. Create a four-person private Feishu group and add one V2 custom bot with signature verification.
4. Paste webhook/secret in `Outlook 提醒`, save, send test, confirm rules, and enable.
5. Explain that history becomes baseline and only subsequent messages alert.

Update the design spec to record that Outlook server rules and the personal-delivery folder became the primary classifier on 2026-07-18.

- [ ] **Step 4: Run complete verification**

Run: `npm test`

Expected: every test passes with zero failures.

Run: `npm run build`

Expected: Vite build succeeds, `dist/outlook.js` exists, both content scripts contain no ESM imports, and no webhook secret literal is present.

- [ ] **Step 5: Inspect the final diff**

Run: `git status --short && git diff --check && git log --oneline --decorate -6`

Expected: no whitespace errors; only planned files changed; commits correspond to Tasks 1-5 plus docs.

- [ ] **Step 6: Commit documentation**

```bash
git add README.md scripts/verify-extension-build.mjs docs/superpowers/specs/2026-07-17-outlook-recruiting-feishu-monitor-design.md docs/superpowers/plans/2026-07-18-outlook-recruiting-feishu-monitor.md
git commit -m "docs: add Outlook Feishu monitor setup"
```

