#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CHANNEL_PATH="$ROOT_DIR/distribution/release-channel.json"
FIXED_REPOSITORY="FZVincent2006/JD-assistant"
FIXED_EXTENSION_ID="mlhjjkclfiocgafhjdhoicghiabkeggg"
APP_ID="cli_aade4224b8789bef"
INSTALL_PARENT="$HOME/Library/Application Support/ZhenFund JD Assistant"
EXTENSION_DIR="$INSTALL_PARENT/Extension"

usage() {
  printf '%s\n' \
    "Usage: $0 [--dry-run] [--browser auto|chrome|edge] [--package /absolute/package.zip] [--replace-secret]" >&2
  exit 2
}

fail_usage() {
  printf '%s\n' "$1" >&2
  exit 2
}

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

channel_field() {
  /usr/bin/plutil -extract "$1" raw -o - "$CHANNEL_PATH" 2>/dev/null \
    || fail "Invalid release channel field: $1"
}

test_flag() {
  local name="$1"
  local fallback="$2"
  local value="$fallback"
  if [[ "${JD_ASSISTANT_TEST_MODE:-0}" == "1" ]]; then
    eval "value=\${$name:-$fallback}"
  fi
  [[ "$value" == "0" || "$value" == "1" ]] || fail_usage "Invalid test browser state."
  printf '%s' "$value"
}

select_browser() {
  local requested="$1"
  local running_chrome="$2"
  local running_edge="$3"
  local installed_chrome="$4"
  local installed_edge="$5"

  if [[ "$requested" == "chrome" ]]; then
    [[ "$installed_chrome" == "1" ]] || fail_usage "Google Chrome is not installed."
    printf '%s' "chrome"
    return
  fi
  if [[ "$requested" == "edge" ]]; then
    [[ "$installed_edge" == "1" ]] || fail_usage "Microsoft Edge is not installed."
    printf '%s' "edge"
    return
  fi

  if [[ "$running_chrome" == "1" && "$running_edge" == "0" ]]; then
    printf '%s' "chrome"
    return
  fi
  if [[ "$running_chrome" == "0" && "$running_edge" == "1" ]]; then
    printf '%s' "edge"
    return
  fi
  if [[ "$running_chrome" == "1" && "$running_edge" == "1" ]]; then
    fail_usage "Both Chrome and Edge are running; rerun with --browser chrome or --browser edge."
  fi
  if [[ "$installed_chrome" == "1" && "$installed_edge" == "0" ]]; then
    printf '%s' "chrome"
    return
  fi
  if [[ "$installed_chrome" == "0" && "$installed_edge" == "1" ]]; then
    printf '%s' "edge"
    return
  fi
  if [[ "$installed_chrome" == "1" && "$installed_edge" == "1" ]]; then
    fail_usage "Chrome and Edge are both installed; rerun with --browser chrome or --browser edge."
  fi
  fail_usage "Install Chrome or Edge before running this installer."
}

version_at_least() {
  local actual="$1"
  local minimum="$2"
  local actual_major actual_minor minimum_major minimum_minor
  actual_major="${actual%%.*}"
  actual_minor="${actual#*.}"
  actual_minor="${actual_minor%%.*}"
  minimum_major="${minimum%%.*}"
  minimum_minor="${minimum#*.}"
  minimum_minor="${minimum_minor%%.*}"
  [[ "$actual_major" =~ ^[0-9]+$ && "$actual_minor" =~ ^[0-9]+$ ]] || return 1
  [[ "$minimum_major" =~ ^[0-9]+$ && "$minimum_minor" =~ ^[0-9]+$ ]] || return 1
  (( actual_major > minimum_major || (actual_major == minimum_major && actual_minor >= minimum_minor) ))
}

DRY_RUN=0
BROWSER_REQUEST="auto"
PACKAGE_PATH=""
REPLACE_SECRET=0

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --browser)
      [[ "$#" -ge 2 ]] || usage
      BROWSER_REQUEST="$2"
      shift 2
      ;;
    --package)
      [[ "$#" -ge 2 ]] || usage
      PACKAGE_PATH="$2"
      shift 2
      ;;
    --replace-secret)
      REPLACE_SECRET=1
      shift
      ;;
    *)
      usage
      ;;
  esac
done

[[ "$BROWSER_REQUEST" == "auto" || "$BROWSER_REQUEST" == "chrome" || "$BROWSER_REQUEST" == "edge" ]] \
  || usage

