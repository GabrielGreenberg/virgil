---
description: |
  Triage one newly-dropped source file in the library's unsorted/
  folder — propose a citekey, move the file into its paper folder, and
  queue it for indexing (or authentication, for .bib drops). Triggers
  on: "triage <filename>", "process the file I just dropped", "name
  this paper", "Virgil, what should we call this PDF". Accepts PDF,
  DOCX, .tex, and .bib drops. For .bib files (multi-entry fan-out),
  each entry becomes a bib-only paper folder plus a master.bib entry
  queued for authentication. Light — safe to invoke
  from a paper session with --library, though the file needs to be in
  the library's unsorted/. Does NOT trigger for already-indexed papers
  (use /library/deep-index) or batch processing (use /library/triage-pending). Args:
  <filename> (relative to unsorted/) [--library <path>].
---

# /library/triage-pdf $ARGUMENTS

## Args

- `<filename>` — the dropped file to triage, relative to the library's
  `unsorted/` folder.
- `--library <path>` — override library-path resolution. Useful when
  invoking this skill **from a paper session** with multiple libraries on
  disk; without it the normal chain
  (the cwd when it is a library → `./.virgil/library-path.json` →
  `VIRGIL_LIBRARY_ROOT` → `~/.config/virgil/library-path.json` →
  `~/Virgil-Library/`, each validated) is used.
  Note this selects *which library* to triage in — the file itself must
  already sit in that library's `unsorted/`.

## Bootstrap (run this first)

This skill operates on the user's Virgil Library. Resolve the library
root and cd into it before running anything else — that way the skill
works from any Virgil-managed folder.

```bash
# Set from the invocation above: LIBRARY holds the value of an explicit
# `--library <path>`, and stays empty when the caller didn't pass one.
# Build the flag as an ARRAY, not a `${LIBRARY:+--library "$LIBRARY"}`
# string — under zsh that idiom collapses into ONE argument
# ("--library /path") and argparse rejects it. Empty array = zero args,
# so an absent flag falls through to the normal resolution chain.
LIBRARY=""   # e.g. LIBRARY="/Users/me/Papers/Virgil-Library"
lib_args=()
[ -n "$LIBRARY" ] && lib_args=(--library "$LIBRARY")

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
library_root="$(python3 "$library_path_py" --get "${lib_args[@]}" 2>/dev/null)" || {
  echo "No library set up. Pick a library in Virgil first."
  echo "  (Or run: python3 $library_path_py --set <abs-path>)"
  exit 1
}
cd "$library_root"
export VIRGIL_LIBRARY_ROOT="$library_root"
```

All paths in the rest of this skill resolve against the library root.

---

Take a freshly-dropped source file in `$library_root/unsorted/<filename>`
and turn it into a properly-located paper folder + queue request.

Supported source kinds:

**Every kind goes through the ONE triage engine** — `triage_batch.py --only
<filename>` proposes the row(s), you review them, `triage_apply.py` applies
them (task 1601). It is the same engine `/library/triage-pending` runs over the
whole inbox, so a drop gets the same citekey, duplicate handling, move and park
semantics from either skill. This skill adds only JUDGMENT — reading the file
and correcting the proposed row — never a step of its own that moves a file,
writes `master.bib`, queues a request or mints a citekey.

