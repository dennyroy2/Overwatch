#!/usr/bin/env bash
# Ownership guard for Denny's branches.
# Fails (exit 1) if any changed path is outside frontend/ or backend/perception/,
# or is inside frontend/src/panels/ (Varad's).
#
# Changed = committed diff vs origin/main + staged + unstaged tracked changes.
# Untracked files are reported as a warning only (they can't reach a PR until added).
#
# Test hook: CHECK_OWNERSHIP_FILES="path1 path2" checks that list instead of git.
set -u
cd "$(git rev-parse --show-toplevel)"

if [ -n "${CHECK_OWNERSHIP_FILES:-}" ]; then
  files=$(printf '%s\n' $CHECK_OWNERSHIP_FILES)
  untracked=""
else
  base=$(git merge-base HEAD origin/main 2>/dev/null || echo origin/main)
  files=$( { git diff --name-only "$base" HEAD; git diff --name-only --cached; git diff --name-only; } | sort -u )
  untracked=$(git ls-files --others --exclude-standard)
fi

bad=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    frontend/src/panels/*) echo "FORBIDDEN (Varad's folder): $f"; bad=1 ;;
    frontend/*|backend/perception/*) ;;
    *) echo "FORBIDDEN (outside your folders): $f"; bad=1 ;;
  esac
done <<< "$files"

while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in frontend/src/panels/*|frontend/*|backend/perception/*) ;; *) echo "warning: untracked file outside your folders (don't add it): $f" ;; esac
done <<< "$untracked"

if [ "$bad" -eq 0 ]; then echo "ownership OK"; fi
exit $bad
