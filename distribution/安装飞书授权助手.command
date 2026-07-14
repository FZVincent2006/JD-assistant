#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_ID="$(awk -F= '$1 == "EXTENSION_ID" { print $2 }' "$ROOT_DIR/VERSION.txt")"

if [[ ! "$EXTENSION_ID" =~ ^[a-p]{32}$ ]]; then
  printf '%s\n' "安装包中的扩展 ID 无效，请停止安装。" >&2
  read -r -p "按回车关闭窗口。" _
  exit 1
fi

FEISHU_HELPER_APP_PATH="$ROOT_DIR/原生助手/Feishu JD Assistant Helper.app" \
  "$ROOT_DIR/scripts/install-feishu-auth-helper.sh" \
  --keep-existing-secret \
  "chrome-extension://$EXTENSION_ID/"

printf '%s\n' "授权助手安装完成。请完全退出并重新打开 Chrome 或 Edge。"
read -r -p "按回车关闭窗口。" _
