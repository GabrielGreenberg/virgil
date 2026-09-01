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
  (`./.virgil/library-path.json` → `VIRGIL_LIBRARY_ROOT` →
  `~/.config/virgil/library-path.json` → `~/Virgil-Library/`) is used.
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
  3. a queued `kind: "authenticate"` — skipped for an explicit `manuscript`, and also skipped when `.virgil/queue/<citekey>.json` already exists for ANY kind (an entry whose citekey is already queued for `index` never gets an authenticate request, and the summary line still says "authenticate already queued").

  **The catalog row.** The write gate is the shared `_tools.admit_catalog_row`, and it asks about the PAPER FOLDER, not about the drop — `paper_has_holdings(papers/<citekey>/<citekey>.{tex,docx,pdf})`:
  - **No source document on disk** (the normal `.bib` case — a *reference-only* entry, cited but not held): the gate answers **no**, and under F#4 **no row is minted**. Before answering it discharges the state to the `% bib.state` comment and REFRESHES an already-existing row for that citekey without minting one. Such rows are real and common — a pre-F#4 library still carries them (the reporting library: 3 722 rows against 24 082 master entries) and **nothing in the shipped flow prunes them** (`prune_catalog_present_false --apply` has no caller). So do not assume the row is absent either: assume only that a `.bib` import never CREATES one.
  - **The citekey names a paper that IS held on disk**: the gate answers **yes** and touches nothing; `_upsert_catalog_row_bib_only` then writes a real holdings row — refreshing an existing one in place (preserving `addedAt`/`tags`/`pdf`/`indexed`, appending `fieldChanges`), or appending a new one with `pdf.present: true`.

  **The other three per-entry outcomes**, none of which produces (1)–(3): `bib-ignored` — the existing entry's state is settled (`TERMINAL_BIB_STATES`), so the drop is discarded and master.bib is left byte-unchanged; `bib-folded` — the work-identity guard matched the work under a DIFFERENT citekey, so an alias is recorded in `.virgil/aliases.json` and nothing else is written; `bib-skipped-no-citekey` — the row carried no citekey and nothing is written.

  **The source `.bib`** is deleted from `unsorted/` only when EVERY row came back `bib-imported` or `bib-ignored`; any other status parks the whole file under `_pending/` with a `triage-bib-parse-failed` notification. That includes `bib-folded` and `bib-skipped-no-citekey`, so a file that imported cleanly apart from one duplicate is quarantined under a parse-failure notice.

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
   python3 -c "import sys; sys.path.insert(0, 'scripts'); from extract_docx import core_properties; import json; print(json.dumps(core_properties('unsorted/<filename>'), indent=2))"
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

   For `.bib` (BibTeX file with one or more entries): parse the file
   into a list of entries via `_bib_parse.read_bib_file()`. Each entry
   is its own triage row — fan out per entry, do NOT treat the file as
   a single document. There is no source PDF to move; instead each
   entry produces a **bib-only paper folder** (`references.bib` +
   empty `virgil/` sidecars) and an `authenticate` queue request.

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
     the bib stub at step 5. A DOI here is strong evidence for the
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
      if needed). Skip steps 5–10 — no new bib entry, no queue write.
      Append a notification via the locked CLI shim:
      ```bash
      cat > /tmp/variant-notify.json <<'EOF'
      {
        "kind": "triaged",
        "summary": "Kept <filename> as variant archive of <existing-citekey>",
        "at": "<ISO>"
      }
      EOF
      python3 .virgil/scripts/library/append_inbox_item.py \
        --item-file /tmp/variant-notify.json
      rm /tmp/variant-notify.json
      python3 .virgil/scripts/library/bump_catalog_version.py
      ```
      Then stop.
   3. If `<base>.<ext>` exists on disk but no catalog entry maps to
      it, fall through to the four cases below (mint a new citekey
      with `a`/`b` suffix as needed).

   Otherwise, there are four cases:

   a. **No bib entry, no on-disk source** → standard new-paper flow.
      Add the bib entry (step 5), move the file (step 7), enqueue
      `kind: "index"` (step 8).

   b. **Bib entry exists, no on-disk source** ("fill the source gap") →
      skip step 5, move the file, enqueue `kind: "index"`.

   c. **Bib entry exists AND a same-format source exists at
      `papers/<citekey>/<citekey>.<ext>`** → genuine collision. Append `a`/`b`/...
      to the citekey and restart from step 2.

   d. **Bib entry exists AND a *different-format* source exists at
      `papers/<citekey>/<citekey>.<other-ext>`** → this is a **supersede**. Format
      priority is `docx > pdf` (DOCX carries explicit structure that
      beats the PDF heuristics). Decide which to do:
      - If the new file is *higher* priority than the existing one
        (e.g., new=docx, existing=pdf) → skip step 5, place the new
        file at `papers/<citekey>/<citekey>.<new-ext>` *alongside* the existing
        one (don't delete the old source), and enqueue **`kind:
        "reindex"`** instead of `"index"` in step 8. The existing
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

5. **Add a `master.bib` entry** if no matching one exists. Use the
   locked CLI shim — do **not** Read/Write `master.bib` directly:

   ```bash
   cat > /tmp/<citekey>-triage-fields.json <<'EOF'
   { "author": "...", "title": "...", "year": "<YYYY>", ... }
   EOF
   python3 .virgil/scripts/library/update_master_bib_entry.py "<citekey>" \
     --entry-type "<type>" \
     --fields-file /tmp/<citekey>-triage-fields.json \
     --bib-state unverified
   rm /tmp/<citekey>-triage-fields.json
   ```

   First, determine the entry type from the source content:

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
   so `/library/index-paper` will authenticate it.

6. **Whole-handbook check — refuse to mint a stub when the file is a
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
   3. Skip steps 7–10. The frontend toast will prompt the user for
      the chapter title and page range, then re-enqueue triage with
      the additional context.

   This is the one failure mode that legitimately needs human input —
   the skill should not guess.

7. **Flag preprints / forthcoming.** If page 1 contains any of:
   "Manuscript", "Penultimate Draft", "Pre-print", "Preprint",
   "Forthcoming", "Draft — please do not cite", "Under review", or a
   lingbuzz ID (`lingbuzz/\d+`), change the entry type to
   `@unpublished` and set:
   - `note = {Preprint}` (or `Forthcoming`, `Penultimate draft`, etc.
     — match the document's own phrasing)
   - If a lingbuzz ID was found: `url = {https://ling.auf.net/lingbuzz/<id>}`

   This overrides any type set in step 5. A preprint with a DOI keeps
   its DOI field — the DOI may point to the published version, which
   `/library/authenticate-bib` will reconcile later.

8. **Move the source file** from `unsorted/<filename>` to
   `papers/<citekey>/<citekey>.<ext>` — preserve the original extension. Do *not*
   overwrite or delete a same-citekey source of a different format
   (case 4d) — both files coexist on disk.

9. **Enqueue indexing**: write `.virgil/queue/<citekey>.json`. Use
   `kind: "index"` for new papers (cases 4a, 4b) and `kind: "reindex"`
   for supersede (case 4d, higher-priority new source). Skip enqueueing
   entirely for case 4d when the new source is lower-priority.
   ```json
   {
     "kind": "index",
     "status": "requested",
     "citekey": "<citekey>",
     "requestedAt": "<ISO>",
     "attempts": 0
   }
   ```

10. **Delete** the old triage queue entry (`.virgil/queue/_triage-*.json`).

11. **Append a `triaged` notification and bump the catalog version**
    via the locked CLI shims:

    ```bash
    cat > /tmp/<citekey>-triaged.json <<'EOF'
    { "kind": "triaged",
      "summary": "Triaged <filename> → <citekey> (<entry_type>)",
      "at": "<ISO>" }
    EOF
    python3 .virgil/scripts/library/append_inbox_item.py \
      --item-file /tmp/<citekey>-triaged.json
    rm /tmp/<citekey>-triaged.json
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

When `<filename>` ends with `.bib`, do NOT treat it as one document.
Instead, defer to the batch pipeline:

```bash
python3 scripts/triage_batch.py --library . --output /tmp/bib-triage.jsonl
# (review/edit the JSONL if desired — each line is one bib entry)
python3 scripts/triage_apply.py --input /tmp/bib-triage.jsonl --library .
```

The apply step:

- For each entry, decides on collision. The existing state is resolved through
  `_tools.resolve_bib_state` — master.bib's `% bib.state` comment FIRST, a legacy
  catalog row as the fallback — so a FILELESS reference (cited but not held, and so
  carrying no catalog row at all under the F#4 holdings model) is seen. A settled
  entry (`TERMINAL_BIB_STATES`: authenticated / manuscript / canonical) is IGNORED
  and left byte-unchanged; anything else merges fields over the existing ones,
  preferring the incoming value on conflict.
- Upserts into `master.bib` with `% bib.state = unverified` (`manuscript` when the row proposes it) — the F#4 home for the auth state.
- Creates `papers/<citekey>/references.bib` + empty `virgil/` sidecars (no source file, no `main.tex`).
- Mints **no catalog row** for a source-less citekey — that entry is reference-only under the F#4 holdings model, so the library list projects it from `bib-index.json` instead (and an already-existing row for it is refreshed, not removed). A citekey that IS held on disk still gets its real holdings row. Full model: the `.bib` bullet under **Supported source kinds** above.
- Queues `kind: "authenticate"` for each entry that isn't a manuscript.
- Deletes the source `.bib` from `unsorted/` only when every row came back `bib-imported` or `bib-ignored`; any other status (including a `bib-folded` duplicate) parks the whole file under `_pending/`.
