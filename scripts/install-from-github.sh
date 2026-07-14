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
    case "$name" in
      JD_ASSISTANT_INSTALLED_CHROME) value="${JD_ASSISTANT_INSTALLED_CHROME:-$fallback}" ;;
      JD_ASSISTANT_INSTALLED_EDGE) value="${JD_ASSISTANT_INSTALLED_EDGE:-$fallback}" ;;
      JD_ASSISTANT_RUNNING_CHROME) value="${JD_ASSISTANT_RUNNING_CHROME:-$fallback}" ;;
      JD_ASSISTANT_RUNNING_EDGE) value="${JD_ASSISTANT_RUNNING_EDGE:-$fallback}" ;;
      *) fail_usage "Unknown test browser state." ;;
    esac
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

version_value() {
  local key="$1"
  local value
  value="$(/usr/bin/awk -F= -v key="$key" '
    $1 == key {
      count += 1
      value = substr($0, length($1) + 2)
    }
    END {
      if (count != 1) exit 2
      print value
    }
  ' "$VERSION_FILE")" || fail "Invalid package VERSION.txt field: $key"
  printf '%s' "$value"
}

verify_package_files() {
  local actual_files="$WORK_DIR/actual-files.txt"
  local expected_files="$WORK_DIR/expected-files.txt"

  (
    cd "$PACKAGE_ROOT"
    /usr/bin/find . -type f ! -path './SHA256SUMS.txt' -print \
      | /usr/bin/sed 's#^\./##' \
      | LC_ALL=C /usr/bin/sort
  ) > "$actual_files"
  /usr/bin/cut -c67- "$PACKAGE_ROOT/SHA256SUMS.txt" \
    | LC_ALL=C /usr/bin/sort > "$expected_files"
  /usr/bin/cmp -s "$actual_files" "$expected_files" \
    || fail "Package file checksums do not match the package contents."

  if ! (
    cd "$PACKAGE_ROOT"
    /usr/bin/shasum -a 256 -c SHA256SUMS.txt >/dev/null
  ); then
    fail "Package file checksums do not match."
  fi
}

promote_extension() {
  local staging_extension="$1"
  local receipt_staging="$2"
  local previous_extension="$INSTALL_PARENT/Extension.previous"
  local receipt_path="$INSTALL_PARENT/install-receipt.json"
  local had_current=0

  /bin/rm -rf "$previous_extension"
  if [[ -e "$EXTENSION_DIR" ]]; then
    /bin/mv "$EXTENSION_DIR" "$previous_extension"
    had_current=1
  fi

  if ! /bin/mv "$staging_extension" "$EXTENSION_DIR"; then
    if [[ "$had_current" -eq 1 && -e "$previous_extension" ]]; then
      /bin/mv "$previous_extension" "$EXTENSION_DIR"
    fi
    fail "Could not promote the verified extension."
  fi

  if ! /bin/mv "$receipt_staging" "$receipt_path"; then
    /bin/rm -rf "$EXTENSION_DIR"
    if [[ "$had_current" -eq 1 && -e "$previous_extension" ]]; then
      /bin/mv "$previous_extension" "$EXTENSION_DIR"
    fi
    fail "Could not write the installation receipt."
  fi
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

WORK_DIR="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/jd-assistant-install.XXXXXX")"
trap '/bin/rm -rf "$WORK_DIR"' EXIT
ARCHIVE_PATH="$WORK_DIR/package.zip"

