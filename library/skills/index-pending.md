---
description: |
  Drain the Virgil Library's queue in one pass — process every pending
  request (triage, index, authenticate, deep-index, bib-edit, paper-
  review) and exit. Triggers on: "drain the library queue", "process
  pending library work", "run the library inbox", "Virgil, work
  through my pending papers", "catch up the library". Heavy operation
  — must run from inside the library folder. For steady-state polling
  pair with `/loop /index-pending`. If invoked from a paper-only
  session, prompt the user to mount the library first. Does NOT
  trigger for editor-side AI requests in a single paper (use
  /editor/review).
---

# /index-pending

## Bootstrap (run this first)

This skill operates on the user's Virgil Library queue. Resolve the
library root and cd into it before running anything else.

```bash
# Find library_path.py — synced PWA folders have it under .virgil/scripts/,
# the Virgil source repo has it under editor/scripts/. Either is fine.
library_path_py=""
for candidate in .virgil/scripts/editor/library_path.py editor/scripts/library_path.py; do
  [ -f "$candidate" ] && { library_path_py="$candidate"; break; }
done
if [ -z "$library_path_py" ]; then
  echo "No library set up. Pick a library in Virgil first."
  exit 1
fi
library_root="$(python3 "$library_path_py" --get 2>/dev/null)" || {
  echo "No library set up. Pick a library in Virgil first."
  echo "  (Or run: python3 $library_path_py --set <abs-path>)"
  exit 1
}
cd "$library_root"
export VIRGIL_LIBRARY_ROOT="$library_root"
```

---

Drain the queue to empty in **one turn**. Designed for the catch-up
case (a backlog after `/triage-pending`); for steady-state polling,
wrap with `/loop /index-pending`.

The bulk of the work is delegated to `.virgil/scripts/library/drain_queue.py`, which
shells out to `index_paper.py` per entry. This avoids the per-file
skill-invocation overhead that would otherwise burn through context
for any non-trivial queue.

All paths below are relative to the library root (the current working
directory).

## Steps

1. **Drain native kinds in batch.** Run:
   ```bash
   python3 .virgil/scripts/library/drain_queue.py
   ```
   This processes every `kind=index` and `kind=reindex` entry in
   `.virgil/queue/*.json`, grouped by citekey and ordered:
   1. `bib-edit`
   2. `authenticate`
   3. `index` / `reindex`
   4. `triage`

   `bib-edit`, `authenticate`, and `triage` kinds are **deferred** —
   the script lists them in its summary but does not handle them
   itself. Capture stdout for the per-entry classification table.

2. **Dispatch deferred kinds via skills.** For each kind the drain
   script reported as deferred:
   - `kind: "bib-edit"`     → invoke `/apply-bib-edit <citekey>`
   - `kind: "authenticate"` → invoke `/authenticate-bib <citekey>`
   - `kind: "deepIndex"` (or legacy `"richIndex"`) → invoke `/deep-index <citekey>`
   - `kind: "import-bib"`   → invoke `/library/import-bib <citekey>`
   - `kind: "triage"`       → these are pre-`triage_apply` stubs;
     normally produced only by the legacy per-file flow. Invoke
     `/triage-pdf <filename>` for each.

   **Tip:** `.virgil/queue/pending-reviews.json` lists all pending authenticate
   requests as a flat manifest. Use it as a quick check for outstanding
   AI review requests instead of scanning individual queue files.

   Order: process `bib-edit` and `authenticate` first (they may
   improve a future re-index), then `deepIndex`, then any `triage`.
   Run them sequentially — most queues will have at most a handful.

3. **If `bib-edit` or `authenticate` skill runs produced changes**,
   re-run `python3 .virgil/scripts/library/drain_queue.py` once more so any
   newly-eligible `index`/`reindex` entries get picked up. Skip if
   step 2 was a no-op.

4. **Refresh the "imported" flags.** Any drain pass that re-emitted a
   `references.bib` (re-index, deep-index, populate, synthesize…) may
   have added bib entries to a previously-imported paper. Sweep the
   catalog and clear `bib.imported` on any such paper (additions-only —
   removals are ignored), so the blue "imported" check disappears until
   the user re-imports:
   ```bash
   python3 .virgil/scripts/library/invalidate_bib_imports.py
   ```

5. **Print a final summary.** The drain script's own summary line is
   already in your transcript from step 1; if step 2 ran, append a
   second line counting the deferred dispatches:
   ```
   Drained 47 entries: 41 indexed, 1M manuscript, 3? unverified-with-DOI, 2! unverified-no-DOI.
   Dispatched 2 deferred: 1 bib-edit applied, 1 authenticate applied.
   ```

## When the queue is empty

`drain_queue.py` exits with `queue empty` and returns 0 — your reply is
just that single line, no further work needed.

## Large queues / running from inside a subagent

The synchronous `python3 .virgil/scripts/library/drain_queue.py` in step 1 is
fine when the queue is small (≤ ~20 entries) **or** when this skill
runs in a session with no turn-budget cap (a user-driven session that
can sit idle for hours).

It is **not** fine when you're a subagent invoked from another skill
(e.g. an `iterate-skill` driver, or a meta-task that spawned you).
Subagents have a stricter turn budget than user sessions; on a 80-PDF
backlog (≈ 15–60 min of wallclock work) the budget will run out
mid-drain, the drain's child process will be orphaned, and the
caller will see "agent done" with the queue still half-full and no
audit step run. That's the failure mode that bit us on
2026-05-09.

Detach-and-poll instead. Two phases:

**Phase A — kick off the drain detached, return immediately.**
```bash
cd <library-root>
nohup python3 .virgil/scripts/library/drain_queue.py \
  > /tmp/drain_$(date +%s).log 2>&1 &
disown
echo "drain pid=$! log=/tmp/drain_$(date +%s).log"
```
The drain now outlives the current shell / agent turn. Capture the
log path so the next phase can tail it.

**Phase B — wait for the queue to empty, then continue.** From a
fresh shell context (a follow-up turn, or a sibling Bash background
command), poll until the queue is empty:
```bash
until [ "$(ls <library-root>/.virgil/queue/*.json 2>/dev/null | wc -l | tr -d ' ')" = "0" ]; do
  sleep 30
done
echo "drain queue empty $(date -u +%H:%M:%SZ)"
```
Then run step 2 (deferred-kind dispatch) and step 4 (final summary).

If two callers race and start two `drain_queue.py` processes against
the same library, that's safe — `_process_one` in the drain script
acquires `.virgil/queue/<citekey>.lock` before processing each entry
and skips files held by another worker. You'll see a brief overlap
(both workers pick the same first file before the lock takes hold)
but no corruption.

## Why this isn't a `/loop`

`/loop /index-pending` is fine for steady-state polling (new files
trickle in via the frontend). For a one-time backlog (94 PDFs from a
bulk drop), the loop is the wrong shape — you want one drain pass to
finish, not an indefinite poller. `/index-pending` always runs to
empty in the current turn (or detached, per above); the user can wrap
it with `/loop` if they want recurring polling.
