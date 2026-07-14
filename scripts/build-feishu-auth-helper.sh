#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HELPER_DIR="$ROOT_DIR/native-helper"
OUTPUT_DIR="$HELPER_DIR/.build/universal"
OUTPUT_BINARY="$OUTPUT_DIR/feishu-auth-host"
APP_BUNDLE="$OUTPUT_DIR/Feishu JD Assistant Helper.app"
APP_BINARY="$APP_BUNDLE/Contents/MacOS/feishu-auth-host"

cd "$HELPER_DIR"
swift run feishu-auth-host-tests
swift build -c release --arch arm64 --product feishu-auth-host
swift build -c release --arch x86_64 --product feishu-auth-host

ARM_BINARY="$HELPER_DIR/.build/arm64-apple-macosx/release/feishu-auth-host"
INTEL_BINARY="$HELPER_DIR/.build/x86_64-apple-macosx/release/feishu-auth-host"
test -x "$ARM_BINARY"
test -x "$INTEL_BINARY"

mkdir -p "$OUTPUT_DIR"
xcrun lipo -create "$ARM_BINARY" "$INTEL_BINARY" -output "$OUTPUT_BINARY"
chmod 0700 "$OUTPUT_BINARY"
xcrun lipo "$OUTPUT_BINARY" -verify_arch arm64 x86_64
xcrun lipo "$OUTPUT_BINARY" -info

rm -rf "$APP_BUNDLE"
mkdir -p "$(dirname "$APP_BINARY")"
install -m 0700 "$OUTPUT_BINARY" "$APP_BINARY"
install -m 0600 "$HELPER_DIR/Resources/Info.plist" "$APP_BUNDLE/Contents/Info.plist"
codesign --force --sign - --identifier cn.zhenfund.jd-assistant.feishu-helper "$APP_BUNDLE"
codesign --verify --strict "$APP_BUNDLE"
xcrun lipo "$APP_BINARY" -verify_arch arm64 x86_64
