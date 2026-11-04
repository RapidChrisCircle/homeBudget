#!/usr/bin/env bash
# Resolves the application version dynamically.
#
# Rules:
# 1. Reads the base version from the repo-root VERSION file (e.g. 0.46.0).
# 2. If running within a git repository, counts the number of commits since
#    the VERSION file was last modified in git (or 0 if modified in working tree).
# 3. If commits_since == 0 (or git is unavailable), returns the base version (0.46.0).
# 4. If commits_since > 0, returns <major>.<minor>.<commits_since> (e.g. 0.46.3).
#
# This ensures every commit on main automatically receives a unique,
# strictly increasing version number without requiring a manual VERSION edit.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_FILE="$ROOT_DIR/VERSION"

if [[ ! -f "$VERSION_FILE" ]]; then
  echo "dev"
  exit 0
fi

BASE_VERSION="$(cat "$VERSION_FILE" | tr -d '[:space:]')"
if [[ -z "$BASE_VERSION" ]]; then
  echo "dev"
  exit 0
fi

# Extract MAJOR.MINOR (e.g. 0.46.0 -> 0.46)
MAJOR_MINOR="$(echo "$BASE_VERSION" | sed -E 's/\.[0-9]+$//')"

COMMITS_SINCE="0"

if git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  # If the VERSION file has uncommitted changes in the working tree, count is 0.
  if git -C "$ROOT_DIR" diff --quiet HEAD -- "$VERSION_FILE" 2>/dev/null; then
    LAST_COMMIT="$(git -C "$ROOT_DIR" log -1 --format=%H -- "$VERSION_FILE" 2>/dev/null || true)"
    if [[ -n "$LAST_COMMIT" ]]; then
      COMMITS_SINCE="$(git -C "$ROOT_DIR" rev-list --count "${LAST_COMMIT}..HEAD" 2>/dev/null || echo "0")"
    fi
  else
    COMMITS_SINCE="0"
  fi
fi

if [[ "$COMMITS_SINCE" == "0" ]]; then
  if [[ "$BASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
    echo "$BASE_VERSION"
  else
    echo "${MAJOR_MINOR}.0"
  fi
else
  echo "${MAJOR_MINOR}.${COMMITS_SINCE}"
fi

