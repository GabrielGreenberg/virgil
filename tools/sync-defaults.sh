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
# THE CANONICAL STATEMENT of when a promotion runs, what gates it, and where
# it lands (task 1307) — other files point here rather than restate it:
#   - Schedule: Tue + Fri 11:00 (launchd, plus once at load), so a mirrored
#     pref change waits at most ~96h (Fri → Tue) for the next tick.
#   - Gates: every changed file must `JSON.parse`; EVERY promotion must pass
#     tools/check-prefs-coverage.mjs (task 1488), and a promoted file the
#     registry's `contractSuites` table names must also pass its vitest
#     suite(s) (task 900, below). No tsc and no full suite run here.
#   - Landing: a LOCAL commit, fast-forwarded onto main only when the primary
#     is on main, the promoted files are clean, and the gate is green —
#     otherwise PARKED on a `prefs-promote-<date>` branch. Never pushed.
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

# The promoter's WARNING lines (a blob the snapshot lacks, a stale blob, a
# source-less snapshot — task 1487) print above; the verdict lines below
# repeat their count, so "no diff" can never again hide a stalled half.
PROMOTE_OUT="$SCRATCH/promote.out"
promote() { node "$WT/tools/promote-defaults.mjs" "${PROMOTER_ARGS[@]}" "$@" | tee -a "$PROMOTE_OUT"; }
warnings() {
  local n
  n="$(grep -c '^WARNING:' "$PROMOTE_OUT" 2>/dev/null || true)"
  [ "${n:-0}" -gt 0 ] && echo " — $n snapshot WARNING(s) above"
  return 0
}

if [ "$MODE" = "check" ]; then
  if promote --dry-run; then
    log "no drift$(warnings)"
    exit 0
  fi
  if [ ! -s "$CHANGED" ]; then
    log "promoter failed"
    exit 2
  fi
  log "drift detected in $(wc -l <"$CHANGED" | tr -d ' ') file(s) — --check: nothing written"
  exit 1
fi

promote

if [ ! -s "$CHANGED" ]; then
  log "no diff$(warnings) — exiting"
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

log "drift detected in ${#FILES[@]} file(s): ${FILES[*]}$(warnings)"

# Contract gate (tasks 900, 1488): JSON parsing proves only that the file is
# JSON. Two layers, both run in the throwaway worktree against the promoted
# files:
#   1. tools/check-prefs-coverage.mjs, UNCONDITIONALLY — static, sub-second,
#      and it knows the value contracts of every sidecar (e.g. the Library
#      colOrder must be a full permutation of its columns: a partial one
#      promoted from a stale blob would drop that column for every user).
#   2. The vitest suite(s) the registry's `contractSuites` table names for each
#      promoted file (e.g. the View defaults → the registry-source suite: every
#      promoted value inside the domain its row declares). The pairing lives in
#      that ONE table, never in an `if` here.
# A red gate still commits, but PARKS the commit instead of fast-forwarding
# main, so the repair is a human's and main stays green.
GATE_FAIL=""
if ! node "$WT/tools/check-prefs-coverage.mjs" --root "$WT" >"$SCRATCH/coverage.log" 2>&1; then
  GATE_FAIL="prefs coverage check failed on the promoted defaults"
  cat "$SCRATCH/coverage.log"
fi
SUITES=()
while IFS= read -r s; do
  [ -n "$s" ] && SUITES+=("$s")
done < <(node -e '
  const suites = JSON.parse(require("fs").readFileSync(process.argv[1], "utf-8")).contractSuites ?? {};
  const out = new Set();
  for (const f of process.argv.slice(2)) for (const s of Object.hasOwn(suites, f) ? suites[f] : []) out.add(s);
  for (const s of out) console.log(s);
' "$WT/src/lib/dev-prefs-registry.json" "${FILES[@]}")
if [ "${#SUITES[@]}" -gt 0 ]; then
  ln -s "$REPO/node_modules" "$WT/node_modules"
  if ! (cd "$WT" && NODE_OPTIONS=--no-experimental-webstorage \
    node "$WT/node_modules/vitest/vitest.mjs" run "${SUITES[@]}" >"$SCRATCH/gate.log" 2>&1); then
    GATE_FAIL="${GATE_FAIL:+$GATE_FAIL; }contract suite(s) failed on the promoted defaults: ${SUITES[*]}"
    tail -n 40 "$SCRATCH/gate.log"
  fi
  rm -f "$WT/node_modules"
fi

DATE="$(date +%Y-%m-%d)"
# Explicit pathspec: the commit holds exactly the promoter's own output.
git -C "$WT" add -- "${FILES[@]}"
git -C "$WT" commit --quiet -m "Promote personal prefs to shipped defaults ($DATE)" -- "${FILES[@]}"
NEW_SHA="$(git -C "$WT" rev-parse HEAD)"

# Advance main in the primary only by fast-forward, only when it is on main,
# and only when none of the promoted files carry uncommitted edits there.
CUR_BRANCH="$(git -C "$REPO" symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
DIRTY="$(git -C "$REPO" status --porcelain --untracked-files=no -- "${FILES[@]}")"
FF_ERR="$SCRATCH/ff.err"
if [ -z "$GATE_FAIL" ] && [ "$CUR_BRANCH" = "$BASE" ] && [ -z "$DIRTY" ] &&
  git -C "$REPO" merge --quiet --ff-only "$NEW_SHA" >/dev/null 2>"$FF_ERR"; then
  log "committed $NEW_SHA onto $BASE (fast-forward from $BASE_SHA; not pushed)"
  exit 0
fi

PARK="prefs-promote-$DATE"
if git -C "$REPO" rev-parse --verify --quiet "refs/heads/$PARK" >/dev/null; then
  PARK="$PARK-$(date +%H%M%S)"
fi
git -C "$REPO" branch "$PARK" "$NEW_SHA"
if [ -n "$GATE_FAIL" ]; then
  WHY="$GATE_FAIL"
elif [ "$CUR_BRANCH" != "$BASE" ]; then
  WHY="primary is on '${CUR_BRANCH:-detached HEAD}', not $BASE"
elif [ -n "$DIRTY" ]; then
  WHY="primary has uncommitted edits to promoted files"
else
  # The fast-forward itself failed. "main moved" is only ONE cause — a held
  # index.lock or a merge in progress land here too — so log git's own words.
  WHY="fast-forward of $BASE refused: $(tr '\n' ' ' <"$FF_ERR" 2>/dev/null | sed 's/ *$//')"
  [ -s "$FF_ERR" ] || WHY="fast-forward of $BASE refused (git printed no reason)"
fi
log "$WHY — parked promote commit $NEW_SHA on branch $PARK (merge it into $BASE by hand)"
exit 0
