---
description: Drain ~/Virgil-Library/queue/ in one pass — process every queued indexing request, then exit. For batch backlogs use this; for steady-state polling use /loop /index-pending.
---

# /index-pending

Drain the queue to empty in **one turn**. Designed for the catch-up
case (a backlog after `/triage-pending`); for steady-state polling,
wrap with `/loop /index-pending`.

The bulk of the work is delegated to `scripts/drain_queue.py`, which
shells out to `index_paper.py` per entry. This avoids the per-file
skill-invocation overhead that would otherwise burn through context
for any non-trivial queue.

All paths below are relative to the library root (the current working
directory).

## Steps

1. **Drain native kinds in batch.** Run:
   ```bash
   python3 scripts/drain_queue.py
   ```
   This processes every `kind=index` and `kind=reindex` entry in
   `queue/*.json`, grouped by citekey and ordered:
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
   - `kind: "richIndex"`    → invoke `/rich-index <citekey>`
   - `kind: "triage"`       → these are pre-`triage_apply` stubs;
     normally produced only by the legacy per-file flow. Invoke
     `/triage-pdf <filename>` for each.

   **Tip:** `queue/pending-reviews.json` lists all pending authenticate
   requests as a flat manifest. Use it as a quick check for outstanding
   AI review requests instead of scanning individual queue files.

   Order: process `bib-edit` and `authenticate` first (they may
   improve a future re-index), then `richIndex`, then any `triage`.
   Run them sequentially — most queues will have at most a handful.

3. **If `bib-edit` or `authenticate` skill runs produced changes**,
   re-run `python3 scripts/drain_queue.py` once more so any
   newly-eligible `index`/`reindex` entries get picked up. Skip if
   step 2 was a no-op.

4. **Print a final summary.** The drain script's own summary line is
   already in your transcript from step 1; if step 2 ran, append a
   second line counting the deferred dispatches:
   ```
   Drained 47 entries: 41 indexed, 1M manuscript, 3? unverified-with-DOI, 2! unverified-no-DOI.
   Dispatched 2 deferred: 1 bib-edit applied, 1 authenticate applied.
   ```

## When the queue is empty

`drain_queue.py` exits with `queue empty` and returns 0 — your reply is
just that single line, no further work needed.

## Why this isn't a `/loop`

`/loop /index-pending` is fine for steady-state polling (new files
trickle in via the frontend). For a one-time backlog (94 PDFs from a
bulk drop), the loop is the wrong shape — you want one drain pass to
finish, not an indefinite poller. `/index-pending` always runs to
empty in the current turn; the user can wrap it with `/loop` if they
want recurring polling.
