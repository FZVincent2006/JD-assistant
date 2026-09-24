# Recruitment Extension Scope Reduction

## Context

The formal recruitment document format has changed, so the extension's existing writer is no longer applicable. Outlook reminders are also no longer part of the workflow.

## Product Scope

The extension supports parsing a pasted JD and assisting with form entry on Boss and Maimai. It retains field editing, diagnostics, click recording, and Boss iframe fallback. Users review the populated form and publish it themselves.

The repository also retains `skills/jd-skill` as a standalone Codex Skill. Its output format and installation script remain unchanged.

## Architecture

- Side panel platform state is limited to `boss` and `maimai`.
- The extension has one content script for the recruiting platform hosts and no background service worker.
- The manifest keeps `activeTab`, `scripting`, `sidePanel`, `tabs`, and `webNavigation`; the last is required for `webNavigation.getAllFrames()` used by Boss iframe fallback and diagnostics.
- No document publishing, authentication, mail scanning, reminder delivery, or native helper code is packaged.
- Distribution contains the extension, JD Skill source, user guide, version metadata, and checksums.

## Verification

- Automated tests cover the two-platform UI, retained form filling and parsing, manifest permissions and hosts, distribution contents, and public documentation.
- `npm test` and `npm run build` must pass.
- The built extension must contain `dist/index.html`, `dist/content.js`, and static assets, with no background or mail-monitor bundle.
- `scripts/install-jd-skill.sh` remains unchanged.

## Release Boundary

`distribution/release-channel.json` pins an already published artifact. After this change is published, maintainers must build and verify a new package and update the release channel. The existing pinned release does not include unreleased source changes.
