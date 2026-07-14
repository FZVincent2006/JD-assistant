#!/usr/bin/env bash
set -euo pipefail

HOST_NAME="cn.zhenfund.jd_assistant.feishu_auth"
APP_ID="cli_aade4224b8789bef"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_BINARY="$ROOT_DIR/native-helper/.build/universal/feishu-auth-host"
INSTALL_DIR="$HOME/Library/Application Support/ZhenFund JD Assistant"
INSTALL_BINARY="$INSTALL_DIR/feishu-auth-host"
CHROME_MANIFEST="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/$HOST_NAME.json"
EDGE_MANIFEST="$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts/$HOST_NAME.json"

usage() {
  printf '%s\n' "Usage: $0 [--dry-run] chrome-extension://<32-letter-id>/ [...]" >&2
  printf '%s\n' "       $0 --uninstall [--delete-secret]" >&2
  exit 2
}

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  printf '%s' "$value"
}

render_origins() {
  local first=1
  local origin
  printf '['
  for origin in "${ORIGINS[@]}"; do
    if [[ "$first" -eq 0 ]]; then printf ','; fi
    printf '"%s"' "$(json_escape "$origin")"
    first=0
  done
  printf ']'
}

render_manifest() {
  local origins_json
  origins_json="$(render_origins)"
  printf '{"name":"%s","description":"ZhenFund JD Assistant Feishu authorization host","path":"%s","type":"stdio","allowed_origins":%s}' \
    "$HOST_NAME" "$(json_escape "$INSTALL_BINARY")" "$origins_json"
}

MODE="install"
DELETE_SECRET=0
if [[ "${1:-}" == "--dry-run" ]]; then
  MODE="dry-run"
  shift
elif [[ "${1:-}" == "--uninstall" ]]; then
  MODE="uninstall"
  shift
  if [[ "${1:-}" == "--delete-secret" ]]; then
    DELETE_SECRET=1
    shift
  fi
  [[ "$#" -eq 0 ]] || usage
fi

if [[ "$MODE" == "uninstall" ]]; then
  if [[ "$DELETE_SECRET" -eq 1 ]]; then
    if [[ -x "$INSTALL_BINARY" ]]; then
      "$INSTALL_BINARY" --delete-secret --app-id "$APP_ID"
    elif [[ -x "$SOURCE_BINARY" ]]; then
      "$SOURCE_BINARY" --delete-secret --app-id "$APP_ID"
    fi
  fi
  rm -f "$CHROME_MANIFEST" "$EDGE_MANIFEST" "$INSTALL_BINARY"
  exit 0
fi

[[ "$#" -gt 0 ]] || usage
ORIGINS=()
for candidate in "$@"; do
  [[ "$candidate" =~ ^chrome-extension://[a-p]{32}/$ ]] || usage
  duplicate=0
  for existing in "${ORIGINS[@]:-}"; do
    if [[ "$existing" == "$candidate" ]]; then duplicate=1; fi
  done
  if [[ "$duplicate" -eq 0 ]]; then ORIGINS+=("$candidate"); fi
done

MANIFEST_JSON="$(render_manifest)"
if [[ "$MODE" == "dry-run" ]]; then
  printf '{"manifests":[%s,%s]}\n' "$MANIFEST_JSON" "$MANIFEST_JSON"
  exit 0
fi

[[ -x "$SOURCE_BINARY" ]] || {
  printf '%s\n' "Native helper is not built. Run scripts/build-feishu-auth-helper.sh first." >&2
  exit 1
}

mkdir -p "$INSTALL_DIR" "$(dirname "$CHROME_MANIFEST")" "$(dirname "$EDGE_MANIFEST")"
install -m 0700 "$SOURCE_BINARY" "$INSTALL_BINARY"
printf '%s\n' "$MANIFEST_JSON" > "$CHROME_MANIFEST"
printf '%s\n' "$MANIFEST_JSON" > "$EDGE_MANIFEST"
chmod 0600 "$CHROME_MANIFEST" "$EDGE_MANIFEST"

printf '%s\n' "Paste the Feishu App Secret, then press Return (input is hidden):" >&2
"$INSTALL_BINARY" --configure-secret --app-id "$APP_ID" < /dev/tty
if ! "$INSTALL_BINARY" --check-accessibility; then
  printf '%s\n' "Requesting macOS Accessibility permission for feishu-auth-host..." >&2
  "$INSTALL_BINARY" --request-accessibility || true
fi
if "$INSTALL_BINARY" --check-accessibility; then
  printf '%s\n' "macOS Accessibility permission is enabled." >&2
else
  printf '%s\n' "Enable feishu-auth-host in System Settings > Privacy & Security > Accessibility, then retry." >&2
fi
printf '%s\n' "Feishu authorization helper installed for Chrome and Edge." >&2
