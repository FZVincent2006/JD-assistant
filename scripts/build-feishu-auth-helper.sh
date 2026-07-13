#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HELPER_DIR="$ROOT_DIR/native-helper"
OUTPUT_DIR="$HELPER_DIR/.build/universal"
OUTPUT_BINARY="$OUTPUT_DIR/feishu-auth-host"

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
