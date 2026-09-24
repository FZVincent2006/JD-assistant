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

cd "$ROOT_DIR"
npm test
npm run build

rm -rf "$PACKAGE_DIR" "$ZIP_PATH"
mkdir -p "$PACKAGE_DIR/扩展" "$PACKAGE_DIR/skills/jd-skill"
/usr/bin/ditto "$ROOT_DIR/dist" "$PACKAGE_DIR/扩展"
/usr/bin/ditto "$ROOT_DIR/skills/jd-skill" "$PACKAGE_DIR/skills/jd-skill"
install -m 0644 "$ROOT_DIR/distribution/安装说明.md" "$PACKAGE_DIR/安装说明.md"

EXTENSION_ID="$(node "$ROOT_DIR/scripts/extension-id.mjs" "$PACKAGE_DIR/扩展/manifest.json")"
EXTENSION_VERSION="$(node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(m.version)' "$PACKAGE_DIR/扩展/manifest.json")"
GIT_COMMIT="$(git rev-parse HEAD)"
node "$ROOT_DIR/scripts/create-distribution-metadata.mjs" \
  "$PACKAGE_DIR" "$EXTENSION_ID" "$EXTENSION_VERSION" "$GIT_COMMIT" "$BUILD_DATE"
node "$ROOT_DIR/scripts/verify-colleague-distribution.mjs" "$PACKAGE_DIR"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$PACKAGE_DIR" "$ZIP_PATH"

printf '%s\n' "Distribution package: $PACKAGE_DIR"
printf '%s\n' "Distribution archive: $ZIP_PATH"
printf '%s\n' "Fixed extension ID: $EXTENSION_ID"
