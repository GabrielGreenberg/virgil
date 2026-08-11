---
description: |
  Index a paper into the Virgil Library — extract LaTeX from a PDF,
  DOCX, or .tex source and produce a Virgil-compatible paper folder.
  Triggers on: "index <citekey>", "process the paper for X", "extract
  this PDF into the library", "Virgil, index <author year>", "add
  <citekey> to my library". Produces `papers/<citekey>/main.tex` (with
  `\pgmark{N}` anchors for PDFs), this paper's row upserted into
  references.bib, empty Virgil sidecars, and an authenticated catalog
  row. Light —
  safe to invoke from a paper session with --library. Does NOT trigger
  for newly-dropped files in unsorted/ (use /triage-pdf first) or for
  cleaning up an already-indexed paper (use /deep-index). Args:
  <citekey> [--library <path>].
---

# /index-paper $ARGUMENTS

## Args

- `<citekey>` — the paper to index (its source sits at
  `papers/<citekey>/<citekey>.<ext>`).
- `--library <path>` — override library-path resolution. Useful when
  invoking this skill **from a paper session** with multiple libraries on
  disk; without it the normal chain
  (`./.virgil/library-path.json` → `VIRGIL_LIBRARY_ROOT` →
  `~/.config/virgil/library-path.json` → `~/Virgil-Library/`) is used.

See also **Optional flags** below for the extractor / bib-auth switches.

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

---

Index ONE paper in the user's library. The citekey is the first
argument. All paths below resolve against `$library_root` (the library
root the bootstrap just located), so the skill works whether the user
invoked it from the library folder or from a paper folder.

The source can be a PDF, a Word document (`.docx`), or a LaTeX manuscript
(`.tex`); the orchestrator auto-detects which is present at
`papers/<citekey>/<citekey>.<ext>`. Format priority is `tex > docx > pdf`
when more than one is present.

> **Where any memo you write goes.** Library memos (notes about this
> pipeline — retros, indexing-flow ideas) → `.virgil/memos/<YYYY-MM-DD>-<slug>.md`.
> A reflection about Virgil's *skill set* is a dev-loop note, **not** a library
> memo — never file a reflection under `.virgil/memos/` (see `.claude/virgil/memos.md`).
> Paper-specific analyses or reports → `papers/<citekey>/notes/<slug>.md`.
> Never drop a markdown file at the library root.

## What this skill does

The work is mostly deterministic Python. Your job is to call the orchestrator
and report the result. Only invoke Claude reasoning if the orchestrator asks
you to disambiguate something.

## Steps

1. **Confirm setup.** Check that:
   - `papers/<citekey>/<citekey>.pdf` **or** `papers/<citekey>/<citekey>.docx` (or `.tex`) exists relative to the library root
   - `<citekey>` appears in `master.bib`

   If either is missing, append a `failed` notification via the locked
   CLI shim and stop:
   ```bash
   cat > /tmp/<citekey>-setup-failed.json <<'EOF'
   { "kind": "failed", "citekey": "<citekey>", "at": "<ISO>",
     "summary": "Setup check failed: <reason>" }
   EOF
   python3 .virgil/scripts/library/append_inbox_item.py \
     --item-file /tmp/<citekey>-setup-failed.json
   rm /tmp/<citekey>-setup-failed.json
   ```

2. **Confirm library setup has run.** Check for the setup manifest:
   ```bash
   test -f .virgil/models/manifest.json && echo OK || echo MISSING
   ```
   If MISSING, run `/library/setup` first — this skill assumes
   marker-pdf is installed and its models are cached library-locally.
   The orchestrator (Step 3) will fail loudly with the same pointer
   if marker is missing, but checking up front avoids a wasted
   pre-flight run.

   Lightweight sanity check on the Python imports:
   ```bash
   python3 -c "import fitz, requests" 2>&1
   ```
   If pymupdf is missing, your setup is corrupted — re-run
   `/library/setup --force`.