if [[ -n "$PACKAGE_PATH" ]]; then
  [[ "$PACKAGE_PATH" == /* ]] || fail "--package requires an absolute path."
  [[ -f "$PACKAGE_PATH" ]] || fail "Local package does not exist."
  /bin/cp "$PACKAGE_PATH" "$ARCHIVE_PATH"
else
  /usr/bin/curl --fail --location --proto '=https' --tlsv1.2 \
    --output "$ARCHIVE_PATH" "$ASSET_URL" \
    || fail "Could not download the pinned GitHub Release asset."
fi

ACTUAL_OUTER_SHA256="$(/usr/bin/shasum -a 256 "$ARCHIVE_PATH" | /usr/bin/awk '{print $1}')"
[[ "$ACTUAL_OUTER_SHA256" == "$EXPECTED_SHA256" ]] \
  || fail "Outer package SHA-256 mismatch."

EXTRACT_DIR="$WORK_DIR/extracted"
/bin/mkdir -p "$EXTRACT_DIR"
/usr/bin/ditto -x -k "$ARCHIVE_PATH" "$EXTRACT_DIR" \
  || fail "Could not extract the verified package."

VERSION_FILES=()
while IFS= read -r -d '' candidate; do
  VERSION_FILES+=("$candidate")
done < <(/usr/bin/find "$EXTRACT_DIR" -type f -name VERSION.txt -print0)
[[ "${#VERSION_FILES[@]}" -eq 1 ]] \
  || fail "Package must contain exactly one VERSION.txt."
VERSION_FILE="${VERSION_FILES[0]}"
PACKAGE_ROOT="$(cd "$(dirname "$VERSION_FILE")" && pwd)"

REQUIRED_FILES=(
  "扩展/manifest.json"
  "扩展/background.js"
  "原生助手/Feishu JD Assistant Helper.app/Contents/MacOS/feishu-auth-host"
  "scripts/install-feishu-auth-helper.sh"
  "安装飞书授权助手.command"
  "安装说明.md"
  "VERSION.txt"
  "SHA256SUMS.txt"
)
for relative_path in "${REQUIRED_FILES[@]}"; do
  [[ -f "$PACKAGE_ROOT/$relative_path" ]] \
    || fail "Required package file is missing: $relative_path"
done
for executable_path in \
  "原生助手/Feishu JD Assistant Helper.app/Contents/MacOS/feishu-auth-host" \
  "scripts/install-feishu-auth-helper.sh" \
  "安装飞书授权助手.command"; do
  [[ -x "$PACKAGE_ROOT/$executable_path" ]] \
    || fail "Required package entry is not executable: $executable_path"
done

verify_package_files

PACKAGE_EXTENSION_ID="$(version_value EXTENSION_ID)"
PACKAGE_EXTENSION_VERSION="$(version_value EXTENSION_VERSION)"
PACKAGE_REDIRECT_URL="$(version_value REDIRECT_URL)"
PACKAGE_BUILD_COMMIT="$(version_value GIT_COMMIT)"
[[ "$PACKAGE_EXTENSION_ID" == "$FIXED_EXTENSION_ID" ]] \
  || fail "Package extension ID does not match the fixed extension ID."
[[ "$PACKAGE_EXTENSION_VERSION" == "$EXTENSION_VERSION" ]] \
  || fail "Package extension version does not match the release channel."
[[ "$PACKAGE_REDIRECT_URL" == "https://$FIXED_EXTENSION_ID.chromiumapp.org/feishu" ]] \
  || fail "Package redirect URL does not match the fixed extension ID."
[[ "$PACKAGE_BUILD_COMMIT" == "$BUILD_COMMIT" ]] \
  || fail "Package build commit does not match the release channel."
MANIFEST_VERSION="$(/usr/bin/plutil -extract version raw -o - "$PACKAGE_ROOT/扩展/manifest.json" 2>/dev/null)" \
  || fail "Package extension manifest is invalid."
[[ "$MANIFEST_VERSION" == "$EXTENSION_VERSION" ]] \
  || fail "Package manifest version does not match the release channel."

HELPER_ARGS=()
if [[ "$REPLACE_SECRET" -eq 0 ]]; then
  HELPER_ARGS+=("--keep-existing-secret")
fi
HELPER_ARGS+=("chrome-extension://$FIXED_EXTENSION_ID/")
FEISHU_HELPER_APP_PATH="$PACKAGE_ROOT/原生助手/Feishu JD Assistant Helper.app" \
  "$PACKAGE_ROOT/scripts/install-feishu-auth-helper.sh" "${HELPER_ARGS[@]}"

/bin/mkdir -p "$INSTALL_PARENT"
STAGING_EXTENSION="$INSTALL_PARENT/.Extension.new"
STAGING_RECEIPT="$INSTALL_PARENT/.install-receipt.new"
/bin/rm -rf "$STAGING_EXTENSION"
/usr/bin/ditto "$PACKAGE_ROOT/扩展" "$STAGING_EXTENSION"
INSTALLED_AT="$(/bin/date -u '+%Y-%m-%dT%H:%M:%SZ')"
printf '{\n  "releaseTag": "%s",\n  "extensionVersion": "%s",\n  "extensionId": "%s",\n  "buildCommit": "%s",\n  "installedAt": "%s"\n}\n' \
  "$RELEASE_TAG" "$EXTENSION_VERSION" "$FIXED_EXTENSION_ID" "$BUILD_COMMIT" "$INSTALLED_AT" \
  > "$STAGING_RECEIPT"

promote_extension "$STAGING_EXTENSION" "$STAGING_RECEIPT"

if [[ "${JD_ASSISTANT_NO_OPEN:-0}" == "1" ]]; then
  [[ "${JD_ASSISTANT_TEST_MODE:-0}" == "1" ]] \
    || fail "JD_ASSISTANT_NO_OPEN is test-only."
else
  if [[ "$BROWSER" == "chrome" ]]; then
    /usr/bin/open -a "Google Chrome" "chrome://extensions/"
  else
    /usr/bin/open -a "Microsoft Edge" "edge://extensions/"
  fi
fi

printf '%s\n' \
  "STATUS=browser_confirmation_required" \
  "RELEASE_TAG=$RELEASE_TAG" \
  "BROWSER=$BROWSER" \
  "EXTENSION_ID=$FIXED_EXTENSION_ID" \
  "EXTENSION_DIR=$EXTENSION_DIR"
