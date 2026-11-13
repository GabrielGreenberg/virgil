---
description: |
  Import ONE library paper's bibliography — fold
  `papers/<citekey>/references.bib` into the central `master.bib`. The
  single-paper slice of `/library/merge-bibs`: it runs the same per-entry
  engine (duplicate-detect → authenticate → transient-skip → locked
  master.bib write) for a single citekey, then — **when the paper has a
  catalog row** — marks it imported on that row (the blue "imported"
  check) and snapshots its references.bib citekey set so a later
  *addition* clears the flag. Step 2 states the reference-only branch,
  where there is no row and no check; the master.bib fold is the real
  work either way.

  Triggers on: "import this paper's bibliography", "import bib for
  <citekey>", "fold <citekey>'s references into master", or as the
  drain target for an `import-bib` AI request filed from the Library
  (the "Import bibliography" item in the paper header's AI-requests
  menu / the catalog row's ⋮ menu → `.virgil/queue/<citekey>-importbib.json`).

  Does NOT trigger for the whole-library merge — that's
  `/library/merge-bibs`. Does NOT verify a single bib entry — that's
  `/library/authenticate-bib`. Does NOT sync a working paper's bib
  against the library — that's `/editor/sync-bib-to-library`.

  Args: `<citekey>`.
---

# /library/import-bib $ARGUMENTS

Import one paper's `references.bib` into the library's `master.bib`.
Lightweight by design — it does NOT take the snapshot/preflight/postflight
machinery of `/library/merge-bibs` (that's for the whole-library sweep).
The engine self-locks every shared-file write, so a single-paper run is
safe to invoke directly.

> **Shared doctrine — find-or-surface, never fabricate.** Read
> [_find-or-surface.md](_find-or-surface.md). The per-entry fold engine
> **authenticates** each imported entry before writing it to
> `master.bib` — so this skill can add a sourced row. Never fake one:
> let each entry's terminal auth state (`unverified` / `failed` /
> `canonical`) be the surfaced gap, and do not upgrade a low-confidence
> match to `authenticated` by hand.

## Bootstrap (run this first)

Resolve the library root and cd into it before running anything else.

```bash
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

All paths below resolve against the library root.

## Args

`$ARGUMENTS` is a single `<citekey>` (its one dispatch caller,
`/library/index-pending`, always passes it explicitly — `/library/ai-requests`
never routes `import-bib`). If it's empty (a bare manual invocation), fall back
to the first CLAIMABLE `import-bib` request — `queue_slot.py claimable` is the
one owner of "which requests may a worker take now" (task 1598: waiting,
failed-and-retryable, or an abandoned claim), so a running or poisoned request
is never picked up by hand-parsing the queue. Resolve it into `CK`:

```bash
CK="$(printf '%s' "$ARGUMENTS" | awk '{print $1}')"
if [ -z "$CK" ]; then
  CK="$(python3 .virgil/scripts/library/queue_slot.py claimable \
    | python3 -c 'import json,sys
for l in sys.stdin:
    d = json.loads(l)
    if d["kind"] == "import-bib" and d["citekey"]:
        print(d["citekey"]); break')"
fi
if [ -z "$CK" ]; then
  echo "No citekey given and no claimable import-bib request found — nothing to do."
  exit 0
fi
echo "Importing bibliography for: $CK"
```

If the request came from the queue, read the file and **echo any `note`
verbatim** before acting — the user may have attached instructions:

```bash
qfile=".virgil/queue/${CK}-importbib.json"
[ -f "$qfile" ] && python3 -c "import json; d=json.load(open('$qfile')); n=d.get('note'); print('NOTE:', n) if n else None"
```

Then **claim** the request through the queue door before working it, so
a racing run (or the app) won't take it and a request the user re-files
while you work is not retired unworked. `REQ` is the claimed request's
`requestedAt` — empty when nothing was claimable (invoked directly with
nothing queued, or another worker holds it); step 4 hands it back:

```bash
REQ="$(python3 .virgil/scripts/library/queue_slot.py claim --kind import-bib --citekey "$CK" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("requestedAt") or "")')"
```

**A run that STOPS without finishing RELEASES the claim** (task 1575) —
the merge engine exiting non-zero, or any error that ends the run before
step 4. Report first, then:

```bash
python3 .virgil/scripts/library/queue_slot.py release --kind import-bib --citekey "$CK" --requested-at "$REQ" --error "<one line: why you stopped>"
```

A claim left behind stays `running` for an hour (the app refuses the
user's re-file as "already being processed", and merge-bibs refuses to
start); released, the request is `failed` — re-fileable at once, retried
by the next drain, `poisoned` after three failures.

## Steps

1. **Confirm there is something to import.**
   ```bash
   test -f "papers/${CK}/references.bib" || { echo "no references.bib for ${CK} — nothing to import"; }
   ```
   If absent, retire the request (step 4) and stop with that message.

2. **Run the merge engine for this paper.** It does the dedup →
   authenticate → transient-skip work, writes
   `.virgil/merge-reports/<citekey>.json`, and — when the paper has a
   catalog row (see the branch below) — marks it imported. Every catalog
   write bumps `catalog-version.txt` (the bump rides `write_catalog`), and
   marking the paper is not the only one: a cited entry that is itself a
   HOLDING gets its own row's auth state written (`_upsert_catalog_row`),
   so even a reference-only paper's run can bump. Whether it did is not
   yours to track. One-line summary on stdout, the same six fields on
   every path (`Report.summary_line`: `+A ~D ⇄U ⤬T ⚠F ?M`, with
   `(no references.bib)` / `(empty references.bib)` appended on the two
   early exits).
   ```bash
   python3 .virgil/scripts/library/merge_paper_references.py "${CK}"
   ```
   A non-zero exit is a stop: report its stderr verbatim, release the
   claim (above), and stop — never retire a fold that did not run.
   Where a bump happens the frontend's catalog-version poll handles the
   UI refresh within ~6s — no extra bump needed from you, ever.

   **The imported flag, and when it is withheld — this is the one
   statement of that branch; everything else in this file points here.**
   `bib.imported` / `bib.importedAt` / `bib.importedKeys` live on the
   **catalog row**, and the blue check is rendered from `bib.imported`
   alone. Under the **F#4 holdings model** the catalog holds HOLDINGS
   (something on disk), so a *reference-only* citekey — cited but not
   held — has **no row**, and there is nothing to stamp:
   `_tools.mark_bib_imported` routes through `update_catalog_entry`,
   which raises `KeyError` for a missing row; the engine catches it and
   records `"no catalog row to mark imported"` in the report's `notes[]`
   — which the engine writes to disk AFTER that branch, deliberately, so
   the note is in the artifact you read and not only in its memory.
   Nothing is marked and no check appears, and **that is a correct run,
   not a failure**: the `master.bib` fold is the real work, and the
   one-line summary above is what says whether it added anything.
   (The exit-code block in
   [`/library/authenticate-bib`](authenticate-bib.md) step 7 is the
   family's statement of the same F#4 branch, and
   [`/library/apply-bib-edit`](apply-bib-edit.md) points at it too.)

   **This is a live path, not a corner.** A `.bib` fan-out entry gets a
   bib-only `papers/<citekey>/` folder with a `references.bib` in it
   (the `.bib` bullet in [`/library/triage-pdf`](triage-pdf.md) states
   the full outcome), so step 1's `test -f` passes; and the Library list
   renders reference-only entries as synthetic rows carrying the same
   row action menu — including the **Import bibliography** item that
   queues this very request.

   So: **read `notes[]` from the report before you claim the flag
   moved.** If it holds `no catalog row to mark imported`, say so in
   step 5 rather than announcing a check the user will not see.

3. **Surface manual review, if any.** Read the report. If
   `manual_review[]` is non-empty, briefly look at each item (an entry's
   current `master.bib` block comes from the read door,
   `python3 .virgil/scripts/library/master_entry.py <key>` — exit 0 found,
   3 absent, 2 unreadable; never `Read` master.bib itself) and tell the user what
   needs a human decision. Do NOT silently drop them — a re-run won't
   help these specific entries, and where the paper HAS a catalog row it
   is marked imported regardless, so the user needs to know. For `split_paper_unauthenticatable` /
   `split_citekey_collision` items, default to deferring to the user.

4. **Mark the request done** — through the queue door, never by deleting
   the file. It retires only the request you claimed (a re-filed one stays
   queued as `"superseded"`); with `REQ` empty it retires nothing:
   ```bash
   python3 .virgil/scripts/library/queue_slot.py retire --kind import-bib --citekey "$CK" --requested-at "$REQ"
   ```

5. **Report.** One line:
   ```
   Imported <citekey>: +<added> ~<dup> ⇄<unauth-dup-handled> ⤬<transient> ⚠<failed> ?<manual>.
   ```
   Then, **only when the report's `notes[]` holds `no catalog row to
   mark imported`**, one more (step 2 states the branch):
   ```
   Reference-only entry — no catalog row, so no "imported" check.
   ```
   Say nothing about the fold there; the `+<added>` count above already
   reports it, and an empty `references.bib` reaches this same branch
   having folded nothing. Do not announce the check unconditionally: an
   unqualified "marked imported" for a reference-only citekey sends the
   user looking for a badge that cannot appear.

## Hard rules

- Operates on the user's real library — no test fixtures.
- Do not edit any file under `library/skills/` or `library/scripts/`.
- Do not invoke other `/library/...` skills from here — your job is to
  run the merge helper for one paper and surface its output.
- Never Read/Write `master.bib` or `.virgil/catalog.json` directly — the
  engine's locked writers own those.
