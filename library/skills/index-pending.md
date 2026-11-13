---
description: |
  Drain the Virgil Library's queue in one pass — process every pending
  request (triage, index, authenticate, deep-index, bib-edit, paper-
  review) and exit. Triggers on: "drain the library queue", "process
  pending library work", "run the library inbox", "Virgil, work
  through my pending papers", "catch up the library". Heavy operation
  — must run from inside the library folder. For steady-state polling
  pair with `/loop /library/index-pending`. If invoked from a paper-only
  session, prompt the user to mount the library first. Does NOT
  trigger for editor-side AI requests in a single paper (use
  /editor/review).
---

# /library/index-pending

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
case (a backlog after `/library/triage-pending`); for steady-state polling,
wrap with `/loop /library/index-pending`.

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
   This walks the pending requests in `.virgil/queue/`, grouped by
   citekey and ordered `bib-edit`, `authenticate`, `index`/`reindex`,
   `deepIndex` (legacy `richIndex`), `triage`. Not every `*.json` there is
   a request: `pending-reviews.json` is the app's bib-review manifest and
   `*.done.json` a retirement marker — the drain never counts them
   (`queue_slot.request_files`). To see what is waiting to be picked up
   without running anything: `python3 .virgil/scripts/library/queue_slot.py claimable`
   (what a worker may claim now — waiting, failed retries, abandoned claims;
   the drain's own `is_claimable` gate. `pending` is `status: requested`
   only; `outstanding` adds requests a worker is working right now).

   Only `index` and `reindex` are native (`queue_slot.DRAIN_NATIVE_KINDS`).
   **Every other kind is deferred**: the drain lists it under
   "Remaining (need skill dispatch)" as `- <kind> for <citekey>`, with a
   `[note]` flag when the user attached a note, and leaves the file for
   step 2. Capture stdout for the per-entry classification table.

2. **Dispatch deferred kinds.** First the **note override** — a request
   the user wrote a note on is an AI request, and the note is its spec.
   **What counts is defined once, in `/library/ai-requests` →
   "What counts as an AI request"; follow that section, don't re-derive
   it.** In short:
   any `paper-review`, and any `authenticate` / `deepIndex` flagged
   `[note]`, goes to **`/library/ai-requests`** (run it once; it handles
   every such request in the queue). Then, per kind, for the rest:

   | Queue kind | Route |
   |---|---|
   | `paper-review` | → `/library/ai-requests` (note optional — a note-less one is a whole-paper review; that skill states it) |
   | `authenticate` | → `/library/authenticate-bib <citekey>` (with `[note]`: → `/library/ai-requests`) |
   | `deepIndex` | → `/library/deep-index <citekey>`; legacy `richIndex` likewise (with `[note]`: → `/library/ai-requests`) |
   | `bib-edit` | → `/library/apply-bib-edit <citekey>` |
   | `import-bib` | → `/library/import-bib <citekey>` |
   | `triage` | → `/library/triage-pdf <filename>` (the app files one per drop; `triage_apply.py` retires each file it applies, so what is left here is a drop no batch triage has applied yet, or a released retry; the drain prints the filename) |
   | `index` | → native, step 1 (a leftover is `failed`; see the drain's summary) |
   | `reindex` | → native, step 1 |
   | `delete` | → **no skill — do not act.** Deleting a paper folder, its `master.bib` block and catalog row is destructive and has no handling skill yet; list each in the summary as "delete requested — needs the user" and leave the file |

   A census test (`index-pending-dispatch-census.test.ts`) fails if a
   `QueueKind` in `library/lib/queue.ts` has no row here.

   Order: `bib-edit` and `authenticate` first (they may improve a future
   re-index), then `deepIndex` and `import-bib`, then any `triage`, then
   `/library/ai-requests` once if any request was routed there. Run them
   sequentially — most queues will have at most a handful.

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

`drain_queue.py` prints `queue empty` (with a parenthesised count of any
`poisoned` / `running` / already-done entries it skipped) and returns 0 —
your reply is just that line, no further work needed. The
`pending-reviews.json` manifest does not count as a request, so a library
that has had a bib review still reaches this branch.

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
log=$(mktemp "${TMPDIR:-/tmp}/virgil-drain-log.XXXXXX")
nohup python3 .virgil/scripts/library/drain_queue.py \
  > "$log" 2>&1 &
disown
echo "drain pid=$! log=$log"
```
The drain now outlives the current shell / agent turn. Capture the
log path so the next phase can tail it.

**Phase B — wait for the NATIVE work to finish, then continue.** The
drain only ever empties the native kinds: every deferred request (and any
`poisoned` entry, and the review manifest) stays in the folder until step 2
runs, so never poll for an empty folder — ask the queue door how much
native work is still OUTSTANDING, and use the drain's pid as the belt.
Count `outstanding`, never `pending`: the drain CLAIMS each request before
working it (`status: running`, for up to ten minutes an index), so the
last request leaves `pending` the moment its index STARTS, and `pending`
never counted the `failed` retries the drain also works (task 1468):
```bash
cd <library-root>
drain_pid=<pid from Phase A>
q=".virgil/scripts/library/queue_slot.py"
until [ "$(python3 $q outstanding --native --count)" = "0" ]; do
  kill -0 "$drain_pid" 2>/dev/null || break   # drain exited
  sleep 30
done
left="$(python3 $q outstanding --native --count)"
echo "native work left: $left $(date -u +%H:%M:%SZ)"
```
If `left` is `0`, run step 2 (deferred-kind dispatch), step 3 (re-drain
if step 2 changed anything), step 4 (refresh the "imported" flags) and
step 5 (final summary), reading the drain's own summary from the Phase A
log. If `left` is above `0`, the drain exited with work left: `tail` the
log — an error means it stopped early; otherwise what is left is `failed`
retries (`python3 $q outstanding --native` names them). Re-run Phase A;
each pass is one more attempt, and the third failure poisons an entry, so
the count converges.

If two callers race and start two `drain_queue.py` processes against
the same library, that's safe — `_process_one` in the drain script
CLAIMS each entry (`status: running`, through `queue_slot.claim_request`)
before processing it, and a worker that finds the entry already claimed
skips it. The claim is also what the app and `queue_slot.py write` refuse
on, and the drain retires only the request it claimed — so a request
queued while the drain works that paper stays queued (task 1291).

## Why this isn't a `/loop`

`/loop /library/index-pending` is fine for steady-state polling (new files
trickle in via the frontend). For a one-time backlog (94 PDFs from a
bulk drop), the loop is the wrong shape — you want one drain pass to
finish, not an indefinite poller. `/library/index-pending` always runs to
empty in the current turn (or detached, per above); the user can wrap
it with `/loop` if they want recurring polling.
