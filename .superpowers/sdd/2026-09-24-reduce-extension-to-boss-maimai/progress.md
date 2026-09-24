# SDD ledger — plan: docs/superpowers/plans/2026-09-24-reduce-extension-to-boss-maimai.md

## Decisions
- Keep the JD Skill source and its installer unchanged.
- Preserve Boss/Maimai parsing, fill, diagnostics, click recording, and manual publication.
- Remove Feishu publishing/authentication, Outlook monitoring, and native helper functionality.
- Implement in an isolated worktree on `codex/reduce-to-boss-maimai`.
- Final review will be self-review because no subagent tool is available in this session.

## Progress
- [x] Plan approved; isolated worktree and implementation branch ready.
- [x] Task 1: UI and message surface. Focused verification: 9 tests passed.
- [x] Task 2: backend modules, manifest, and build entries. Focused verification: 53 tests passed.
- [x] Task 3: distribution tooling and JD Skill retention. Focused verification: 16 tests passed; production build passed.
- [x] Task 4: operator documentation and full verification. Full verification: 92 tests passed; build and distribution package verification passed.

## Validation record
- `npx vitest run tests/sidepanelReduction.test.js tests/fillPage.test.js`: 9 passed.
- `npx vitest run tests/manifestReduction.test.js tests/formFiller.test.js tests/jdParser.test.js`: 53 passed.
- `npx vitest run tests/distributionReduction.test.js tests/codexInstaller.test.js tests/legacyIntegrity.test.js`: 16 passed.
- `npm test`: 14 files, 92 tests passed.
- `npm run build`: passed; output contains `dist/index.html`, `dist/content.js`, assets, and no background/Outlook bundle.
- `BUILD_DATE=20260924 scripts/build-colleague-distribution.sh`: passed; package verifier confirmed extension ID `mlhjjkclfiocgafhjdhoicghiabkeggg` and package checksums.

## Plan adjustments
- Kept the `webNavigation` permission. `fillPage.js` calls `webNavigation.getAllFrames()` for Boss iframe filling and diagnostics; removing it would violate the approved requirement to retain iframe fallback. This is the only additional permission beyond activeTab, scripting, sidePanel, and tabs.
- Ruling: Updated the release guide but left `distribution/release-channel.json` pinned to the existing published artifact; its metadata cannot be replaced with an unpublished asset/commit. The guide explicitly says to build, publish, then update the pin, and warns not to use the older artifact as these changes.
- Ruling: Deleted the obsolete July acceptance report and orphaned Outlook UI test, and removed dead monitor CSS after final repository scans found them; retaining them would leave misleading handover material or unused UI styling.

## Final review
- Self-review performed against the approved spec/plan and final diff. No independent reviewer tool was available in this session.
- Package scan found no removed platform/helper references in `dist/` or generated distribution contents. Guard tests intentionally mention removed feature names to ensure they stay absent.
- `git diff --check`: clean.
