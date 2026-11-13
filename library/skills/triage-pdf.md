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

- **`.pdf`** — full PDF/DOCX-style indexing (extraction → `main.tex` with `\pgmark{N}`).
- **`.docx`** — same flow, structured extraction (no pgmark).
- **`.tex`** — already LaTeX. Passthrough copy into `papers/<citekey>/main.tex`; queue index. Defaults to `@unpublished` unless a DOI is present.
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

0. **Claim this file's triage request** through the queue door, before
   anything else. The app filed it as `.virgil/queue/_triage-<slug>.json`
   (one per dropped file); the door finds it by the file's name, so you
   touch only THIS file's request — never another drop's:
   ```bash
   python3 .virgil/scripts/library/queue_slot.py claim --kind triage --file "<filename>"
   ```
   It prints `{"result": "claimed", "requestedAt": …}` — keep that
   `requestedAt` for step 10 — or `{"result": "nothing-claimable"}`
   (invoked directly with nothing queued: carry on, and pass `""` in
   step 10).

   **A run that STOPS short of step 10 RELEASES the claim** (task 1575) —
   an error that ends the run (step 8's refused master.bib write, an
   unreadable source, anything else). Report first, then:
   ```bash
   python3 .virgil/scripts/library/queue_slot.py release --kind triage --file "<filename>" --requested-at "<requestedAt from step 0, or empty>" --error "<one line: why you stopped>"
   ```
   A claim left behind stays `running` for an hour; released, the request
   is `failed` — re-triaged by the next drain, `poisoned` after three
   failures. A COMPLETED path (variant, whole-handbook, `.tex`, `.bib`
   fan-out) is not a stop: it retires at step 10.

   **A source that is already GONE is not a failure either** (task 1600).
   If `unsorted/<filename>` does not exist, the file was triaged by an
   earlier run (`triage_apply.py` normally retires the request itself) or
   the user removed it: there is nothing to triage, and releasing would
   only walk the request to `poisoned`. Say so in one line ("source
   already gone — nothing to triage") and go straight to step 10 to
   RETIRE the request. Only a source that is PRESENT but unreadable is a
   stop that releases.

1. **Read metadata.** Branch on extension:

   For `.pdf`:
   ```bash
   pdftotext -f 1 -l 4 unsorted/<filename> -
   ```
   (Read pages 1–4 — we need more than page 1 for the year/DOI check
   in step 3.)

   For `.docx` (Word documents have explicit core properties + paragraph
   styles, so we read both):
   ```bash
   python3 -c "import sys; sys.path.insert(0, '.virgil/scripts/library'); from extract_docx import core_properties; import json; print(json.dumps(core_properties('unsorted/<filename>'), indent=2))"
   ```
   This returns `{title, author, created, modified, first_paragraphs}`. Use
   the core properties first; fall back to scanning the first paragraphs if
   they're empty.

   For `.tex` (LaTeX manuscript): parse `\title{...}`, `\author{...}`,
   `\date{...}`, plus the first ~2000 characters of the body for DOI /
   ISBN / year detection. The shared helper is in `triage_batch.py`'s
   `_read_tex_meta()`. A `.tex` source without a DOI defaults to
   `@unpublished`; with a DOI, treat as `@article` and let
   `/library/authenticate-bib` confirm.

   For `.bib` (BibTeX file with one or more entries): **stop here and run
   the `.bib` handling (multi-entry fan-out) procedure at the end of this
   file.**
   A `.bib` drop is not one document — it fans out to one triage row per entry,
   and the batch engine (scoped with `--only`) is what builds those rows. Do not
   parse it by hand: a hand-rolled row loses the verbatim entry text, the
   `citekey-exists` collision flag, and an `@unpublished` entry's `manuscript`
   state.

2. **Propose a citekey** from the title + first author + year. Convention:
   `<LastName><Year>` (e.g. `Smith2020`). If the year is missing, use
   `<LastName><LastName2>`. If a collision exists in `master.bib` or
   `papers/`, append `a`, `b`, etc.

3. **Sanity-check filename against source pages.** The filename convention
   `<YYYY>-<LastName>.pdf` uses acquisition date, not publication year,
   so the filename metadata may disagree with the document itself. Before
   proceeding, verify:

   - **Author.** Extract the byline from page 1. If the lead author
     surname in the filename does not appear in the page-1 byline,
     adopt the page-1 lead author surname instead.
   - **Year.** Scan pages 1–4 for any of: `© YYYY`, `First published
     YYYY`, `Vol. N (YYYY)`, a DOI containing a year, or a `Received:`
     / `Accepted:` date. If the in-PDF year disagrees with the filename
     year, use the in-PDF year for the citekey.
   - **DOI.** On the same pages 1–4 text, search for
     `\b10\.\d{4,9}/[^\s'"<>]+`. If found, store it — prefill it in
     the bib stub at step 7. A DOI here is strong evidence for the
     correct year and journal; prefer DOI-derived metadata over
     filename guesses.

   **Also extract these fields** when present on the title or
   copyright page — they materially improve auth quality and most
   can't be recovered later:

   | Field        | Look for                                                                      |
   | ------------ | ----------------------------------------------------------------------------- |
   | `editor`     | "Edited by", "Editors:", "ed. X", "eds. X and Y" — use this **instead of** `author` for edited volumes |
   | `translator` | "translated by", "trans.", "Translator:" (matters for translated classics)    |
   | `series`     | A series name on the title page, e.g. "Studies in Applied Philosophy"         |
   | `edition`    | "Second edition", "3rd ed.", "Revised edition" on the copyright page          |
   | `isbn`       | ISBN on the copyright page (regex `\b(?:ISBN[-:]?\s*)?\d{9,13}[Xx]?\b`) — strip dashes |
   | `address`    | Publisher city on the title or copyright page (e.g. "New York", "Cambridge, MA") |

   These flow into the auth pipeline: `isbn` enables direct Crossref
   filter and OpenLibrary fallback, `editor` is mandatory for edited
   volumes (BibTeX renders `@incollection` differently with `editor`
   vs `author`), and `series`/`edition` disambiguate between similar
   records. Capture them now or you'll need to fill them later.

   If any corrections were made, re-derive the citekey from the
   corrected author + year before continuing to step 4. **Also append
   a `triage-filename-mismatch` notification** so the user has an audit
   trail of files that were misnamed:
   ```json
   {
     "kind": "triage-filename-mismatch",
     "originalFilename": "<filename>",
     "filenameAuthor": "<lastname from filename>",
     "contentAuthor": "<lastname from page 1>",
     "newCitekey": "<corrected citekey>",
     "at": "<ISO>"
   }
   ```

4. **Check for existing entry.** Look at `master.bib` and the `papers/`
   directory.

   **First, check for a variant copy.** If the filename matches the
   pattern `<base>.<N>.<ext>` (where `<N>` is a numeric suffix like
   `.1`, `.2`) AND `unsorted/<base>.<ext>` or `papers/<base>/<base>.<ext>`
   already exists, this is a duplicate scan/offprint of an already-indexed
   paper.

   **Degenerate-base safeguard.** Refuse the variant-copy classification
   when the base stem has fewer than 2 letters (e.g., `-.<N>.pdf`,
   `<digits>.<N>.pdf`). A real citekey has letters; placeholder-named
   backlogs would otherwise collapse into a single ghost-parent cluster
   (2026-05-16-triage-no-name-pdfs.md). `triage_batch.py` enforces
   this automatically; if you're handling a single file manually and
   the base looks degenerate, treat it as a fresh row (not a variant).

   1. Read `.virgil/catalog.json` and find the entry whose `pdf.filename ==
      "<base>.<ext>"` (or whose alternates list contains it).
   2. If found, the variant belongs to that citekey. Move the file to
      `papers/<existing-citekey>/variants/<filename>` (mkdir variants/
      if needed). Skip steps 5–9 — no new bib entry, no index request — but
      still run step 10 to retire this file's triage request.
      Append a notification via the locked CLI shim:
      ```bash
      t=$(mktemp -d "${TMPDIR:-/tmp}/virgil-triage-pdf.XXXXXX")
      cat > "$t/variant-notify.json" <<'EOF'
      {
        "kind": "triaged",
        "summary": "Kept <filename> as variant archive of <existing-citekey>",
        "at": "<ISO>"
      }
      EOF
      python3 .virgil/scripts/library/append_inbox_item.py \
        --item-file "$t/variant-notify.json"
      rm -rf "$t"
      python3 .virgil/scripts/library/bump_catalog_version.py
      ```
      Then skip to step 10 (retire this file's request) and stop.
   3. If `<base>.<ext>` exists on disk but no catalog entry maps to
      it, fall through to the four cases below (mint a new citekey
      with `a`/`b` suffix as needed).

   Otherwise, there are four cases:

   a. **No bib entry, no on-disk source** → standard new-paper flow.
      Add the bib entry (step 7), move the file (step 8), enqueue
      `kind: "index"` (step 9).

   b. **Bib entry exists, no on-disk source** ("fill the source gap") →
      skip step 7, move the file, enqueue `kind: "index"`.

   c. **Bib entry exists AND a same-format source exists at
      `papers/<citekey>/<citekey>.<ext>`** → genuine collision. Append `a`/`b`/...
      to the citekey and restart from step 2.

   d. **Bib entry exists AND a *different-format* source exists at
      `papers/<citekey>/<citekey>.<other-ext>`** → this is a **supersede**. Format
      priority is `docx > pdf` (DOCX carries explicit structure that
      beats the PDF heuristics). Decide which to do:
      - If the new file is *higher* priority than the existing one
        (e.g., new=docx, existing=pdf) → skip step 7, place the new
        file at `papers/<citekey>/<citekey>.<new-ext>` *alongside* the existing
        one (don't delete the old source), and enqueue **`kind:
        "reindex"`** instead of `"index"` in step 9. The existing
        lower-priority source is preserved as an archive — the indexer
        will record it as `pdf.alternates` in the catalog.
      - If the new file is *lower* priority (e.g., new=pdf,
        existing=docx) → place it alongside as an archive but do NOT
        enqueue a re-index. The current docx-derived `main.tex` stands.
        Append a `triaged` notification noting "kept as archive; docx
        source remains canonical" so the user knows nothing was lost.

   When proposing the citekey in step 2, watch for near-matches against
   existing bib entries (slight title casing differences, "A" vs "The"
   prefixes, etc.) — prefer the existing citekey rather than minting a
   new one for what is plausibly the same paper.

5. **Whole-handbook check — refuse to mint a stub when the file is a
   whole edited volume, not a single chapter.** Trigger if first-page
   text contains BOTH:

   - A handbook signal: "Cambridge Handbook", "Oxford Handbook",
     "Routledge Handbook", "Edited by" (with multiple editors), "Series
     Editor", "General Editor", or a TOC listing chapters by different
     authors
   - The filename's proposed author surname does NOT appear on the
     title page

   When triggered, the file is the whole book — minting a stub for
   `<filename-author>2024` would produce a wrong-bib entry. Instead:

   1. Move file to `unsorted/_pending/<filename>` (mkdir if
      needed) so it's not re-triaged on the next scan.
   2. Append a notification:
      ```json
      {
        "kind": "triage-needs-chapter-info",
        "filename": "<filename>",
        "candidateAuthor": "<lastname from filename>",
        "handbookTitle": "<from page 1>",
        "at": "<ISO>"
      }
      ```
   3. Skip steps 6–9 — nothing has been written to `master.bib`, which
      is why this check runs BEFORE the stub (as `triage_apply.py` checks
      `whole-handbook` before any write) — then run step 10 (retire this
      triage request).
   4. Say so in your reply: name the parked file and ask the user for the
      chapter title, chapter author(s) and page range, then to re-run
      `/library/triage-pdf <filename>` with that context (move the file
      back from `_pending/` first). Nothing in the app prompts for this
      yet — the `triage-needs-chapter-info` notification is a record, not
      a form — so your reply is the only place the user learns what to
      supply. The re-run files a NEW request, which a retired old one
      cannot shadow.

   This is the one failure mode that legitimately needs human input —
   the skill should not guess.

6. **Flag preprints / forthcoming.** If page 1 contains any of:
   "Manuscript", "Penultimate Draft", "Pre-print", "Preprint",
   "Forthcoming", "Draft — please do not cite", "Under review", or a
   lingbuzz ID (`lingbuzz/\d+`), change the entry type to
   `@unpublished` and set:
   - `note = {Preprint}` (or `Forthcoming`, `Penultimate draft`, etc.
     — match the document's own phrasing)
   - If a lingbuzz ID was found: `url = {https://ling.auf.net/lingbuzz/<id>}`

   This DECIDES the entry type step 7 writes — decide it here, before the
   one write, rather than correcting a stub afterwards (there is no step
   that rewrites one). A preprint with a DOI keeps
   its DOI field — the DOI may point to the published version, which
   `/library/authenticate-bib` will reconcile later.

7. **Add a `master.bib` entry** if no matching one exists. Use the
   locked CLI shim — do **not** Read/Write `master.bib` directly:

   ```bash
   t=$(mktemp -d "${TMPDIR:-/tmp}/virgil-triage-pdf.XXXXXX")
   cat > "$t/fields.json" <<'EOF'
   { "author": "...", "title": "...", "year": "<YYYY>", ... }
   EOF
   python3 .virgil/scripts/library/update_master_bib_entry.py "<citekey>" \
     --entry-type "<type>" \
     --fields-file "$t/fields.json" \
     --bib-state unverified
   rc=$?
   rm -rf "$t"
   echo "exit=$rc"
   ```

   **Branch on the exit code** (the ONE table:
   `update_master_bib_entry.py --help`, task 796). **0** — added (or the
   existing entry updated); continue. **3** — the library already holds this
   work under the citekey stderr names: use THAT citekey for the rest of
   triage rather than minting a duplicate. **4** — an entry with this
   citekey exists and your fields would drop some of its fields: it is
   already in master.bib, so leave it and continue. **2** (mis-built
   command), **7** (unbalanced braces — needs a human repair) or anything
   else — nothing was written: report stderr verbatim, release the claim
   (step 0), and stop before queueing the paper.

   First, determine the entry type from the source content. If step 6
   flagged a preprint, its verdict wins: `@unpublished` with its `note`
   (and `url`, for lingbuzz) goes into THIS write. Otherwise:

   - **Journal article** → `@article` (default). Fields: `author`,
     `title`, `journal`, `year`, `volume`, `number`, `pages`, `doi`.
   - **Monograph** → `@book`. Fields: `author`, `title`, `publisher`,
     `address`, `year`, `edition`, `isbn`.
   - **Chapter in edited volume** → `@incollection`. Fields: `author`,
     `title`, `booktitle`, `editor`, `publisher`, `address`, `year`,
     `pages`, `isbn`.
   - **Excerpt from a single-author book** → `@inbook`. Fields:
     `author`, `title`, `booktitle`, `chapter`, `pages`, `publisher`,
     `year`.

   Signals for book types: copyright page with publisher/ISBN, "Edited
   by" on title page, "Chapter N" headers, absence of journal/volume
   metadata. When uncertain, default to `@article` — `/library/index-paper`
   will correct the type during authentication.

   **SEP entries get a canonical stub.** If page-1 text or a header
   contains a Stanford Encyclopedia of Philosophy URL
   (`plato.stanford.edu/.../entries/<slug>/`), use this template:
   ```bibtex
   @incollection{<Author><Year>sep,
     author = {Last, First},
     title = {<Title>},
     booktitle = {The Stanford Encyclopedia of Philosophy},
     editor = {Edward N. Zalta and Uri Nodelman},
     publisher = {Metaphysics Research Lab, Stanford University},
     year = {<Year from URL slug or copyright>},
     url = {https://plato.stanford.edu/entries/<slug>/}
   }
   ```
   The citekey suffix `sep` distinguishes this from any non-SEP work
   by the same author/year. SEP isn't in any DOI registry; the URL is
   the canonical identifier and `/library/authenticate-bib` short-circuits to
   `authenticated` when it sees the SEP URL.

   Use the title + authors + year you read (as corrected by step 3).
   Include any DOI extracted in step 3. Mark `bib.state = "unverified"`
   so `/library/index-paper` will authenticate it. Every field you put in
   `fields.json` must come from the file itself — a field it does not show
   stays out rather than guessed; authentication fills it later. That is
   the find-or-surface rule ([_find-or-surface.md](_find-or-surface.md)).

8. **Move the source file** from `unsorted/<filename>` to
   `papers/<citekey>/<citekey>.<ext>` — preserve the original extension. Do *not*
   overwrite or delete a same-citekey source of a different format
   (case 4d) — both files coexist on disk.

9. **Enqueue indexing** through the queue-slot door — never by writing the
   JSON yourself. Use `--kind index` for new papers (cases 4a, 4b) and
   `--kind reindex` for supersede (case 4d, higher-priority new source).
   Skip enqueueing entirely for case 4d when the new source is lower-priority.
   ```bash
   python3 .virgil/scripts/library/queue_slot.py write --kind index --citekey <citekey>
   ```
   The door retires a `.virgil/queue/<citekey>.done` left by an earlier run
   (otherwise the drain would skip the new request as already done) and
   refuses to overwrite a request that is being processed. It prints
   `{"result": ..., "file": ...}`; exit code **3** means the request was
   **not** queued — say so in your reply instead of reporting success.

10. **Retire this file's triage request** through the queue door — never
    by deleting a queue file, and never by a glob over the triage requests (that is
    every OTHER pending drop too). **Every path through this skill ends
    here** — the variant (4) and whole-handbook (6) branches, the `.tex`
    passthrough and the `.bib` fan-out below included; a request left
    behind is re-triaged on every drain. The door retires only the request
    step 0 claimed (a file re-dropped mid-run stays queued as
    `"superseded"`); with `""` it retires nothing:
    ```bash
    python3 .virgil/scripts/library/queue_slot.py retire --kind triage --file "<filename>" --requested-at "<requestedAt from step 0, or empty>"
    ```

11. **Append a `triaged` notification and bump the catalog version**
    via the locked CLI shims:

    ```bash
    t=$(mktemp -d "${TMPDIR:-/tmp}/virgil-triage-pdf.XXXXXX")
    cat > "$t/triaged.json" <<'EOF'
    { "kind": "triaged",
      "summary": "Triaged <filename> → <citekey> (<entry_type>)",
      "at": "<ISO>" }
    EOF
    python3 .virgil/scripts/library/append_inbox_item.py \
      --item-file "$t/triaged.json"
    rm -rf "$t"
    python3 .virgil/scripts/library/bump_catalog_version.py
    ```

## Reply format

One line: `Triaged <filename> → <citekey>; queued for indexing`

If the citekey is uncertain (multiple plausible candidates), pick one and
note the alternatives in your reply.

## `.tex` handling (passthrough)

When `<filename>` ends with `.tex`:

1. Read `\title{}`, `\author{}`, `\date{}` from the source. Use
   `_read_tex_meta()` in `triage_batch.py` if you want a one-shot helper.
2. Propose citekey from author + year + first significant title word.
3. Add a `@unpublished{<citekey>, …}` stub in `master.bib` via
   `update_master_bib_entry.py` (with `--entry-type unpublished` and
   `--bib-state unverified`), or `@article` if a DOI was found in the
   body.
4. Move `unsorted/<filename>` → `papers/<citekey>/<citekey>.tex`.
5. Enqueue `kind: "index"`. The indexer (`/library/index-paper`) will copy the
   `.tex` source verbatim into `papers/<citekey>/main.tex` —
   `index_paper.py` has a `tex-passthrough` extractor branch.
6. Bib auth runs as part of indexing — auto-detection of a published
   version flips `bib.state` to `authenticated`/`unverified`/`manuscript`.

## `.bib` handling (multi-entry fan-out)

**This section is the `.bib` PROCEDURE.** Step 1's `.bib` bullet points here;
run this instead of the per-document flow, and do not hand-roll the per-entry
rows — the batch engine is the ONE implementation of what a `.bib` entry
becomes.

When `<filename>` ends with `.bib`, do NOT treat it as one document. Fan it out
through the batch engine, SCOPED TO THIS FILE with `--only`:

```bash
run_dir=$(mktemp -d "${TMPDIR:-/tmp}/virgil-triage-pdf.XXXXXX") || exit 1
echo "runDir=$run_dir"
python3 .virgil/scripts/library/triage_batch.py \
  --library . --only "<filename>" --output "$run_dir/bib-triage.jsonl"
```

Review/edit `<runDir>/bib-triage.jsonl` if desired — each line is one bib
entry; `<runDir>` is the path the block above printed, carried as a literal
per [_scratch.md](_scratch.md). Then apply:

```bash
python3 .virgil/scripts/library/triage_apply.py \
  --input <runDir>/bib-triage.jsonl --library .
rm -rf <runDir>
```

`--only` takes a bare filename relative to `unsorted/` and errors (exit 2)
rather than falling back to the whole inbox — **without it `triage_batch.py`
triages every drop in `unsorted/`**, which is `/library/triage-pending`'s job,
not this skill's. Scoping the BATCH scopes the whole pipeline: the apply step is
driven entirely by the rows in the JSONL and sweeps `unsorted/` for nothing of
its own.

The apply step, per row:

- Decides on collision. The existing state is resolved through
  `_tools.resolve_bib_state` — master.bib's `% bib.state` comment FIRST, a legacy
  catalog row as the fallback — so a FILELESS reference (cited but not held, and so
  carrying no catalog row at all under the F#4 holdings model) is seen. A settled
  entry (`TERMINAL_BIB_STATES`: authenticated / manuscript / canonical) is IGNORED
  and left byte-unchanged; anything else merges fields over the existing ones,
  preferring the incoming value on conflict.
- Writes the three things a `bib-imported` entry becomes, and queues its
  `kind: "authenticate"`. **What those are, and the other three per-entry
  outcomes, is stated once** — see the `.bib` bullet under **Supported source
  kinds** above.
- Deletes the source `.bib` from `unsorted/` only when every row came back `bib-imported` or `bib-ignored`; any other status (including a `bib-folded` duplicate) parks the whole file under `_pending/`.