- **`.pdf`** — one row; on apply, full PDF indexing (extraction → `main.tex` with `\pgmark{N}`).
- **`.docx`** — one row; same flow, structured extraction (no pgmark).
- **`.tex`** — one row; already LaTeX, so the indexer copies it into `papers/<citekey>/main.tex` verbatim (`index_paper.py`'s `tex-passthrough` branch). Defaults to `@unpublished` unless a DOI is present.
- **`.bib`** — multi-entry fan-out. **This bullet is the one statement of what a `.bib` entry becomes; everything else in this family points here.** The ordinary outcome (`status: bib-imported`) is three things:
  1. its block in `master.bib`, carrying `% bib.state = unverified` (`manuscript` when the row proposes it). That comment is the F#4 **home** for the auth state; `build_bib_index` projects it into `bib-index.json` — *at process exit*, so the file is stale for the whole apply run and is not a way to check your own work mid-run.
  2. a **bib-only paper folder** — `papers/<citekey>/references.bib` + empty `virgil/` sidecars, no source file and no `main.tex`.
  3. a queued `kind: "authenticate"` in its own slot `.virgil/queue/<citekey>-auth.json` — skipped for an explicit `manuscript`. Every request goes through the queue-slot door (`queue_slot.py`): a pending authenticate already there is left alone (summary: "authenticate already queued"), one being processed refuses the write (summary: "authenticate NOT queued (…)"), and a queued `index` for the same citekey no longer blocks it.

  **The catalog row.** The write gate is the shared `_tools.admit_catalog_row`, and it asks about the PAPER FOLDER, not about the drop — `paper_has_holdings(papers/<citekey>/<citekey>.{tex,docx,pdf})`:
  - **No source document on disk** (the normal `.bib` case — a *reference-only* entry, cited but not held): the gate answers **no**, and under F#4 **no row is minted**. Before answering it discharges the state to the `% bib.state` comment and REFRESHES an already-existing row for that citekey without minting one. Such rows are real and common — a pre-F#4 library still carries them (the reporting library: 3 722 rows against 24 082 master entries) and **nothing in the shipped flow prunes them** (`prune_catalog_present_false --apply` has no caller). So do not assume the row is absent either: assume only that a `.bib` import never CREATES one.
  - **The citekey names a paper that IS held on disk**: the gate answers **yes** and touches nothing; `_upsert_catalog_row_bib_only` then writes a real holdings row — refreshing an existing one in place (preserving `addedAt`/`tags`/`pdf`/`indexed`, appending `fieldChanges`), or appending a new one with `pdf.present: true`.

  **Every other per-entry outcome produces none of (1)–(3).** The ones you will meet: `bib-ignored` — the existing entry's state is settled (`TERMINAL_BIB_STATES`), so the drop is discarded and master.bib is left byte-unchanged; `bib-folded` — the work-identity guard matched the work under a DIFFERENT citekey, so an alias is recorded in `.virgil/aliases.json` and nothing else is written; `bib-skipped-no-citekey` — the row carried no citekey; `bib-parse-failed` — the whole file failed to parse; `bib-master-unreadable` — master.bib could not be read, so the row is not applied rather than merged against nothing; `error` — the row raised. Do not treat that list as closed: the statuses are whatever `apply_row` in `triage_apply.py` returns, and the apply output prints each row's `[<status>]`.

  **The source `.bib`** is deleted from `unsorted/` only when EVERY row's status is in `triage_apply.BIB_SOURCE_CLEAN_STATUSES` (`bib-imported`, `bib-ignored`); any other status parks the whole file under `_pending/` with a `triage-bib-parse-failed` notification. That includes `bib-folded` and `bib-skipped-no-citekey`, so a file that imported cleanly apart from one duplicate is quarantined under a parse-failure notice.

  **Where the entry appears.** In the library list, as a **synthetic row projected from `bib-index.json`** — but only when the catalog does not already name the citekey: `LibraryView` suppresses the synthetic row for any citekey the catalog holds, so a stale pre-F#4 row SHADOWS the live projection (which is why the gate refreshes it). PDF view shows "No PDF on disk"; text view stays dormant.

> **Where any memo you write goes.** Library memos (notes about this
> pipeline — retros, indexing-flow ideas) → `.virgil/memos/<YYYY-MM-DD>-<slug>.md`.
> A reflection about Virgil's *skill set* is a dev-loop note, **not** a library
> memo — never file a reflection under `.virgil/memos/` (see `.claude/virgil/memos.md`).
> Paper-specific notes → `papers/<citekey>/notes/<slug>.md`.
> Never drop a markdown file at the library root.

## Steps

All paths below are relative to the library root (the current working
directory).

**This file's triage request** (`.virgil/queue/_triage-<slug>.json`, filed by
the app when the file was dropped) **is `triage_apply.py`'s to close** (task
1600): it claims the request before the file's row and, after, retires it when
the file has left `unsorted/` (moved, parked) or releases it `failed` when the
file is still there. So do NOT claim it up front — a request this skill held
would be one apply cannot claim. Only a run that ends WITHOUT reaching step 3
touches it, through the queue door, by the file's name (never a glob — that is
every other pending drop too):

