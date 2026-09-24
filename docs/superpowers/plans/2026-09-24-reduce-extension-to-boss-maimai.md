# Reduce Extension to Boss and Maimai

## Goal

Keep JD parsing, reviewed field filling, diagnostics, iframe fallback, and click recording for Boss and Maimai. Retain the independent `jd-skill`. Remove the obsolete formal recruitment document workflow and Outlook reminders.

## Completed

- [x] Reduce side panel to Boss and Maimai, and remove document write UI and message routes.
- [x] Remove service worker, document and mail modules, related tests, and obsolete manifest permissions/hosts.
- [x] Remove native helper, helper installers, and helper packaging. Keep the extension ID key and normal extension install path stable.
- [x] Keep `scripts/install-jd-skill.sh` unchanged and include Skill source in colleague packages.
- [x] Rewrite operator, install, and distribution documentation; clearly state publication remains manual.
- [x] Add UI, manifest, distribution, and documentation regression tests.
- [x] Run the complete tests and build; inspect distribution scope.

## Permission Decision

The manifest retains `webNavigation` in addition to `activeTab`, `scripting`, `sidePanel`, and `tabs`. `src/sidepanel/fillPage.js` calls `webNavigation.getAllFrames()` for Boss iframe filling and page diagnostics; dropping the permission would break explicitly retained behavior.

## Release Note

The repository's release channel still pins the previously published artifact. A maintainer must build, verify, and publish a new release, then update `distribution/release-channel.json`; do not treat the old pinned release as containing these changes.
