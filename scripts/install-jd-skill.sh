#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SOURCE_DIR="${REPO_ROOT}/skills/jd-skill"
CODEX_HOME="${CODEX_HOME:-${HOME}/.codex}"
TARGET_ROOT="${CODEX_HOME}/skills"
TARGET_DIR="${TARGET_ROOT}/jd-skill"

if [[ ! -f "${SOURCE_DIR}/SKILL.md" ]]; then
  echo "Cannot find JD Skill at ${SOURCE_DIR}" >&2
  exit 1
fi

mkdir -p "${TARGET_ROOT}"
rm -rf "${TARGET_DIR}"
cp -R "${SOURCE_DIR}" "${TARGET_DIR}"

echo "Installed JD Skill to ${TARGET_DIR}"
echo "Restart Codex or open a new Codex session, then use \$jd-skill with a JD image."
