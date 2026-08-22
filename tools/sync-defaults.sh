#!/usr/bin/env bash
# Wrapper around tools/promote-defaults.mjs.
#
# Default mode: read tools/personal-snapshot.json (mirrored from the dev
# preview's localStorage), fold the changes into the *.defaults.json
# sidecars + globals.css managed block, sanity-check JSON, then commit +
# push if the diff is real.
#
# --check mode: run the promoter, then exit non-zero (without committing)
# if any of the target files differ from HEAD. Used by `/cleanup-virgil`
# and CI to catch drift between snapshot and shipped defaults.
#
# Triggered by:
#   - ~/Library/LaunchAgents/com.virgil.promote-defaults.plist (Tue/Fri 11:00)
#   - `npm run promote-defaults` (one-shot manual)
#   - `/cleanup-virgil` release pipeline
#
# Idempotent. No-ops cleanly if there's no snapshot, no diff, or no
# remote.

set -euo pipefail

MODE="commit"
if [ "${1:-}" = "--check" ]; then
  MODE="check"
fi

# Self-locating: this script lives at <repo>/tools/, so derive the repo from
# its own path. Works under launchd (minimal env, no $VIRGIL_REPO_ROOT), under
# `npm run promote-defaults`, and under /cleanup-virgil alike.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

# Source nvm/PATH so node + npx are available under launchd's minimal env.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" --no-use
  nvm use --silent default >/dev/null 2>&1 || true
fi

if [ ! -f tools/personal-snapshot.json ]; then
  echo "[$(date)] no snapshot — exiting"
  exit 0
fi

node tools/promote-defaults.mjs

TARGETS=(
  src/hooks/useViewPrefs.defaults.json
  src/hooks/usePreferences.defaults.json
  src/lib/panel-theme.defaults.json
  src/lib/print.defaults.json
  library/lib/list-columns.defaults.json
  src/app/globals.css
)

if git diff --quiet -- "${TARGETS[@]}"; then
  echo "[$(date)] no diff — exiting"
  exit 0
fi

# Sanity gate: the five sidecars must parse as valid JSON. The promote
# script always emits well-formed JSON, but a corrupt snapshot or a hand-
# edit between cron runs could leave them broken. We skip a full `tsc
# --noEmit` because unrelated WIP elsewhere in the repo would falsely
# block this commit; the JSON shape is the only thing this pipeline
# actually changes.
node -e '
  const fs = require("fs");
  for (const f of [
    "src/hooks/useViewPrefs.defaults.json",
    "src/hooks/usePreferences.defaults.json",
    "src/lib/panel-theme.defaults.json",
    "src/lib/print.defaults.json",
    "library/lib/list-columns.defaults.json",
  ]) JSON.parse(fs.readFileSync(f, "utf-8"));
'

# Summary line, printed in both modes — shows up in the launchd log
# and on the developer's terminal.
DIFF_FILES=$(git diff --name-only -- "${TARGETS[@]}" | wc -l | tr -d ' ')
echo "[$(date)] drift detected in $DIFF_FILES file(s)"

if [ "$MODE" = "check" ]; then
  echo "[$(date)] --check mode: exiting non-zero without committing"
  exit 1
fi

git add -- "${TARGETS[@]}"
git commit -m "Promote personal prefs to shipped defaults ($(date +%Y-%m-%d))"

if git remote get-url origin >/dev/null 2>&1; then
  git push origin main
fi

echo "[$(date)] committed + pushed"
