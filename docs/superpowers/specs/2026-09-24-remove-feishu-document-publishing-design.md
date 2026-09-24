# Reduce Extension to Boss and Maimai Filling

## Goal

Reduce the browser extension to JD parsing and assisted field filling for Boss
and Maimai. The Feishu recruitment document format has changed and the existing
writer can no longer safely maintain it. Outlook delivery monitoring is also no
longer needed.

## Retained Features

- JD parsing and browser-assisted field filling for Boss and Maimai.
- The `jd-skill` installation script and its fixed JD text output format.

## Removed Surface

- The Feishu Document tab, parsing preview, authorization controls, write-plan
  generation, document scanning, document writing, validation, and historical
  Portfolio-link repair.
- The Outlook reminder tab, mailbox scanning, notification queues, webhook and
  application-bot delivery, and all candidate-mail parsing.
- The native messaging helper, its Keychain App Secret storage, OAuth token
  exchange, and all packaging/install scripts that exist solely for document
  publishing.
- The formal recruitment-document URL, Feishu document scopes, fixed OAuth
  redirect handling, and documentation referring to document writes.

## Architecture Changes

The side panel will expose only Boss and Maimai modes. The background service
worker will be removed if it has no remaining responsibility. All Feishu
document and Outlook modules, along with their associated tests, will be
deleted. The manifest will retain only the permissions and host matches required
for Boss and Maimai page filling.

The macOS colleague installer, Native Messaging helper, and related distribution
artifacts will be removed because the retained browser-only functionality does
not need them. Release documentation will instead describe loading the packaged
or locally built extension into Chrome or Edge.

## Security and Privacy

The reduced extension will not access Feishu or Outlook, request authentication,
store secrets, scan email, or process candidate attachments. It will retain only
the browser permissions necessary to access the active Boss or Maimai tab and
fill the user-reviewed fields. The independent `jd-skill` remains in the
repository and continues to be installable with `scripts/install-jd-skill.sh`.

## Verification

- Add focused tests proving the side panel exposes only Boss and Maimai and the
  manifest contains no Feishu, Outlook, Native Messaging, download, identity,
  storage, alarm, or notification capability.
- Remove tests that cover deleted document-writing and Outlook behavior.
- Run the complete Node test suite and production build.
- Verify installation and release documentation describe only the retained
  browser extension and the independent JD Skill.