SYSTEM_NAME="$(/usr/bin/uname -s)"
if [[ "${JD_ASSISTANT_TEST_MODE:-0}" == "1" && -n "${JD_ASSISTANT_UNAME:-}" ]]; then
  SYSTEM_NAME="$JD_ASSISTANT_UNAME"
fi
[[ "$SYSTEM_NAME" == "Darwin" ]] || fail_usage "This installer supports macOS only."

[[ -f "$CHANNEL_PATH" ]] || fail "Release channel is missing."
SCHEMA_VERSION="$(channel_field schemaVersion)"
REPOSITORY="$(channel_field repository)"
RELEASE_TAG="$(channel_field tag)"
ASSET_NAME="$(channel_field assetName)"
ASSET_URL="$(channel_field assetUrl)"
EXPECTED_SHA256="$(channel_field sha256)"
CHANNEL_EXTENSION_ID="$(channel_field extensionId)"
EXTENSION_VERSION="$(channel_field extensionVersion)"
BUILD_COMMIT="$(channel_field buildCommit)"
MINIMUM_MACOS="$(channel_field minimumMacOS)"

[[ "$SCHEMA_VERSION" == "1" ]] || fail "Unsupported release channel schema."
[[ "$REPOSITORY" == "$FIXED_REPOSITORY" ]] || fail "Unexpected release repository."
[[ "$RELEASE_TAG" =~ ^v[0-9A-Za-z][0-9A-Za-z._-]*$ ]] || fail "Invalid release tag."
[[ "$ASSET_NAME" =~ ^JD-assistant-macOS-[0-9]{8}\.zip$ ]] || fail "Invalid release asset name."
EXPECTED_URL="https://github.com/$FIXED_REPOSITORY/releases/download/$RELEASE_TAG/$ASSET_NAME"
[[ "$ASSET_URL" == "$EXPECTED_URL" ]] || fail "Unexpected release asset URL."
[[ "$EXPECTED_SHA256" =~ ^[0-9a-f]{64}$ ]] || fail "Invalid release SHA-256."
[[ "$CHANNEL_EXTENSION_ID" == "$FIXED_EXTENSION_ID" ]] || fail "Unexpected extension ID."
[[ "$EXTENSION_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Invalid extension version."
[[ "$BUILD_COMMIT" =~ ^[0-9a-f]{40}$ ]] || fail "Invalid build commit."
[[ "$MINIMUM_MACOS" =~ ^[0-9]+\.[0-9]+$ ]] || fail "Invalid macOS floor."

CURRENT_MACOS="$(/usr/bin/sw_vers -productVersion)"
version_at_least "$CURRENT_MACOS" "$MINIMUM_MACOS" \
  || fail_usage "macOS $MINIMUM_MACOS or newer is required."

if [[ "${JD_ASSISTANT_TEST_MODE:-0}" == "1" ]]; then
  INSTALLED_CHROME="$(test_flag JD_ASSISTANT_INSTALLED_CHROME 0)"
  INSTALLED_EDGE="$(test_flag JD_ASSISTANT_INSTALLED_EDGE 0)"
  RUNNING_CHROME="$(test_flag JD_ASSISTANT_RUNNING_CHROME 0)"
  RUNNING_EDGE="$(test_flag JD_ASSISTANT_RUNNING_EDGE 0)"
else
  INSTALLED_CHROME=0
  INSTALLED_EDGE=0
  RUNNING_CHROME=0
  RUNNING_EDGE=0
  [[ -d "/Applications/Google Chrome.app" || -d "$HOME/Applications/Google Chrome.app" ]] \
    && INSTALLED_CHROME=1
  [[ -d "/Applications/Microsoft Edge.app" || -d "$HOME/Applications/Microsoft Edge.app" ]] \
    && INSTALLED_EDGE=1
  /usr/bin/pgrep -x "Google Chrome" >/dev/null 2>&1 && RUNNING_CHROME=1 || true
  /usr/bin/pgrep -x "Microsoft Edge" >/dev/null 2>&1 && RUNNING_EDGE=1 || true
fi

BROWSER="$(select_browser \
  "$BROWSER_REQUEST" "$RUNNING_CHROME" "$RUNNING_EDGE" "$INSTALLED_CHROME" "$INSTALLED_EDGE")"

if [[ "$DRY_RUN" -eq 1 ]]; then
  printf '%s\n' \
    "STATUS=planned" \
    "RELEASE_TAG=$RELEASE_TAG" \
    "BROWSER=$BROWSER" \
    "EXTENSION_ID=$FIXED_EXTENSION_ID" \
    "EXTENSION_DIR=$EXTENSION_DIR"
  exit 0
fi

fail "Installation execution is not implemented yet."
