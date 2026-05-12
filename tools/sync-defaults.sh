#!/usr/bin/env bash
# Periodic wrapper around tools/promote-defaults.mjs.
#
# Run by ~/Library/LaunchAgents/com.virgil.promote-defaults.plist every
# ~48h. Reads tools/personal-snapshot.json (mirrored from the dev preview's
# localStorage), folds the changes into the *.defaults.json sidecars +
# globals.css managed block, sanity-checks TS, and commits + pushes if
# the diff is real.
#
# Idempotent. No-ops cleanly if there's no snapshot, no diff, or no
# remote.

set -euo pipefail

REPO="/Users/gabriel/Programming/virgil"
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
  src/app/globals.css
)

if git diff --quiet -- "${TARGETS[@]}"; then
  echo "[$(date)] no diff — exiting"
  exit 0
fi

# Sanity gate: the four sidecars must parse as valid JSON. The promote
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
  ]) JSON.parse(fs.readFileSync(f, "utf-8"));
'

git add -- "${TARGETS[@]}"
git commit -m "Promote personal prefs to shipped defaults ($(date +%Y-%m-%d))"

if git remote get-url origin >/dev/null 2>&1; then
  git push origin main
fi

echo "[$(date)] committed + pushed"
