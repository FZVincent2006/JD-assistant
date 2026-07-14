#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DATE="${BUILD_DATE:-$(/bin/date -u +%Y%m%d)}"
[[ "$BUILD_DATE" =~ ^[0-9]{8}$ ]] || {
  printf '%s\n' "BUILD_DATE must use YYYYMMDD." >&2
  exit 2
}
PACKAGE_NAME="招聘JD发布助手-macOS-$BUILD_DATE"
ZIP_NAME="JD-assistant-macOS-$BUILD_DATE.zip"
RELEASE_DIR="$ROOT_DIR/release"
PACKAGE_DIR="$RELEASE_DIR/$PACKAGE_NAME"
ZIP_PATH="$RELEASE_DIR/$ZIP_NAME"
HELPER_APP="$ROOT_DIR/native-helper/.build/universal/Feishu JD Assistant Helper.app"

cd "$ROOT_DIR"
npm test
VITE_FEISHU_AUTH_MODE=native npm run build
"$ROOT_DIR/scripts/build-feishu-auth-helper.sh"

rm -rf "$PACKAGE_DIR" "$ZIP_PATH"
mkdir -p "$PACKAGE_DIR/原生助手" "$PACKAGE_DIR/scripts"
/usr/bin/ditto "$ROOT_DIR/dist" "$PACKAGE_DIR/扩展"
/usr/bin/ditto "$HELPER_APP" "$PACKAGE_DIR/原生助手/Feishu JD Assistant Helper.app"
install -m 0755 "$ROOT_DIR/scripts/install-feishu-auth-helper.sh" "$PACKAGE_DIR/scripts/install-feishu-auth-helper.sh"
install -m 0755 "$ROOT_DIR/distribution/安装飞书授权助手.command" "$PACKAGE_DIR/安装飞书授权助手.command"
install -m 0644 "$ROOT_DIR/distribution/安装说明.md" "$PACKAGE_DIR/安装说明.md"

EXTENSION_ID="$(node "$ROOT_DIR/scripts/extension-id.mjs" "$PACKAGE_DIR/扩展/manifest.json")"
EXTENSION_VERSION="$(node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(m.version)' "$PACKAGE_DIR/扩展/manifest.json")"
GIT_COMMIT="$(git rev-parse HEAD)"
node "$ROOT_DIR/scripts/create-distribution-metadata.mjs" \
  "$PACKAGE_DIR" "$EXTENSION_ID" "$EXTENSION_VERSION" "$GIT_COMMIT" "$BUILD_DATE"
node "$ROOT_DIR/scripts/verify-colleague-distribution.mjs" "$PACKAGE_DIR"
/usr/bin/codesign --verify --strict "$PACKAGE_DIR/原生助手/Feishu JD Assistant Helper.app"
/usr/bin/xcrun lipo \
  "$PACKAGE_DIR/原生助手/Feishu JD Assistant Helper.app/Contents/MacOS/feishu-auth-host" \
  -verify_arch arm64 x86_64
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$PACKAGE_DIR" "$ZIP_PATH"

printf '%s\n' "Distribution package: $PACKAGE_DIR"
printf '%s\n' "Distribution archive: $ZIP_PATH"
printf '%s\n' "Fixed extension ID: $EXTENSION_ID"