3. **Run the orchestrator.** From the library root:
   ```bash
   python3 .virgil/scripts/library/index_paper.py <citekey>
   ```
   For PDF sources, this:
   - classifies scanned vs digital; if scanned, OCRs via ocrmypdf (FAILS LOUDLY if ocrmypdf or tesseract are missing — install them via `/library/setup` + `brew install tesseract`)
   - detects printed page numbers via `pymupdf` (header/footer band heuristic)
   - extracts structural blocks via `marker-pdf` (the default; pymupdf is only used with explicit `--extractor pymupdf` for debugging)
   - emits `papers/<citekey>/main.tex` with `\pgmark{N}` markers

   For DOCX sources, the OCR + printed-page steps are skipped — Word's
   paragraph styles already carry the structure. The emitted `main.tex`
   contains no `\pgmark{}` lines (DOCX has no printed-page anchors).

   For `.tex` sources, the extraction stages are skipped entirely: the
   `.tex` is already LaTeX, so `index_paper.py` copies it verbatim to
   `papers/<citekey>/main.tex` (the catalog records
   `indexed.extractor = "tex-passthrough"`). No pgmark detection, no
   OCR. Bib auth still runs.

   In both cases:
   - upserts this paper's own row into `references.bib` (on a first index
     that's the familiar single-entry mirror; on a **re-index of a
     deep-indexed paper** the cited works `/library/clean-bibliography`
     put there survive untouched)
   - initializes empty `virgil/{virgil,notes,footnotes}.json` sidecars
   - authenticates the .bib entry against Crossref/OpenAlex/Semantic Scholar/arXiv
   - updates `.virgil/catalog.json` (`pdf.format` records the source format) and bumps `.virgil/catalog-version.txt`
   - appends a row to `.virgil/notifications/inbox.json`

   **DOI fallback.** If `bib.state` from the orchestrator is `failed`
   AND the `master.bib` entry has a `doi` field, fetch
   `https://api.crossref.org/works/<doi>` directly (DOI is a primary
   key — no title-fuzz needed). Map the Crossref response into bib
   fields:
   - `message.title[0]` → `title`
   - `message.author` → `author` (format: `Family, Given and ...`)
   - `message.published-print.date-parts[0][0]` → `year`. **But
     when `published-online` and `published-print` disagree by year**
     (advance-article / online-first papers — OUP, Springer, T&F
     all do this), prefer the one matching the citekey's year and
     record the other in `note` (e.g. `note = {Online 2021-11-15;
     printed 2022}`). Don't silently flip the user's citekey-baked-in
     year.
   - `message.container-title[0]` → `journal` (or `booktitle` for
     `@incollection`/`@inbook`; drop for `@book`)
   - `message.volume` → `volume`
   - `message.issue` → `number`
   - `message.page` → `pages`
   - `message.publisher` → `publisher` (but when this is an
     aggregator/redistributor like `JSTOR`, `Project MUSE`,
     `Cambridge Core`, `ScienceDirect`, etc., it's not the original
     publisher — prefer the publisher printed on the PDF cover
     page; record the aggregator in `note` or skip it)

   Write the updated fields to `master.bib` via the locked CLI shim.
   **The shim replaces the whole entry** with a block emitted from
   exactly the fields file — it merges nothing. Since what you have here
   is a Crossref-derived *change-set*, pass `--merge-existing` so the
   fields the backfill didn't touch survive; without it the shim refuses
   the write rather than let them be destroyed.

   ```bash
   cat > /tmp/<citekey>-doiback-fields.json <<'EOF'
   { "author": "...", "title": "...", "year": "...", "doi": "...", ... }
   EOF
   python3 .virgil/scripts/library/update_master_bib_entry.py "<citekey>" \
     --entry-type "<type>" \
     --fields-file /tmp/<citekey>-doiback-fields.json \
     --bib-state authenticated \
     --merge-existing
   rm /tmp/<citekey>-doiback-fields.json
   ```

   Then set `bib.state = "authenticated"` and `bib.doiVerified = true`
   in `.virgil/catalog.json`:

   ```bash
   cat > /tmp/<citekey>-doiback-catalog.json <<'EOF'
   { "bib": { "state": "authenticated", "doiVerified": true } }
   EOF
   python3 .virgil/scripts/library/update_catalog_entry.py "<citekey>" \
     --patch-file /tmp/<citekey>-doiback-catalog.json
   rm /tmp/<citekey>-doiback-catalog.json
   ```

   Continue to step 4 with the enriched entry. This is a skill-level
   backstop for when `bib_auth.py`'s title-fuzz search missed the
   correct record but the DOI was already known.

   **Cross-check before stamping authenticated.** A DOI fast-path
   confirms the bib is internally consistent with that DOI — *not*
   that the DOI is the correct record for the indexed PDF. Before
   accepting the Crossref record, compare the resolved record's
   `page` (or `volume` + `issue`) to the printed page range
   recovered by extraction (the `\pgmark{N}` markers in
   `papers/<citekey>/main.tex` and `indexed.pgmarkCount` /
   `indexed.pgmarkPosition` on the catalog row). If Crossref's
   `page` (e.g. `272-277`) is incompatible with the PDF's printed
   range (e.g. `3552-3563`), the prior auth attached the wrong DOI.
   Dump the diff to `.virgil/logs/<citekey>/<ts>-bib-mismatch.md`,
   clear the bad `doi`/`journal`/`pages`, and downgrade
   `bib.state = "unverified"` instead.

   *Note*: Older JSTOR deposits often record only a single start
   page in `message.page` (e.g. `"243"` instead of `"243-249"`).
   When Crossref returns a single number, treat it as the start
   page; the check passes iff the PDF's first `\pgmark` equals it.
   Write the full range from the pgmarks into `pages`.

   *Advance-article / online-first carve-out.* Online-first PDFs
   from OUP, Springer, T&F, etc. paginate the offprint from `1`
   while the journal's final issue pagination is offset (e.g.
   `552-577`). When the PDF's first `\pgmark` is `0` or `1` AND
   Crossref's `page` does not start near `1`, treat it as an
   advance-article PDF — do NOT downgrade. Record Crossref's
   journal-pagination range as `pages`; keep the bib
   `authenticated`.

   **Cover-page handle fallback (when orchestrator returns `failed`
   from registries with zero candidates).** If `bib.state = failed`
   after the orchestrator AND the master.bib entry has no `doi`
   field AND the source PDF's cover page exposes a primary handle
   — a JSTOR stable URL (`http://www.jstor.org/stable/<id>`), an
   arXiv ID, a Crossref-resolvable DOI, or an ISBN — extract that
   handle, treat it as a primary candidate, and run the DOI /
   arXiv / ISBN lookup above. This is the common path for
   newly-triaged title-only stubs whose deterministic search came
   back empty.

   *JSTOR stable id mapping is incomplete.* JSTOR's stable URLs
   look like Crossref DOIs (`10.2307/<id>`) for some records, but
   not all — JSTOR sometimes redirects to a non-2307 DOI elsewhere
   (e.g. Peirce 1906 in The Monist resolves at
   `10.5840/monist190616436`, not `10.2307/27899680`). If
   `/works/10.2307/<id>` returns `Resource not found`, fall
   through to a Crossref bibliographic search keyed on the
   cover-page title + first-author surname, then verify the
   resolved DOI directly.

   **Suspicious-title-stub re-seed.** When `bib.state = failed`
   AND the master.bib title looks like JSTOR/aggregator boilerplate
   rather than a real title — matches `^Author(s):`, `^Source:`,
   `^Published by:`, equals the citekey, or is `≤4 words` with
   `Author` / `Source` / `Vol.` substrings — the title was a
   triage-time stub and the orchestrator's title-fuzz never had a
   chance. Re-extract the actual title from the PDF cover page
   (the bold/large-font line above the byline) and re-run the helper
   with the corrected title before declaring failure — `--title`
   overrides just that seed, leaving the rest of the entry verbatim:
   ```bash
   python3 .virgil/scripts/library/bib_auth.py --citekey "<citekey>" \
     --library . --title "<corrected title from the cover page>"
   ```

   **Cross-check fallback when pgmarks are unreliable.** When
   `indexed.pgmarkPosition = "unknown"` or all/most pgmarks carry
   `[low]` confidence (i.e. the printed-page detector got nothing
   usable), the page-range cross-check above can't use `\pgmark`
   values. Instead, text-search the source PDF's cover page for
   patterns like `Vol. <n>, No. <m> (<month>, <year>), pp.
   <start>-<end>` (the standard JSTOR cover-page template) and
   use that range as the canonical PDF page range.

   **ISBN fallback for books.** If the entry type is `@book` or
   `@incollection` AND title-fuzz auth failed AND the entry has an
   `isbn` field, *first validate the ISBN's check digit* (ISBN-10
   mod 11 weighted sum, ISBN-13 mod 10 weighted sum). If invalid,
   skip the lookup and flag the field for unwinding — a triage-time
   ISBN like `2503201503` (which fails the ISBN-10 checksum and is
   in fact a journal article's catalog id) will not resolve and
   wastes an API call. If valid, try OpenLibrary:
   ```bash
   curl -s "https://openlibrary.org/isbn/<ISBN>.json"
   ```
   Map the response: `.title` → `title`, `.publishers[0]` →
   `publisher`, `.publish_date` → `year`, `.number_of_pages` →
   `pages`. If OpenLibrary returns a result, set `bib.state =
   "unverified"` (single non-DOI source) and note the source as
   `openlibrary` in `bib.sources`. Proceed to step 4 with the enriched
   entry.

4. **Complete the bib entry.**

   **Audit before filling.** First check the current catalog row's
   `bib.sources` for this citekey. If it includes any source whose
   name contains `-search`, `-fuzz`, `-republication`, or
   `-journal-author-year`, the prior auth was a fuzzy match — the
   `doi`/`journal`/`pages`/`author`/`publisher` it wrote may belong
   to a *different paper with a similar title* or to a *different
   edition with a different author count*. Read the `\maketitle`
   block + first ~200 words after the abstract heading in
   `papers/<citekey>/main.tex` and verify they're consistent with
   the title in `master.bib`. Then run two cross-checks against the
   indexed PDF:

   - **Page-range check (DOI sources).** If a `doi` is present,
     compare the resolved Crossref record's `page` to the printed
     page range in the `\pgmark{N}` markers. Mismatch means the
     wrong DOI is attached.
   - **Author-count check (any non-DOI source that wrote `author`).**
     Count the authors visible on the PDF's title page / Library-of-
     Congress copyright page (the `\maketitle` block) and compare to
     the helper's `author` field. A bib that goes from
     `Barwise, Jon and Etchemendy, John` → `Barwise, Jon.` via
     `openlibrary-search` is a classic single-author-edition
     overwrite of a multi-author book — drop the change.

   **Unwind per field, not per batch.** If some fields in the same
   fuzzy-source batch are correct and others wrong (e.g. the ISBN is
   right but the author was clobbered), unwind only the divergent
   fields. Keep any field that is independently corroborated by (a)
   the PDF source text or (b) a deterministic non-search lookup
   (`/isbn/<isbn>.json`, `/works/<doi>`, etc.). After unwinding,
   downgrade `bib.state = "unverified"` and annotate the unwound
   `bib.fieldChanges` rows with `unwoundAt` + `unwindReason`.

   After the audit (and after the Python pipeline only fills the
   core nine fields: title, year, doi, journal, volume, number,
   pages, publisher, author), ALWAYS attempt to fill the remaining
   standard BibTeX fields: `abstract`, `url`, `booktitle`,
   `editor`, `series`, `address`, `month`, `isbn`/`issn`, `edition`.
   Read the current entry from `master.bib` to see what's still empty,
   then search progressively wider:

   **Tier 0 — re-query Crossref `/works/<doi>` for cheap fields.**
   If the entry has a `doi`, the Crossref record already carries
   most missing fields the orchestrator's bib_auth.py left empty:
   `abstract` (strip `<jats:p>` wrappers), `ISSN[0]` →
   `issn`, `URL` → `url`, `published-print`/`published-online` →
   `month`. One curl gets ~5 fields without WebSearch. Pull these
   first; only fall through to Tier 1+ for genuinely missing
   fields.

   **Tier 1 — publisher / DOI landing page.** If the entry has a `doi`,
   `WebFetch https://doi.org/<doi>` and pull citation metadata from the
   landing page. If no DOI, `WebSearch` for the exact title in quotes
   plus the first author's surname and look for the publisher or
   repository page (the journal site, JSTOR, PhilPapers, ACM DL,
   SpringerLink, university press, etc.). Fetch that page and extract
   every available field.

   **Tier 2 — corroborated third-party references.** If gaps remain,
   `WebSearch` for the title in quotes and look at how others cite it:
   reference lists in other papers, library catalogs (WorldCat, Library
   of Congress, university OPACs), citation managers' public records.
   Accept a value only if **two independent pages agree**, OR if one
   page is an authoritative catalog (WorldCat, LoC, the publisher's own
   site).

   **Tier 3 — document-internal inference.** For fields still missing
   (especially `address`, `month`, `edition`), check the first/last
   pages of the source at `papers/<citekey>/<citekey>.<ext>`. Publisher city often
   appears on the title page or copyright notice; month in a "received
   / accepted" line; edition in the front matter. If you infer a value
   this way, append `[inferred from source]` to the `note` field so the
   user can audit.

   After filling fields, update `master.bib` via the locked CLI shim.
   Same contract as step 3's backfill: **the shim replaces the whole
   entry**, and you are holding only the fields you just filled, so pass
   `--merge-existing` to keep the rest.

   ```bash
   cat > /tmp/<citekey>-tier-fields.json <<'EOF'
   { "author": "...", "title": "...", "year": "...", ... }
   EOF
   python3 .virgil/scripts/library/update_master_bib_entry.py "<citekey>" \
     --entry-type "<type>" \
     --fields-file /tmp/<citekey>-tier-fields.json \
     --merge-existing
   rm /tmp/<citekey>-tier-fields.json
   ```

   Then sync this paper's own row in `papers/<citekey>/references.bib`
   to match (use `_resync_references_bib` from `index_paper`, like
   `/authenticate-bib` step 6 — it **upserts** that one entry and leaves
   every other entry in the file untouched), and patch the `\title{}` /
   `\author{}` / `\date{}` lines at the top of
   `papers/<citekey>/main.tex` if any of those changed. `tex_emit.py`
   only sees the bib at extraction time, so a correction made in step 4
   won't propagate to `main.tex` automatically.

5. **Inspect the output.**
   - Read `papers/<citekey>/main.tex` and skim it. If you spot obvious
     extraction failures (missing sections, garbled paragraphs, footnotes
     dangling without bodies), report them in your reply.
   - Read the latest `.virgil/logs/<citekey>/*-index.summary.md` and quote the
     extractor + counts.
   - Check `indexed.warnings` for `pgmark-*` continuity findings.
     If there are >10 (a common signal that the page-number
     detector latched onto a non-page numeral, like a TOC or
     reference list), mention it explicitly in your reply so the
     user knows printed-page anchors are unreliable for this paper.
     (Patching is `/library/deep-index`'s job; just surface the
     count.)
   - If `bib.state` is `unverified`, `failed`, `needs-reauth`, or `canonical`,
     mention it so the user can decide whether to manually accept.
     The six `bib.state` values:
     - `authenticated` — DOI verified, or ≥2 sources agreed at score ≥0.92, or
       (for books) Google Books + OpenLibrary both ≥0.85.
     - `unverified` — single source matched at the lower threshold, or a
       manual correction with one canonical source. **Action needed.**
     - `failed` — no source produced a match above threshold. **Action needed.**
     - `needs-reauth` — set by `apply_metadata_mismatch_policy.py` when an
       already-authenticated entry's on-file metadata diverged from the
       authoritative source. **Action needed** (re-run `/library/authenticate-bib`).
     - `manuscript` — `@unpublished` entry; no external auth attempted.
     - `canonical` — pre-digital classic, no external registry expected.
   - Confirm `master.bib` now has, at minimum, title + author + year +
     either (journal + volume + pages) for an article or `booktitle`
     for a chapter/conference paper. If core fields are still missing
     after step 4, call it out in your reply.

## Font policy

The emitted `papers/<citekey>/main.tex` must contain **no font directives**
— no `\usepackage{fontspec}`, `\setmainfont`, `\usepackage{times}`,
`\usepackage{lmodern}`, `\usepackage{palatino}`, `\renewcommand{\rmdefault}`,
`\fontfamily`, or any other font-affecting preamble. The Virgil library
renderer pins fonts on the frontend (via `--library-editing-font`); the
indexed `.tex` stays font-agnostic and portable. `tex_emit.py` is the
authoritative emitter and already complies — never extract or carry over
font information from the source PDF/DOCX, and never hand-add font
commands to a generated preamble.

## Optional flags

- `--extractor pymupdf` — explicit-fallback path (PDF only). Lose equations, footnote zones, drop caps, and most layout — only use to debug a marker regression on a specific paper. NOT selected automatically.
- `--extractor marker` — synonym for the default `auto`. Marker is the only extractor selected automatically.
- `--no-bib-auth` — skip the HTTP authentication step.

## When to fall back to Claude reasoning

Invoking Claude reasoning from the orchestrator is **not** wired up yet —
this is the v1 deterministic pipeline. If the user reports that footnote
re-attachment or math correction is poor, that's a Phase 2.5 followup;
log the issue but don't try to patch it inline.

## Queue-file lifecycle

If `.virgil/queue/<citekey>.json` exists when the run completes
successfully, rename it to `<citekey>.done` (matching the convention
used by the rest of the queue dir; `index_paper.py` itself does NOT
manage the queue when invoked directly — that's `drain_queue.py`'s
job, but this skill is often invoked outside that path).

## Reply format

Three lines:
1. `Indexed <citekey> in <duration> via <extractor>`
2. `Source: <ext>; blocks: <block_count>; bib: <auth_state>`
3. `Output: papers/<citekey>/main.tex`

If anything went wrong, paste the relevant traceback in a fenced block and
stop — don't try to patch broken extraction by hand.
