#!/usr/bin/env bash
# Wrapper around tools/promote-defaults.mjs.
#
# Default mode: read tools/personal-snapshot.json (mirrored from the dev
# preview's localStorage), fold the changes into the *.defaults.json
# sidecars + globals.css managed block, sanity-check JSON, and commit the
# result onto main. NEVER pushes — pushing (and so deploying) is the
# release's job (`/cleanup-virgil` step 6).
#
# --check / --dry-run: compute the promotion against main and exit 1 if it
# would change anything. Writes nothing; the checkout is left byte-identical.
# Used by `/cleanup-virgil` to confirm there's no drift.
#
# Triggered by:
#   - ~/Library/LaunchAgents/com.virgil.promote-defaults.plist (Tue/Fri 11:00)
#   - `npm run promote-defaults` (one-shot manual)
#   - `/cleanup-virgil` release pipeline
#
# ISOLATION (task 623). This runs unattended in Gabriel's LIVE, SHARED
# checkout, so it must never measure or commit that tree. The promoter runs
# in a throwaway detached worktree of `main`; the commit is made there with
# an explicit pathspec of exactly the files the promoter reports it changed.
# So foreign WIP in globals.css / the defaults JSONs, anything already
# staged, and whatever branch the primary has checked out can never ride
# along. `main` is then advanced only by a fast-forward in the primary, and
# only when the primary is on `main` with none of the promoted files dirty
# (git's own --ff-only refuses the rest). Otherwise the commit is parked on
# a `prefs-promote-<date>` branch and logged.
#
# Idempotent. No-ops cleanly if there's no snapshot or no drift.

set -euo pipefail

MODE="commit"
case "${1:-}" in
  --check | --dry-run) MODE="check" ;;
  "") ;;
  *)
    echo "usage: sync-defaults.sh [--check|--dry-run]" >&2
    exit 2
    ;;
esac

# Self-locating: this script lives at <repo>/tools/, so derive the repo from
# its own path. Works under launchd (minimal env, no $VIRGIL_REPO_ROOT), under
# `npm run promote-defaults`, and under /cleanup-virgil alike.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SNAPSHOT="$REPO/tools/personal-snapshot.json"
BASE="main"

# Source nvm/PATH so node is available under launchd's minimal env.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" --no-use
  nvm use --silent default >/dev/null 2>&1 || true
fi

log() { echo "[$(date)] $*"; }

if [ ! -f "$SNAPSHOT" ]; then
  log "no snapshot — exiting"
  exit 0
fi

if ! git -C "$REPO" rev-parse --verify --quiet "refs/heads/$BASE" >/dev/null; then
  log "no local $BASE branch — exiting"
  exit 1
fi

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/virgil-promote.XXXXXX")"
WT="$SCRATCH/wt"
CHANGED="$SCRATCH/changed.txt"
cleanup() {
  if [ -d "$WT" ]; then
    git -C "$REPO" worktree remove --force "$WT" >/dev/null 2>&1 || true
  fi
  git -C "$REPO" worktree prune >/dev/null 2>&1 || true
  rm -rf "$SCRATCH"
}
trap cleanup EXIT

git -C "$REPO" worktree add --quiet --detach "$WT" "$BASE"
BASE_SHA="$(git -C "$WT" rev-parse HEAD)"

# The promoter that runs is main's own copy, against main's registry and
# targets; only the (gitignored) snapshot comes from the primary.
PROMOTER_ARGS=(--root "$WT" --snapshot "$SNAPSHOT" --changed-out "$CHANGED")

if [ "$MODE" = "check" ]; then
  if node "$WT/tools/promote-defaults.mjs" "${PROMOTER_ARGS[@]}" --dry-run; then
    log "no drift"
    exit 0
  fi
  if [ ! -s "$CHANGED" ]; then
    log "promoter failed"
    exit 2
  fi
  log "drift detected in $(wc -l <"$CHANGED" | tr -d ' ') file(s) — --check: nothing written"
  exit 1
fi

node "$WT/tools/promote-defaults.mjs" "${PROMOTER_ARGS[@]}"

if [ ! -s "$CHANGED" ]; then
  log "no diff — exiting"
  exit 0
fi

FILES=()
while IFS= read -r f; do
  [ -n "$f" ] && FILES+=("$f")
done <"$CHANGED"

# Sanity gate: every promoted JSON sidecar must parse. We skip a full `tsc
# --noEmit`; the JSON shape is the only thing this pipeline changes.
for f in "${FILES[@]}"; do
  case "$f" in
    *.json) node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf-8"))' "$WT/$f" ;;
  esac
done

log "drift detected in ${#FILES[@]} file(s): ${FILES[*]}"

DATE="$(date +%Y-%m-%d)"
# Explicit pathspec: the commit holds exactly the promoter's own output.
git -C "$WT" add -- "${FILES[@]}"
git -C "$WT" commit --quiet -m "Promote personal prefs to shipped defaults ($DATE)" -- "${FILES[@]}"
NEW_SHA="$(git -C "$WT" rev-parse HEAD)"

# Advance main in the primary only by fast-forward, only when it is on main,
# and only when none of the promoted files carry uncommitted edits there.
CUR_BRANCH="$(git -C "$REPO" symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
DIRTY="$(git -C "$REPO" status --porcelain --untracked-files=no -- "${FILES[@]}")"
if [ "$CUR_BRANCH" = "$BASE" ] && [ -z "$DIRTY" ] &&
  git -C "$REPO" merge --quiet --ff-only "$NEW_SHA" >/dev/null 2>&1; then
  log "committed $NEW_SHA onto $BASE (fast-forward from $BASE_SHA; not pushed)"
  exit 0
fi

PARK="prefs-promote-$DATE"
if git -C "$REPO" rev-parse --verify --quiet "refs/heads/$PARK" >/dev/null; then
  PARK="$PARK-$(date +%H%M%S)"
fi
git -C "$REPO" branch "$PARK" "$NEW_SHA"
if [ "$CUR_BRANCH" != "$BASE" ]; then
  WHY="primary is on '${CUR_BRANCH:-detached HEAD}', not $BASE"
elif [ -n "$DIRTY" ]; then
  WHY="primary has uncommitted edits to promoted files"
else
  WHY="$BASE moved and cannot fast-forward"
fi
log "$WHY — parked promote commit $NEW_SHA on branch $PARK (merge it into $BASE by hand)"
exit 0
