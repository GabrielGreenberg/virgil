---
description: Index a single source (PDF or DOCX) in the Virgil Library — produces papers/<citekey>/main.tex with \pgmark{} anchors, a single-entry references.bib, empty Virgil sidecars, and an authenticated catalog row. Args: <citekey>.
---

# /index-paper $ARGUMENTS

Index ONE paper in `~/Virgil-Library/`. The citekey is the first argument.
The source can be a PDF or a Word document (`.docx`); the orchestrator
auto-detects which is present at `pdfs/<citekey>.<ext>`.

## What this skill does

The work is mostly deterministic Python. Your job is to call the orchestrator
and report the result. Only invoke Claude reasoning if the orchestrator asks
you to disambiguate something.

## Steps

1. **Confirm setup.** Check that:
   - `~/Virgil-Library/pdfs/<citekey>.pdf` **or** `~/Virgil-Library/pdfs/<citekey>.docx` exists
   - `<citekey>` appears in `~/Virgil-Library/master.bib`

   If either is missing, write a `failed` entry to `notifications/inbox.json`
   and stop.

2. **Confirm Python deps.** Run:
   ```bash
   python3 -c "import fitz, requests" 2>&1
   ```
   If pymupdf is missing, run:
   ```bash
   pip3 install --user --break-system-packages -r scripts/requirements.txt
   ```
   `python-docx` is also installed by that command — it's required only for
   `.docx` sources.

3. **Run the orchestrator.** From the library root:
   ```bash
   python3 scripts/index_paper.py <citekey>
   ```
   For PDF sources, this:
   - classifies scanned vs digital (OCRs scanned PDFs if `ocrmypdf` is installed)
   - detects printed page numbers via `pymupdf` (header/footer band heuristic)
   - extracts structural blocks (marker if installed, else pymupdf fast-path)
   - emits `papers/<citekey>/main.tex` with `\pgmark{N}` markers

   For DOCX sources, the OCR + printed-page steps are skipped — Word's
   paragraph styles already carry the structure. The emitted `main.tex`
   contains no `\pgmark{}` lines (DOCX has no printed-page anchors).

   In both cases:
   - writes single-entry `references.bib` mirror
   - initializes empty `virgil/{virgil,notes,footnotes}.json` sidecars
   - authenticates the .bib entry against Crossref/OpenAlex/Semantic Scholar/arXiv
   - updates `catalog.json` (`pdf.format` records the source format) and bumps `catalog-version.txt`
   - appends a row to `notifications/inbox.json`

   **DOI fallback.** If `bib.state` from the orchestrator is `failed`
   AND the `master.bib` entry has a `doi` field, fetch
   `https://api.crossref.org/works/<doi>` directly (DOI is a primary
   key — no title-fuzz needed). Map the Crossref response into bib
   fields:
   - `message.title[0]` → `title`
   - `message.author` → `author` (format: `Family, Given and ...`)
   - `message.published-print.date-parts[0][0]` → `year`
   - `message.container-title[0]` → `journal` (or `booktitle` for
     `@incollection`/`@inbook`; drop for `@book`)
   - `message.volume` → `volume`
   - `message.issue` → `number`
   - `message.page` → `pages`
   - `message.publisher` → `publisher`

   Write the updated fields to `master.bib`, set `bib.state =
   "authenticated"` and `bib.doiVerified = true` in `catalog.json`,
   and continue to step 4 with the enriched entry. This is a
   skill-level backstop for when `bib_auth.py`'s title-fuzz search
   missed the correct record but the DOI was already known.

   **ISBN fallback for books.** If the entry type is `@book` or
   `@incollection` AND title-fuzz auth failed AND the entry has an
   `isbn` field, try OpenLibrary:
   ```bash
   curl -s "https://openlibrary.org/isbn/<ISBN>.json"
   ```
   Map the response: `.title` → `title`, `.publishers[0]` →
   `publisher`, `.publish_date` → `year`, `.number_of_pages` →
   `pages`. If OpenLibrary returns a result, set `bib.state =
   "unverified"` (single non-DOI source) and note the source as
   `openlibrary` in `bib.sources`. Proceed to step 4 with the enriched
   entry.

4. **Complete the bib entry.** The Python pipeline only fills the core
   nine fields (title, year, doi, journal, volume, number, pages,
   publisher, author). After it finishes, ALWAYS attempt to fill the
   remaining standard BibTeX fields: `abstract`, `url`, `booktitle`,
   `editor`, `series`, `address`, `month`, `isbn`/`issn`, `edition`.
   Read the current entry from `master.bib` to see what's still empty,
   then search progressively wider:

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
   pages of the source at `pdfs/<citekey>.<ext>`. Publisher city often
   appears on the title page or copyright notice; month in a "received
   / accepted" line; edition in the front matter. If you infer a value
   this way, append `[inferred from source]` to the `note` field so the
   user can audit.

   After filling fields, update `master.bib` and re-emit the
   single-entry `papers/<citekey>/references.bib` mirror to match.

5. **Inspect the output.**
   - Read `papers/<citekey>/main.tex` and skim it. If you spot obvious
     extraction failures (missing sections, garbled paragraphs, footnotes
     dangling without bodies), report them in your reply.
   - Read the latest `logs/<citekey>/*-index.summary.md` and quote the
     extractor + counts.
   - If `bib.state` is `unverified` or `failed`, mention it so the user
     can decide whether to manually accept.
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

- `--extractor marker` — force marker (PDF only; skips pymupdf fast-path; slow on CPU).
- `--extractor pymupdf` — force pymupdf (PDF only; skip marker even if installed).
- `--no-bib-auth` — skip the HTTP authentication step.

## When to fall back to Claude reasoning

The orchestrator already invokes Claude reasoning is **not** wired up yet —
this is the v1 deterministic pipeline. If the user reports that footnote
re-attachment or math correction is poor, that's a Phase 2.5 followup;
log the issue but don't try to patch it inline.

## Reply format

Three lines:
1. `Indexed <citekey> in <duration> via <extractor>`
2. `Source: <ext>; blocks: <block_count>; bib: <auth_state>`
3. `Output: papers/<citekey>/main.tex`

If anything went wrong, paste the relevant traceback in a fenced block and
stop — don't try to patch broken extraction by hand.
