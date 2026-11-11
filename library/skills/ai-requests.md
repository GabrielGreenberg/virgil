---
description: |
  Take a pass on AI requests the user has left on library papers
  (notes attached to queue entries + paper-review requests). Triggers
  on: "drain my library AI requests", "handle the notes I left on my
  library papers", "process my paper-review requests", "Virgil, look
  at the notes in my library queue". Pair with /loop for steady-state
  polling. Does NOT trigger for editor-side requests in a single paper
  folder (use /editor/review) or for general queue draining of
  triage/index/authenticate work (use /library/index-pending).
  Heavy operation — only run from inside the library folder.
---

# /library/ai-requests

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

**Process only the user-driven AI requests.** Do **not** run the
general-purpose indexing/triage pipeline. The user explicitly invoked
this command because they want their hand-written notes addressed, not
a queue drain.

All paths are relative to the library root (the current working
directory).

> **Where any memo you write goes.** Library memos (notes about this
> pipeline — retros, indexing-flow ideas) → `.virgil/memos/<YYYY-MM-DD>-<slug>.md`.
> A reflection about Virgil's *skill set* is a dev-loop note, **not** a library
> memo — never file a reflection under `.virgil/memos/` (see `.claude/virgil/memos.md`).
> Paper-specific analyses or reports → `papers/<citekey>/notes/<slug>.md`.
> Never drop a markdown file at the library root.

> **Shared doctrine — find-or-surface, never fabricate.** Read
> [_find-or-surface.md](_find-or-surface.md). The `bib` scope below is the
> only instruction in either silo that tells you to fill bibliographic fields
> straight from a user's free-text note — and it deliberately opts OUT of
> `/library/authenticate-bib`'s tier ladder, so the acceptance bar it would have
> inherited has to come from here instead. **The note is the SPEC, never the
> EVIDENCE.**

## What counts as an AI request

A queue entry is an AI request when **any** of these is true:

1. `kind == "paper-review"` — produced by the AI request button in the
   paper text view, or the **AI doc review** item on a catalog row. File:
   `.virgil/queue/<citekey>-paperreview.json`. The `note` is OPTIONAL
   (`queuePaperReview` in `library/lib/bib-edit.ts` omits it when the user
   typed nothing — the catalog-row item never asks). A note-less request
   is a whole-paper review with no narrower spec: see step 2's `paper`
   scope.
2. `kind == "authenticate"` and the entry has a non-empty `note` field
   — produced by the AI request button on the bib card when the user
   typed a note before submitting. File: `.virgil/queue/<citekey>-auth.json`
   (an older request may still sit in `.virgil/queue/<citekey>.json` —
   read the `kind` field, never infer it from the filename).
   (`authenticate` entries **without** a note are vanilla auth requests
   and should be left for `/library/index-pending` / `/library/authenticate-bib` to
   handle on the regular path. Skip them here.)
3. `kind == "deepIndex"` (or legacy `"richIndex"`) and the entry has a
   non-empty `note` field — produced by the deep-index button with a
   user note.
   File: `.virgil/queue/<citekey>-deepindex.json` (legacy:
   `.virgil/queue/<citekey>-richindex.json`).
   Dispatch to `/library/deep-index <citekey>` (the skill reads the note from
   the queue file). `deepIndex` entries **without** a note are standard
   deep-index requests — leave them for `/library/index-pending` to handle.
`import-bib` is **not** an AI request, note or no note: it has one owner,
`/library/import-bib <citekey>`, which reads and echoes the request's
`note` itself, and `/library/index-pending` routes every one there
(its dispatch table). Skip it here. If the user invoked
`/library/ai-requests` expecting an import, point them at
`/library/import-bib`.

## Procedure

