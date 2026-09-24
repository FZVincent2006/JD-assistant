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
- [ ] Task 3: distribution tooling and JD Skill retention.
- [ ] Task 4: operator documentation and full verification.

## Validation record
- Pending.

## Plan adjustments
- Kept the `webNavigation` permission. `fillPage.js` calls `webNavigation.getAllFrames()` for Boss iframe filling and diagnostics; removing it would violate the approved requirement to retain iframe fallback. This is the only additional permission beyond activeTab, scripting, sidePanel, and tabs.