- **Source already gone** (task 1600) — `unsorted/<filename>` does not exist:
  an earlier run triaged it or the user removed it. Say so in one line ("source
  already gone — nothing to triage") and RETIRE the request — releasing would
  only walk it to `poisoned`:
  ```bash
  claim=$(python3 .virgil/scripts/library/queue_slot.py claim --kind triage --file "<filename>")
  echo "$claim"
  python3 .virgil/scripts/library/queue_slot.py retire --kind triage --file "<filename>" --requested-at "<requestedAt from the claim, or empty>"
  ```
  (`{"result": "nothing-claimable"}` means nothing was queued: pass `""`.)
- **A stop before step 3** (task 1575) — the source is present but step 1
  refuses it, or anything else ends the run: report first, then claim the
  same way and RELEASE it, so the next drain retries it (`poisoned` after
  three failures) instead of it sitting `running` for an hour:
  ```bash
  python3 .virgil/scripts/library/queue_slot.py release --kind triage --file "<filename>" --requested-at "<requestedAt from the claim, or empty>" --error "<one line: why you stopped>"
  ```

1. **Propose — run the engine on THIS file alone.** The rows outlive this call
   (you review them in step 2 and apply them in step 3), so mint the run's
   scratch directory and carry the printed path as `<runDir>` into every later
   block, per [_scratch.md](_scratch.md):
   ```bash
   run_dir=$(mktemp -d "${TMPDIR:-/tmp}/virgil-triage-pdf.XXXXXX") || exit 1
   echo "runDir=$run_dir"
   python3 .virgil/scripts/library/triage_batch.py \
     --library . --only "<filename>" --output "$run_dir/triage.jsonl"
   ```
   `--only` takes a bare filename relative to `unsorted/` and errors (exit 2)
   rather than falling back to the whole inbox — **without it
   `triage_batch.py` triages every drop in `unsorted/`**, which is
   `/library/triage-pending`'s job, not this skill's. Scoping the BATCH scopes
   the whole pipeline: the apply step is driven entirely by the rows in the
   JSONL and sweeps `unsorted/` for nothing of its own. An exit-2 refusal is a
   stop (release the request, above).

   A `.pdf`/`.docx`/`.tex` drop is ONE row; a `.bib` drop is one row PER ENTRY
   (each flagged `bib-only`, carrying the verbatim `bibEntryRaw`). The row's
   fields — `proposedCitekey`, `proposedType`, `proposedFields`, `flags`,
   `byline`, `textPreview`, `notes`, and for a variant `existingCitekey` — are
   described once, in `/library/triage-pending` step 1; the flag vocabulary is
   open, so ask the script rather than reading a list:
   ```bash
   python3 .virgil/scripts/library/triage_batch.py --print-flags
   ```

2. **Review — read the file and correct the row.** This is the skill's whole
   job: the engine's heuristics are cheap, you can READ. Edit
   `<runDir>/triage.jsonl` in place. Every value you put there must come from
   the file itself — a field it does not show stays out rather than guessed;
   authentication fills it later. That is the find-or-surface rule
   ([_find-or-surface.md](_find-or-surface.md)).

   **A `.bib` row needs no reading** — the engine parsed the entry verbatim.
   Leave its rows alone unless one is plainly wrong, and skip to step 3. **Do
   not hand-roll a `.bib` row**: a hand-built row loses `bibEntryRaw`, the
   `citekey-exists` collision flag and an `@unpublished` entry's `manuscript`
   state (task 511).

   For the other kinds, read the source:

   For `.pdf` (pages 1–4 — the year/DOI check needs more than page 1):
   ```bash
   pdftotext -f 1 -l 4 unsorted/<filename> -
   ```

   For `.docx` (core properties first; the first paragraphs when they are
   empty):
   ```bash
   python3 -c "import sys; sys.path.insert(0, '.virgil/scripts/library'); from extract_docx import core_properties; import json; print(json.dumps(core_properties('unsorted/<filename>'), indent=2))"
   ```

   For `.tex`: `\title{...}`, `\author{...}`, `\date{...}` and the first
   ~2000 characters of the body (DOI / ISBN / year) — the engine already read
   them with `_read_tex_meta()`; check its row against the source.

   Then correct the row:

   - **Author and year.** The filename convention `<YYYY>-<Surname>.pdf`
     records acquisition, not publication, so the filename may disagree with
     the document. If the lead surname in the page-1 byline is not the
     filename's, or pages 1–4 give a different year (`© YYYY`, `First
     published YYYY`, `Vol. N (YYYY)`, a DOI carrying a year, a `Received:` /
     `Accepted:` date), correct `proposedFields`, add the `filename-mismatch`
     flag with `filenameAuthor` / `contentAuthor` (apply writes the
     `triage-filename-mismatch` audit notification from them), and re-derive
     the citekey with the ENGINE's rule — never a rule of your own:
     ```bash
     python3 -c "import sys; sys.path.insert(0, '.virgil/scripts/library'); from triage_batch import _propose_citekey; print(_propose_citekey('<surname>', '<year>', '<title>', ''))"
     ```
     An empty answer means the parts are unusable (a stopword surname, no
     year): leave the row to apply's `needs-metadata` quarantine.
   - **DOI.** Search pages 1–4 for `\b10\.\d{4,9}/[^\s'"<>]+` and put it in
     `proposedFields.doi` — strong evidence for the year and journal; prefer
     DOI-derived metadata over filename guesses.
   - **Fields the title / copyright page shows** — they materially improve
     authentication and most cannot be recovered later. Add each to
     `proposedFields` when present:

     | Field        | Look for                                                                      |
     | ------------ | ----------------------------------------------------------------------------- |
     | `editor`     | "Edited by", "Editors:", "ed. X", "eds. X and Y" — use this **instead of** `author` for edited volumes |
     | `translator` | "translated by", "trans.", "Translator:" (matters for translated classics)    |
     | `series`     | A series name on the title page, e.g. "Studies in Applied Philosophy"         |
     | `edition`    | "Second edition", "3rd ed.", "Revised edition" on the copyright page          |
     | `isbn`       | ISBN on the copyright page (regex `\b(?:ISBN[-:]?\s*)?\d{9,13}[Xx]?\b`) — strip dashes |
     | `address`    | Publisher city on the title or copyright page (e.g. "New York", "Cambridge, MA") |

   - **Entry type** (`proposedType`). Journal article → `article` (the
     default; `author`, `title`, `journal`, `year`, `volume`, `number`,
     `pages`, `doi`). Monograph → `book` (`publisher`, `address`, `edition`,
     `isbn`). Chapter in an edited volume → `incollection` (`booktitle`,
     `editor`, `publisher`, `pages`). Excerpt from a single-author book →
     `inbook` (`booktitle`, `chapter`, `pages`). Signals for book types: a
     copyright page with publisher/ISBN, "Edited by" on the title page,
     "Chapter N" headers, no journal/volume metadata. When uncertain, leave
     `article` — authentication corrects it.
   - **Preprints / forthcoming.** Page 1 says "Manuscript", "Penultimate
     Draft", "Pre-print", "Preprint", "Forthcoming", "Draft — please do not
     cite", "Under review", or carries a lingbuzz ID (`lingbuzz/\d+`) — the
     engine flags `preprint` when it sees one: set `proposedType` to
     `unpublished`, `proposedFields.note` to the document's own phrasing
     (`Preprint`, `Forthcoming`, …) and, for lingbuzz,
     `proposedFields.url = https://ling.auf.net/lingbuzz/<id>`. A DOI stays —
     it may name the published version, which authentication reconciles.
   - **SEP entries** (`sep` flag, a `plato.stanford.edu/.../entries/<slug>/`
     URL): `proposedType` `incollection`, `booktitle` "The Stanford
     Encyclopedia of Philosophy", `editor` "Edward N. Zalta and Uri
     Nodelman", `publisher` "Metaphysics Research Lab, Stanford University",
     `url` `https://plato.stanford.edu/entries/<slug>/`, and the citekey
     suffixed `sep` so it never collides with a non-SEP work by the same
     author/year. SEP is in no DOI registry; authentication short-circuits to
     `authenticated` on the URL.
   - **A whole edited volume, not one chapter.** Page 1 carries a handbook
     signal ("Cambridge/Oxford/Routledge Handbook", "Edited by" with several
     editors, "Series Editor", "General Editor", a TOC of chapters by
     different authors) AND the filename's surname is not on the title page:
     a stub under that surname would be a wrong-bib entry. Make sure the row
     carries the `whole-handbook` flag (the engine sets it when it sees the
     signal) and a `notes` line naming the handbook title — apply parks the
     file in `unsorted/_pending/` through the no-clobber park door and writes
     the `triage-needs-chapter-info` notification (with `parkedAs`), before
     any `master.bib` write. This is the one failure mode that legitimately
     needs a human: see the reply format below.
   - **A copy of a paper the library already holds.** The engine detects a
     numbered variant scan (`<base>.<N>.<ext>`) from the catalog and flags it
     `variant-copy` with `existingCitekey`; apply archives it under
     `papers/<existingCitekey>/variants/`. If you can see the drop is the
     same work as an existing entry under a different key, you may set
     `proposedCitekey` to that existing key — the same edit a
     `/library/triage-pending` reviewer may make. Apply then fills a source
     gap (entry with no source on disk), supersedes (a different format is
     held — `docx` outranks `pdf`, by `_tools.SOURCE_FORMAT_PRIORITY`: a
     higher format is placed alongside and queued `reindex`, a lower one is
     kept as an archive with nothing queued), or REFUSES a same-format
     collision rather than replace the held file. Leave the key as proposed
     and apply's work-identity guard instead flags `triage-duplicate-work`
     and indexes it anyway — it never silently drops the second copy.
   - **A `needs-metadata` / `needs-title` row** (or no `proposedCitekey`).
     Fill a citekey / year / title only from what the file shows. If it does
     not show it, leave the row: apply quarantines it (`_needs-metadata/` or
     `_pending/`) through the park door, which is the honest outcome.

   A citekey is a folder name — keep any key you edit path-safe (no `/`, `\`,
   leading `.`); apply refuses an unsafe one before writing anything.

3. **Apply.**
   ```bash
   python3 .virgil/scripts/library/triage_apply.py \
     --input <runDir>/triage.jsonl --library .
   rm -rf <runDir>
   ```
   (Keep `<runDir>` instead if apply failed — the fix is to edit that JSONL
   and re-run it, never to hand-perform a step.)

   Apply does everything that writes, once, for both triage skills: the
   `master.bib` stub (through the locked shim, `bib.state = unverified`),
   the move into `papers/<citekey>/<citekey>.<ext>` (refusing to replace a
   file), every park, the queue request through the queue-slot door, the
   notifications (an OPEN vocabulary —
   `python3 .virgil/scripts/library/triage_apply.py --print-notification-kinds`),
   closing this file's triage request (`[request <result>] <filename>`), and
   the one catalog-version bump. Its per-row statuses are stated in
   `/library/triage-pending` step 3; the ones you will meet for one file:
   `triaged` (queued for indexing), `archived` (a lower-priority format kept
   beside the held source; nothing queued), `variant`, `needs-chapter-info`,
   `needs-title`, `needs-metadata`, `collision` (refused — the file stays in
   `unsorted/` and its request is released), `triaged-unqueued` (moved, but
   the index slot refused the request — say so), and the `bib-*` family.

## Reply format

One line per row, from apply's output:
`Triaged <filename> → <citekey>; queued for indexing` — or the status apply
printed when it is not `triaged` (archived, parked, refused, unqueued).

If the citekey is uncertain (multiple plausible candidates), pick one and note
the alternatives in your reply.

**A `needs-chapter-info` park** — name the parked file (apply's `parkedAs`)
and ask the user for the chapter title, chapter author(s) and page range, then
to move that file back from `_pending/` into `unsorted/` and re-run
`/library/triage-pdf <name>` with that context, where `<name>` is the
basename of `parkedAs` (a library-relative path) — which differs from the
original `<filename>` when the park had to de-collide it.
Nothing in the app prompts for this yet — the `triage-needs-chapter-info`
notification is a record, not a form — so your reply is the only place the
user learns what to supply. A hand move files no queue request (only the app's
drop, `dropUnsortedSource` in `library/lib/queue.ts`, files one), and none is
needed: `triage_apply.py`'s `claim_triage_request` treats a hand-dropped file
as "nothing claimable" and triages it all the same, while the old request was
already retired by the park.

**A `.bib` drop** — report apply's per-entry lines and its per-file
`triage-bib-summary`. What each entry became, and when the source `.bib` is
deleted versus parked, is stated once in the `.bib` bullet under **Supported
source kinds** above.