1. **Find the candidates.** List the pending requests with
   `python3 .virgil/scripts/library/queue_slot.py pending` (the requests
   waiting to be picked up — `status: requested`, so one another worker has
   already claimed is not a candidate; one JSON line per request, naming its
   `file`; `pending-reviews.json` and `.done` markers are
   not requests and never appear), read each file, and select the ones
   matching the criteria above. Build a working list with
   citekey, kind, scope (`bib` or `paper`), and note.

2. **For each request — claim it, surface the note prominently, and act on it.**

   A request routed onward (`deepIndex` → `/library/deep-index`) is that
   skill's to claim and retire — don't claim it here. Every request you handle YOURSELF
   (`paper-review`, `authenticate` with a note) you CLAIM first, through
   the queue door, so a run racing yours (or the app) won't take it and a
   request the user re-files while you work is not retired unworked:
   ```bash
   python3 .virgil/scripts/library/queue_slot.py claim --kind <kind> --citekey <citekey>
   ```
   It prints `{"result": "claimed", "requestedAt": …}` — keep that
   `requestedAt` for step 3 — or `{"result": "nothing-claimable"}`
   (another worker holds it: skip this request).

   **A claimed request you cannot finish is RELEASED, never left
   claimed** (task 1575) — every "do not retire" below means: report,
   then
   ```bash
   python3 .virgil/scripts/library/queue_slot.py release --kind <kind> --citekey <citekey> --requested-at "<requestedAt from the step-2 claim>" --error "<one line: why it stopped>"
   ```
   and go on to the next request. A claim left behind stays `running` for
   an hour (the app refuses the user's re-file as "already being
   processed", and merge-bibs refuses to start); released, it is `failed`
   — re-fileable at once, retried by the next run, `poisoned` after three
   failures.

   Print a clearly-delimited block before doing anything else:

   ```
   ════════════════════════════════════════════════════════════
   AI REQUEST · <citekey>
   Scope: <bib | paper>
   Queue file: .virgil/queue/<filename>
   ────────────────────────────────────────────────────────────
   <full verbatim user note>
   ════════════════════════════════════════════════════════════
   ```

   Do not paraphrase the note. Echo it verbatim so the user can see in
   the transcript exactly what they asked for.

   Then act:

   - **`bib` scope (`kind=authenticate` with note):** handle the note
     directly. The note is the spec — it says WHICH fields to work on;
     it is never the EVIDENCE for what goes in them
     ([_find-or-surface.md](_find-or-surface.md)). If it asks you to
     verify a field, verify it (Library `master.bib` first, then web
     search / Crossref / OpenAlex as appropriate). If it asks you to
     fill missing fields, fill each one **from a real source you
     actually located** — and where you could not, leave it empty and
     say so in your reply, naming the field and what you searched. A
     field the user asked for and you could not source is a surfaced
     gap, which is the success mode; a plausible value from
     recollection is the failure mode, and it will outlive every check
     in this pipeline. Do **not** fall through to
     the standard `/library/authenticate-bib` three-tier search unless the note
     specifically asks for it — that narrows the SEARCH, never the bar.

     **Writing what you found.** There is no queue entry to stage it in:
     a `bib-edit` request carries the app's Edit-modal diff (`bibEdit`),
     and no CLI writes one. Land the fields through the SAME door
     `/library/apply-bib-edit` uses — the locked master.bib writer — with a
     change-set holding only the fields you sourced:

     ```bash
     t=$(mktemp -d "${TMPDIR:-/tmp}/virgil-ai-requests.XXXXXX")
     python3 .virgil/scripts/library/master_entry.py "<citekey>" > "$t/base.bib"
     echo "read=$?"
     ```

     `read=` is `master_entry.py`'s own table (its docstring): **0** found —
     continue; **3** absent or **2** unreadable — report its stderr
     verbatim, write nothing (`rm -rf "$t"`), and release the request (do not
     retire it).
     On 0, write the change-set in the same `$t`:

     ```bash
     cat > "$t/set.json" <<'EOF'
     { "doi": "...", "year": "..." }
     EOF
     python3 .virgil/scripts/library/update_master_bib_entry.py "<citekey>" \
       --entry-type "<the @type in base.bib>" \
       --fields-file "$t/set.json" \
       --merge-existing \
       --base-raw-file "$t/base.bib" \
       --base-type "<the @type in base.bib>"
     rc=$?
     rm -rf "$t"
     echo "exit=$rc"
     ```

     `--merge-existing` keeps every field you did not name; the `--base-*`
     pair holds any field that changed on disk since you read it. **Branch
     on the exit code** — the ONE table is `update_master_bib_entry.py
     --help` (task 796), the same one `/library/apply-bib-edit` step 2
     walks:

     - **0** — applied.
     - **5** — applied EXCEPT the fields stderr lists as held (changed on
       disk since you read the entry); report them in your reply.
     - **6** — refused, nothing written (the entry is gone). Report stderr
       verbatim; skip the resync and catalog steps below.
     - **2** — bad invocation, nothing written. Report it and **release**
       the request (do not retire it) — the user's ask is still unanswered.
     - **7** — the entry has unbalanced braces, nothing written. Report
       stderr verbatim and **release** (do not retire); it needs a human
       repair.

     Do not pass `--bib-state` or `--allow-field-drop`. Then run that skill's step 3
     (`resync_paper_bib.py`) and step 4 (catalog `fieldChanges`, with
     `source` naming where each value came from) — its claim, notification
     and retire steps belong to a `bib-edit` request, not to yours; your
     request retires in step 3 below.

   - **`paper` scope (`kind=paper-review`):** the note is about the
     paper text in `papers/<citekey>/main.tex`. Read the file, find the
     section/element the note refers to, and fix it. **With no note**,
     there is no element to find: run `/library/di-validate <citekey>` for
     the punch-list, fix only what it flags unambiguously, and report the
     rest rather than guessing at what the user meant. If the request
     requires re-running the linearization pipeline (e.g. "re-extract
     section 3" or "this paper has a two-column layout"), invoke the
     relevant scripts (`.virgil/scripts/library/index_paper.py`, `.virgil/scripts/library/extract.py`)
     scoped as narrowly as you can. Save the updated `main.tex`. Then
     signal the frontend via the locked CLI shim:
     ```bash
     python3 .virgil/scripts/library/bump_catalog_version.py
     ```

3. **Mark done.** Once a request you claimed is handled, retire THAT
   request through the queue door — never delete a queue file by hand.
   The door writes the `.done` marker, leaves a request the user re-filed
   mid-run queued (`"superseded"`), and for `authenticate` also drops the
   matching row from `.virgil/queue/pending-reviews.json` (never edit that
   manifest by hand):
   ```bash
   python3 .virgil/scripts/library/queue_slot.py retire --kind <kind> --citekey <citekey> --requested-at "<requestedAt from the step-2 claim>"
   ```

4. **Report.** Print a final summary of what you did per request:

   ```
   AI requests: handled 2.
     • smith2020       (bib)   — filled doi, year; staged bib-edit.
     • jones2018       (paper) — re-extracted section 3 in main.tex; bumped version.
   ```

## What this command does NOT do

- Does **not** drain `kind=index` / `kind=reindex` / `kind=triage` /
  `kind=bib-edit` / `kind=import-bib` entries (import-bib belongs to
  `/library/import-bib`, note or no note).
- Does **not** run vanilla `authenticate` entries (those without a
  note). They stay in the queue for `/library/index-pending` to pick up.
- Does **not** invoke `.virgil/scripts/library/drain_queue.py` — that's the general
  indexing path and is the wrong tool for AI requests.

## When the candidate list is empty

Reply with a single line:

```
No pending AI requests.
```

No further work.

## Pairing with /loop

`/loop /library/ai-requests` is the right shape for "babysit my AI requests
while I keep adding them." The user typically runs this in a session
separate from `/loop /library/index-pending` so the two queues don't fight.
