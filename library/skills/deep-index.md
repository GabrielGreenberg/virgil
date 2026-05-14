---
description: Apply structural cleanup to an already-indexed paper — produces a human-readable LaTeX document from raw extraction. Runs an internal convergence loop (no cap), persistently working through every recoverable issue until two consecutive passes produce no new findings. Emits a clear "Deep indexing complete" banner (or stall report) when done. Args: <citekey> [--fresh]
---

# /deep-index

> **Naming note.** This skill was previously called `/rich-index`. Old
> queue files (`.virgil/queue/<citekey>-richindex.json`) and catalog entries
> (`indexed.state == "richIndexed"`) are still accepted on read; new
> writes use the deep-index vocabulary throughout.

**Structurally improve a paper's `main.tex`** — transform raw extracted
text into properly structured LaTeX that is useful to a human reader.

All paths are relative to the **library root**, which is your **current working directory**. The default convention is `~/Virgil-Library`, but the user may have picked a different folder (e.g. `~/Documents/Virgil-Library`). Resolve the library root in this order:

1. `$VIRGIL_LIBRARY_ROOT` if set;
2. otherwise your current cwd, **iff** it contains both `master.bib` and `.virgil/catalog.json`;
3. otherwise `~/Virgil-Library`.

`cd` into that directory before running any of the commands below — every relative path (`papers/<citekey>/...`, `.virgil/...`, `master.bib`, `references.bib`) and every helper script under `.virgil/scripts/` resolves against cwd. If none of the three resolutions yields a valid library, abort with a one-line error pointing the user to set up the library first.

> **Where any memo you write goes.** Dev memos (skill retros, ideas for
> improving this pipeline) → `.virgil/memos/<YYYY-MM-DD>-<slug>.md`.
> Paper-specific analyses or reports → `papers/<citekey>/notes/<slug>.md`.
> Never drop a markdown file at the library root.

## Arguments

`$ARGUMENTS` is the citekey (e.g. `cumming2008`), optionally followed
by `--fresh` to restart from baseline. The default (no flag) is
**resume mode** — continue from where a prior pass left off if
`indexed.state == "deepIndexed"`. See the §Preflight section.

## Prerequisites

The paper must already be indexed (`papers/<citekey>/main.tex` must
exist). If it doesn't, tell the user to run `/index-pending` first
and stop.

Also verify the body is populated: a `main.tex` whose body (between
`\maketitle` and `\end{document}`) has fewer than 100 non-comment
bytes is an `/index-paper` failure (typically a scanned PDF that
pymupdf could not text-extract). Hard-stop with the message
"extraction-empty-body — body has <N> bytes; re-run /index-paper
with OCR" and do not proceed. There is nothing for /deep-index to
clean up.

## Scope doctrine (load-bearing)

**Aggressive default: in-scope unless proven otherwise.** /deep-index
is responsible for every cleanup problem that can be solved by reading
the source PDF, the existing `main.tex`, and the bibliography. Recoverable
problems explicitly include:

- **Footnotes** — leaked-prose, orphan, column-format, chapter-end,
  multi-page continuations. Walk the tier ladder (§3d). The Tier 4
  orphan-prefix fallback always succeeds with approximate placement;
  it is strictly better than leaving content unattached.
- **Chapter titles and heading hierarchy** — infer from body context,
  the TOC, or PDF visual structure. Merge wrapped section fragments.
  Demote math-symbol-only headings. Delete OCR-garbage cluster
  headings (figure-caption blocks). Promote all-caps siblings.
- **Pagination and pgmarks** — offset detection has multiple fallback
  patterns (standalone numeric footer, recto/verso running headers,
  modal offset from multiple anchors). Blank pages get
  `\pgmark[low]{N}` with no body.
- **Misplaced text** — relocate body fragments to their correct
  positions; remove adjacent-article content from multi-article PDFs
  surgically.
- **Drop-cap recovery** — OCR'd chapter-starts missing their initial
  letter are recoverable from `pdftotext -layout` on the PDF.
- **Invisible characters and ligatures** — strip soft hyphens, normalize
  U+FB00–U+FB06 ligatures, replace mid-word NBSP, replace U+2800 Braille
  pattern blank in citation contexts.
- **Bibliography parsing** — even 1000+ entry book bibliographies are
  in-scope. State-machine parser handles run-on prose; multi-word
  surnames (`McNaughton`, `van Fraassen`, `Graf Fara`) and lowercase
  particles (`von`, `de`, `van der`, `Mc`) work via longest-suffix
  match against the parsed author list.
- **Citation rewriting** — every style: author-year, APA comma-separator,
  numeric/Vancouver, bracket-key (SIGGRAPH/CS), endnote-style with
  full bibliographic detail at first mention. Index bib entries under
  every author surname (not just first). Title-only fallback for
  short-form citations.
- **Multi-article PDFs** — JSTOR scans and Annual-Reviews collections
  that bundle adjacent-article content into `main.tex` get surgical
  removal. Use `detect_multi_article.py` to identify; remove with
  a targeted body edit, not by re-extracting.

**Genuinely out of scope is narrow.** Only three categories qualify:

1. **Source-missing content** — a page literally absent from the PDF.
   Verify with `pdfinfo papers/$ARGUMENTS/$ARGUMENTS.pdf | grep '^Pages:'`
   against the catalog's `indexed.pgmarkCount` and the expected page
   range from `master.bib`. Tag as
   `source-missing — verified absent from PDF (pages X–Y)`.
2. **Figure/diagram reconstruction** — raster-only content where the
   meaning is the image itself (not text overlaid on an image). Tag
   as `figure-reconstruction — raster-only content`. Text in
   figure captions IS in scope and must be cleaned.
3. **User-judgment-required** — a genuinely ambiguous call that
   requires human input (rare in practice). Tag as
   `user-judgment-required — <specific question>` with the exact
   question that needs answering. **Default expectation: this is
   almost never the right tag.** If you're tempted to use it, you
   are probably failing to exhaust a tier.

Everything else is in-scope. **"I tried one approach and it didn't
fully work" is not exhaustion.** Tier 4 (orphan-attachment with
`[orphan fn N]` prefix) always succeeds with approximate placement.
"Out of /deep-index scope" is not a valid deferral reason for any
problem within the explicit in-scope list above.

### Anti-patterns: things that are NOT exhaustion signals

A retrospective on the 5-13 / 5-14 batch of streamlining memos shows
the deep-indexer was repeatedly stopping work for reasons the skill
text doesn't accept. Each of the following is **not** a reason to
emit an `outstanding-work` item — it's a reason to do the work:

1. **"No existing script for this."** Write the script. The skill is
   explicit that this is in-scope; §10 (streamlining memo) is for
   *recording* that the script should exist permanently, not for
   substituting a memo *in place of* doing the work this pass. If
   the same gap shows up across multiple papers, lift the script
   into `library/scripts/` so future runs inherit it.
2. **"The auto-pipeline produced false positives."** Build a more
   conservative version. The right response to a script that's too
   aggressive is to add a guard (TOC-skip, citation-arg guard,
   pgmark-preservation, body-argument-list filter), not to abandon
   the pass.
3. **"A safeguard fired (e.g., >50% removal threshold)."** Add a
   per-paper override (`--max-page N`, `--style=<X>`) or fix the
   safeguard. The safeguard's job is to catch bad cases, not to
   define exhaustion.
4. **"The validator flagged something."** Distinguish real defects
   from heuristic limitations. If the finding is a confirmed false
   positive (journal-offset reprint, multi-section pagination,
   low-confidence flood on a scanned-OCR book), record it as
   `validator-false-positive` and proceed. Validator findings are
   gates only when they reflect actual file defects.
5. **"It's risky to auto-fix."** Design the safer version. If
   coordinated compounds like `pre- and post-test` are getting
   misflagged as hyphenation artifacts, the fix is a negative
   lookahead for `and|or|nor|but|to|vs`, not a deferral. If
   hyphenation cleanup might rejoin a legitimate compound, use a
   dictionary check or a conservative "join only if result is a
   common word" rule.

### Self-check before emitting any outstanding-work item

Before tagging any item as `[source-missing]`,
`[figure-reconstruction]`, `[user-judgment-required]`, or
`[validator-false-positive]`, walk this checklist:

- Have I exhausted the §0.5 in-scope ladder for this category?
- For a footnote: did I try Tier 4 (orphan-prefix) — which always
  succeeds where a preceding body paragraph exists?
- For a script-protected operation: did I try a per-paper override
  flag (`--max-page`, `--style=...`, `--diagram-tokens`)?
- For a missing bibliography entry that's a well-known cited work:
  did I consider synthesis from external reference data with a
  `% synthesized` comment?
- For metadata mismatch where the citekey clearly names the work
  and the body matches: did I apply the auto-resolution policy
  (update `master.bib` + catalog, set `bib.state = needs-reauth`)?

If any answer is no, the deferral is premature — do the work first.

### Convergence behavior (anti-pattern enforcement)

Stopping after 3-4 passes because the remaining work is laborious is
**not** convergence. The loop continues until either:

- (a) the outstanding list is empty, or narrow-out-of-scope only
  (the three §0.5 narrow categories, plus `validator-false-positive`
  for known heuristic limitations), or
- (b) the pathological-loop guard fires (pass ≥3, outstanding list
  growing, zero resolutions).

Items in pass 1's outstanding list that the agent expects to address
in a follow-up pass should be tagged `[in-progress]`, not
`[user-judgment-required]`, and should be carried forward by the
loop — not surfaced to the user as questions.

### When `user-judgment-required` IS the right tag

A short list of cases where this tag is genuinely warranted:

- The user has set `metadata-lock: true` in the catalog row or left
  an explicit note in `papers/<citekey>/virgil/notes.json` about
  intended chapter-level identity, and the on-disk file no longer
  matches that intent.
- The on-disk file and `master.bib` describe genuinely different
  works (different authors, different years, no obvious subset
  relation) and the citekey could plausibly refer to either.
- A republication / reprint identity choice where both options are
  defensible and the user has not previously expressed a preference.

If the situation doesn't match one of these, the right move is
almost always to apply a reasonable default (file is source of
truth; update metadata to match) and proceed.

## Persistence: internal convergence loop (no cap)

This skill runs an internal loop, not a single pass. The structure is:

```
loop:
  pass N:
    run Steps 1–9 (preprocess → AI improvements → validate → outstanding list)
    Step 9.5: run audit_deepindex.py — emit punch-list of remaining issues
    compute pass-fingerprint = (audit punch-list, outstanding list as set,
                                validator findings as set)
    if pass-fingerprint matches the prior pass exactly: convergence — exit loop
    if pass N >= 3 AND outstanding list strictly grew AND no items resolved:
        pathological-loop guard — exit loop with stall report
    else: continue (pass N's outstanding items + audit punch-list become
                    pass N+1's agenda)
final:
  emit completion banner (Step 10, see §Output format)
  write addendum log (if this is a resume)
  write streamlining memo
```

**Convergence criterion.** Two consecutive passes produce the *same*
outstanding set (treated as a set of bullet contents, normalized
whitespace) and the *same* audit punch-list and the *same* validator
findings. The skill stops because nothing more can change, not
because a counter ran out.

**No hard cap.** The only termination backstops are (a) genuine
convergence (preferred) and (b) the pathological-loop guard (only fires
after pass 3 if the outstanding list is *growing* and no resolutions
are happening). Most papers converge in 1–4 passes; some books take
5–8. Run all of them autonomously without asking the user.

**Resume across invocations.** If `indexed.state == "deepIndexed"`
when this skill is invoked, the loop still runs — it picks up the
prior summary's `## Outstanding work` and audit punch-list as the
starting agenda and converges from there. Write an addendum log
`<ISO>-deepindex-addendum.summary.md` per §8 (in addition to the
normal summary) when resuming.

## Genre detection (preflight)

After §Preflight (resume detection) but before Step 1, run a fast
genre classifier:

```bash
python3 .virgil/scripts/detect_genre.py papers/$ARGUMENTS
```

Emits one of: `book` / `article` / `multi-article-pdf` / `scanned-ocr` /
`endnote-style`. Several later steps branch on the result:

- `multi-article-pdf` — run `detect_multi_article.py` to identify
  adjacent-article spans for surgical removal (§3a).
- `scanned-ocr` — expect drop-cap loss (run `recover_drop_caps.py`),
  ligature artifacts (run `fix_invisibles.py` aggressively), and
  inline running headers (extend preprocessor's strip patterns).
- `endnote-style` — chapter-end-notes recovery is the primary tier-0
  footnote path (run `reattach_chapter_end_notes.py`); the bibliography
  may live in a unified Notes section (run `itemize_endnotes.py`,
  not the standard §3e itemizer).
- `book` — bibliography may have 100s of entries (use
  `format_references_section.py` rather than hand-shaping); chapters
  may need explicit `\section{}` markers added before §3d's auto-pipeline
  can scope per-chapter.
- `article` — standard path; the existing tier ladder is well-suited.

If `detect_genre.py` is unavailable or its output is ambiguous,
proceed as `article` and let downstream steps detect failures and
adapt.

## Steps

### Preflight: Resume vs. fresh

**Default is resume.** Before doing anything else, check the catalog
row for this paper. If `indexed.state == "deepIndexed"`, a prior pass
has run — pick up from where it left off and the loop will continue
to convergence from there.

Read:

- The most recent `.virgil/logs/$ARGUMENTS/<ISO>-deepindex.summary.md`
  — specifically its `## Outstanding work` section (the schema from
  §9 below) and `## Audit punch-list` section. Both become the
  starting agenda for the first pass of this invocation.
- The catalog `indexed.warnings` array — every item still present
  there is something the prior pass either deferred or couldn't
  resolve.

The §1 preprocessing scripts are designed to be re-run safely (idempotent
on already-clean input). Run them again — they'll be no-ops if there
is nothing new to fix.

**When this invocation is a resume**, write an addendum log
`<ISO>-deepindex-addendum.summary.md` (alongside the normal
`<ISO>-deepindex.summary.md` per §8) that cross-references the prior
summary's outstanding items, marking each as `resolved` (no longer
present on the current pass) or `carried over` (still present, with
notes on what was tried). This makes multi-pass convergence
auditable across invocations.

**`--fresh` flag.** If the user invokes
`/library/deep-index $CITEKEY --fresh`, treat `$ARGUMENTS` as the
citekey and restart from the baseline before doing anything else:

```bash
cp .virgil/baselines/$CITEKEY-pre-deepindex.tex papers/$CITEKEY/main.tex
```

…then proceed normally. Only use `--fresh` when the user explicitly
asks; resume is always the default.

**No prior baseline?** If `.virgil/baselines/$ARGUMENTS-pre-deepindex.tex`
doesn't exist (paper indexed before baselines were added), copy
`main.tex` to that path before running step 1's preprocessing. Future
re-runs can then `--fresh`-restore.

### 1. Run deterministic preprocessing

```bash
python3 .virgil/scripts/fix_invisibles.py papers/$ARGUMENTS/main.tex
python3 .virgil/scripts/deep_preprocess.py papers/$ARGUMENTS/main.tex
python3 .virgil/scripts/repair_pgmarks.py papers/$ARGUMENTS/main.tex
```

Three deterministic passes:

**0. `fix_invisibles.py`** (new, run first) — strips soft hyphens
(U+00AD) wholesale, normalizes ligatures (U+FB00–U+FB06: `ﬁ` → `fi`,
`ﬄ` → `ffl`, etc.), replaces word-internal NBSP (U+00A0 between two
lowercase letters) with a regular space, and replaces U+2800 (Braille
pattern blank) with `(` in citation contexts. These artifacts break
byte-offset matching in downstream regex work and produce silent
mismatches in Edit calls; clearing them at the front of every pass
removes a whole class of bugs. Idempotent on already-clean input.

**Pgmark repair safeguard.** If `repair_pgmarks.py` would remove more
than 50% of pgmarks, that's a red flag — the paper likely has
multi-section page-label collisions (book with front matter + body +
indexes sharing printed page numbers). The script aborts and prints
a warning in that case; revert to baseline pgmarks (skip the repair)
and let the validator (§3i) emit pre-existing continuity warnings
instead of silently dropping anchors.

**a. `deep_preprocess.py`** — strips repeating running headers and
footers, removes leaked page numbers, rejoins hyphenated line breaks,
joins broken paragraphs, unwraps hard-wrapped lines, cleans
high-confidence mid-paragraph hyphenation artifacts (`re- semble` →
`resemble`), and normalizes OCR-flattened numeric subscripts
(`realism2` → `realism\textsubscript{2}`, `realistici` →
`realistic\textsubscript{1}`) for a whitelisted set of
philosophy/math terms. Ambiguous mid-paragraph hyphen cases (compound
words like `well- known`, `non- trivial`) are left for the AI pass to
judge in §3. The subscript-term whitelist in
`normalize_subscript_artifacts()` should be extended whenever a new
paper surfaces a subscript-bearing term the rule misses.

**b. `repair_pgmarks.py`** — removes spurious `\pgmark{N}` anchors:
false-leading sequences from OCR misreads of the front matter,
duplicate labels emitted by index pages that share printed page
numbers with body anchors, and trailing out-of-order runs. Keeps the
longest contiguous non-decreasing run (with small forward jumps
allowed) and drops the rest. Non-numeric pgmarks (roman / appendix-
style) are passed through untouched.

**Capture each script's stdout summary line verbatim** — they must be
quoted into step 8's `**Preprocessing:**` and `**Pgmark repair:**`
fields unchanged. Do not paraphrase; the exact counts are the only
audit trail of what the deterministic passes changed.

`deep_preprocess.py` omits any counter that is zero, so the line you
see may have 2–3 stats (e.g. `"7 headers removed, 9 paragraphs
joined."`) or up to all five (`"60 headers removed, 29 page numbers
removed, 12 paragraphs joined, 8 hyphenated breaks rejoined, 3
pgmarks inlined."`).

`repair_pgmarks.py` prints either `"No spurious pgmarks in <path>."`
(no changes) or `"Repaired <path>: N spurious pgmarks removed."`
followed by one indented line per removed pgmark. Quote the
*Repaired*/*No spurious* summary line; the per-line detail can be
elided in the log.

### 2. Read inputs

Read all of these:

- `papers/$ARGUMENTS/main.tex` (the preprocessed result)
- The source PDF for structural reference: if any `.pdf` exists in
  `papers/$ARGUMENTS/` — even when the catalog's primary source is a
  DOCX (a PDF *alternate* counts) — run
  `pdftotext papers/$ARGUMENTS/$ARGUMENTS.pdf -` and read **the first
  ~8 pages OR up to and including the first body-text heading,
  whichever is more**. For journal articles 8 pages is plenty; for
  books, 8 pages is usually still front-matter (cover, series listing,
  copyright, dedication, ToC) — keep reading until you hit Chapter 1
  / Introduction so you have a real heading sample to anchor §3a/§3b
  on. Skip only when no PDF is present at all. The PDF is structural
  reference material; it does NOT authorize introducing new content
  (pgmarks, footnotes) that the indexed `main.tex` doesn't already
  have — see §3c, §3d for scope. (Structural rewrapping of existing
  prose, e.g. wrapping a leaked footnote body in `\footnote{}`, is
  not "new content" and is permitted by §3d.)
- `master.bib` — find the entry for this citekey (authoritative
  title, author, year, journal, etc.)
- Check for user notes:
  - `.virgil/queue/$ARGUMENTS-deepindex.json` — if present with a `note` field
    (legacy `.virgil/queue/$ARGUMENTS-richindex.json` is also accepted on read)
  - `.virgil/queue/$ARGUMENTS-paperreview.json` — if present, a coexisting
    paper-review request to incorporate

### 3. Apply AI-driven structural improvements

Work through the document systematically. Make each improvement
category in order:

> **Escalation principle (load-bearing).** When a structural call
> looks ambiguous — a footnote you can't place, a heading you can't
> classify, a pgmark whose target text you can't find, an inline
> citation that doesn't obviously match a bib entry — **do not bail.**
> Escalate through the tier ladder defined in §3d:
>
> - **Tier 0:** in-file scan of `main.tex` for content already present
>   (leaked-prose footnotes, chapter-end notes, inline call sites).
>   Run `reattach_leaked_footnotes.py` and (for endnote-style sources)
>   `reattach_chapter_end_notes.py`. This is faster than PDF
>   re-extraction when the bodies are already in the file.
> - **Tier 1:** PDF re-extraction with `pdftotext -layout` on specific
>   pages; the `extract_pdf_footnotes.py` + `reattach_footnotes.py`
>   pipeline for batched recovery.
> - **Tier 2:** fresh OCR via `ocrmypdf` on individual pages (skip
>   silently if `ocrmypdf` is missing).
> - **Tier 3:** rasterize the page to PNG via PyMuPDF and read it
>   visually (Read tool handles PNG natively). For orphan footnotes,
>   `recover_orphan_footnotes.py` does this in batch against six
>   call-site patterns and ±12K-char context match.
> - **Tier 4 (always succeeds):** for orphan footnotes whose call
>   site cannot be located, attach to the end of the nearest preceding
>   body paragraph as `\footnote{[orphan fn N] <body>}`. The
>   `[orphan fn N]` prefix tells the reader the placement is
>   approximate. **This is strictly better than leaving the
>   numbered paragraph unattached.** Tier 4 closes every footnote.
>
> The ideal is that every section a–i completes with the outstanding
> list empty. Warnings should reflect genuine intractability (the three
> narrow categories from §0.5 scope doctrine), not first-tier doubt.
>
> **"Out of scope" is not a synonym for "hard."** If you are tempted to
> defer a problem with "out of /deep-index scope" as the reason, check
> the §0.5 in-scope list first. Footnotes, chapter titles, pagination,
> misplaced text, drop-cap recovery, invisible characters, bibliography
> parsing (all styles), citation rewriting (all styles), and
> multi-article surgical cleanup are all in scope. The bar for
> out-of-scope deferral is very high; the convergence loop (§Persistence)
> will keep re-running until the outstanding list stabilizes, so
> deferring an in-scope item just means re-doing it next pass.

**a. Header / `\maketitle` cleanup**

Compare the current `\title{…}`, `\author{…}`, `\date{…}` fields
against `master.bib`. Fix them if they're wrong (e.g. title includes
the journal name, or author is in wrong format). Ensure `\maketitle`
is present after the preamble. Remove any author names, journal
titles, or institutional affiliations that leaked into the body text
as paragraphs or headings on the first page (they belong in the
preamble fields, not in the document body).

**Filename-shaped titles.** If `\title{}` matches a filename pattern
(`*.dvi`, `*.pdf`, `*.ps`, or a single-word LaTeX-source residue), the
extractor used the file's source name instead of the printed title.
Replace with the actual title from `master.bib`. If `master.bib` is
also wrong, promote the document's first `\section{}` heading as the
title.

**Drop-cap recovery (OCR'd books).** OCR commonly drops the styled
drop-cap glyph at chapter starts, leaving body text like `ower is the
ability to do work...` mis-classified as a `\subsubsection`. Detect
by scanning the first paragraph after each `\section{}` for a lowercase
opening that doesn't form a valid English word with the section
heading's context. Run:

```bash
python3 .virgil/scripts/recover_drop_caps.py papers/$ARGUMENTS
```

The script reads the corresponding PDF page via `pdftotext -layout`
to recover the missing initial letter and emits a patch list. Apply
each suggestion as a body Edit (one-letter prepend; never modify
surrounding text).

**Content vs. metadata mismatch — match metadata to file.** When the
body content does not match `master.bib`'s `title` (e.g., the file is
a whole book but `master.bib` describes one chapter), the on-disk
file is the source of truth. Update `master.bib`, the catalog row,
and the in-file `\title{...}` to match the file's actual identity.
Use the cover/title-page of the source PDF as the authoritative
title.

Apply this update directly (no `user-judgment-required` deferral)
when **all four** conditions hold:

1. The file is structurally larger (whole book / full proceedings /
   full dissertation), AND
2. The current metadata describes a proper subset (one chapter, one
   excerpt), AND
3. The cover page (first 2 pages, via `pdftotext -layout`)
   unambiguously gives the larger artifact's title, AND
4. The catalog row has no `metadata-lock: true` flag and
   `papers/<citekey>/virgil/notes.json` is silent on intentional
   chapter-level identity.

After updating metadata, set `bib.state = "needs-reauth"` so the
next `/library/authenticate-bib` pass re-verifies the new DOI.
Update the in-file `\title{}` to match. Use
`update_master_bib_entry.py` and `update_catalog_entry.py` (NOT
direct Write) to acquire the file locks safely.

Keep the `user-judgment-required` deferral only for:

- The inverse direction (file is a chapter, metadata describes the
  book) — we can't re-extract the whole book from a chapter file.
- Genuinely different works (different authors, different years,
  no obvious subset relation).
- `metadata-lock: true` in the catalog row, or explicit user notes
  in `papers/<citekey>/virgil/notes.json` about chapter-level
  identity.
- Republication / reprint identity choices where both are defensible
  and the user has expressed no prior preference. Even here, apply
  a reasonable default (keep the existing bib, add a `note` field
  documenting the reprint source) rather than blocking on user
  input.

**Multi-article PDF detection.** If `detect_genre.py` (preflight)
classified the source as `multi-article-pdf`, run:

```bash
python3 .virgil/scripts/detect_multi_article.py papers/$ARGUMENTS
```

The script identifies adjacent-article spans in `main.tex` (text that
belongs to a different article — often JSTOR scans or Annual Reviews
collections include front-of-issue or facing-page content). Surgically
remove each identified span via a body Edit. This **is** in-scope for
/deep-index per §0.5; do not defer it to /index-paper. The threshold
for surgical removal: the span must (a) be clearly attributable to a
different article (different title, different authors), (b) not be
referenced by the body of the indexed paper, and (c) have a clear
start/end boundary (typically a column or paragraph break).

**b. Heading hierarchy**

Walk the entire document and correct `\section` / `\subsection` /
`\subsubsection` usage:

- Remove section numbering from heading text (e.g. `\section{2. The
  Data}` → `\section{The Data}`) — LaTeX auto-numbers sections.
- Demote or remove misclassified headings. Common mistakes:
  - Author name promoted to `\subsubsection{Samuel Cumming}` — delete.
  - Single words that are clearly running header remnants — delete.
  - Subheading levels are wrong (e.g. `\subsection` where `\section`
    is needed based on the document structure).
- Use the PDF's table of contents or visual structure to verify the
  heading hierarchy.

**All-caps sibling promotion.** When `\subsubsection{HEADING1}`,
`\subsubsection{HEADING2}`, … `\subsubsection{HEADINGn}` are all-caps
siblings at the same nesting depth, the extractor mistook journal
small-caps or all-caps styling for a sub-sub-section. Promote each
to `\section{Title Case HeadingN}`. This is a common failure mode
for Annual Reviews, Springer, and other journals that style section
headings in all-caps. Detection: run of ≥2 sibling
`\subsubsection{}` calls whose argument is ≥80% uppercase letters
and ≥4 characters.

**Math-symbol subsection demotion.** Headings whose content is
dominated by math symbols (⊢, ⇑, ⇀, ↿, ▷◁, ≡, ∅, ⊬, ∆, Γ, δ, γ, σ, θ,
⇒) or has fewer than 3 letters or starts with `)` should be unwrapped
back to plain body text. These are inference-rule diagram fragments
mis-promoted from formal-logic/math books. Common in textbooks and
dissertations on logic, semantics, and proof theory.

**OCR-garbage heading detection (cluster awareness).** Per-line
heuristics ("mostly numbers", "single-word fragments") miss ~50% of
garbage headings on edge cases. Use cluster awareness:

- If `\section{}` / `\subsection{}` headings appear in a cluster of
  ≥3 short/noisy entries within 50 lines, and the surrounding body
  text reads like a figure caption (axis labels, coordinate values,
  figure references), the entire cluster is a figure-caption block
  that the extractor synthesized. Delete the headings (or convert to
  `\textbf{}` if the captions are needed).
- Single-character headings, headings whose argument is mostly
  non-alphabetic punctuation, and headings with `\(\d+\)\s*[a-z]'?\(`
  shape (formal-semantics example markers): delete or convert to
  body text. They are not headings.

**Multi-line section fragment merger.** Book chapter titles often
wrap across extraction lines (e.g., `\section{Convention, Construction,
and}` immediately followed by a blank line and `\section{Cinematic
Vision}`). Detect adjacent `\section{}` calls separated only by blank
lines where the first ends without terminal punctuation (no period,
no question mark, no closing quote), and merge them into a single
heading. Preserve italic-toggle and quote-context.

**Lost section heading recovery.** If a chapter or section heading
appears to be missing — sequence reset detected in body text (e.g.,
note numbers jump backward from 47 to 1), or the body contains a
chapter list that doesn't match the present headings — propose
inserting it. Source the title from the body's chapter list or the
PDF's TOC.

**c. `\pgmark` alignment**

> **Short-circuit for DOCX-native (or otherwise pgmark-less) papers.**
> If the catalog row has `indexed.pgmarkCount == 0` — typical for
> DOCX-native extraction, plain-text imports, etc. — there are no
> markers to align. **Skip §3c entirely.** Do **not** read the PDF
> alternate and synthesize new pgmarks; that's out of scope for
> deep-index (it would re-extract page boundaries, which belongs to
> `/index-paper`). The validator in §3i will pass trivially in this
> case (zero markers ⇒ no scope violations, no continuity gaps).
>
> Note: §2's PDF reading rule (read the first ~8 pages of any
> available PDF for structural reference) **still applies** — it's a
> read-only structural cross-check, not a pgmark-synthesis step.
> Only the per-marker alignment work in §3c is short-circuited.

Verify that `\pgmark{N}` appears **above** the first line of content
from printed page N. After header/footer removal, some markers may
have shifted relative to their content. Cross-check against the PDF
text to confirm correct placement.

**Scope rules (load-bearing — silently breaks rendering if violated).**
`\pgmark{N}` must appear at **document body scope only**. Never inside:

- math mode: `\[...\]`, `$...$`, `\begin{equation}...\end{equation}`,
  `align`, `gather`, `multline`, or any other math environment;
- the brace-argument of a command: `\footnote{...}`, `\textbf{...}`,
  `\textit{...}`, `\section{...}`, `\subsection{...}`, `\title{...}`,
  `\author{...}`, `\date{...}`, etc.;
- the preamble (above `\begin{document}` / `\maketitle`).

The renderer's pgmark scanner only sees markers at body scope; one
inside math or a command argument is silently swallowed and produces
no margin chip.

If a source page boundary cuts through one of these constructs, place
the pgmark on its own line *before* the enclosing block. If that loses
too much fidelity (e.g., the boundary truly falls inside a multi-line
equation), **split the block at the boundary** into two pieces with
the pgmark on its own line between them. Example — equation (4) of
`cumming2024attentional` with the page break running through the `=`:

```latex
\[ (4) \quad [\![\text{Why is Mary annoyed?}]\!] = \]

\pgmark{5}

\[ \lambda p.\, \text{Explanation(that Mary is annoyed, } p) \]
```

Do **not** fuse those two displays into one — the pgmark would have
to live inside math, and would disappear.

**d. Footnote recovery (full tier ladder, Tier 0 → Tier 4)**

Footnotes have three failure modes from the original extractor:

1. **Orphan-comment form** — `% orphan footnote` comments scattered
   in the body; the call site is unknown.
2. **Leaked-prose form (most common)** — pymupdf and similar
   extractors emit footnote bodies as ordinary paragraphs at
   page-bottom, beginning with a bare or superscript footnote number.
3. **DOCX-dropped form** — DOCX extractor silently drops PDF
   footnotes; the body has no `\footnote{…}` and no leaked-prose
   bodies, but the PDF alternate has visible footnotes.

For modes 1 and 2, walk the tier ladder below. For mode 3, the DOCX
case stays out-of-scope for re-extraction (warn and continue, per the
existing DOCX-native rule below) — but the warning is single-issue,
not a stall reason for the rest of the pass.

> **Tier 0 — in-file scan (run first, fastest).** Most leaked-prose
> footnotes are already present in `main.tex` as paragraphs; the work
> is to locate the call site within the same chapter and rewrap. Run:
>
> ```bash
> python3 .virgil/scripts/reattach_leaked_footnotes.py papers/$ARGUMENTS/main.tex
> ```
>
> The script walks `main.tex` for paragraph-start patterns
> (`^\d+\s+<body>$`, `^\d+\.\s+<body>$`, column-glued
> `^\d+\s+<body>\s+\d+\s+<body>` runs) and matches each leaked body
> to an inline call site via six patterns: `<word>.N`, `<word>N`
> (no separator), `<word>,N`, `<word> N`, `<close-punct>N`, and
> `<digit>, N`. Rewraps each match as `\footnote{<body>}` inline at
> the call site. Reports placed vs. unplaced counts.
>
> If the source is endnote-style (chapter-end notes rather than
> per-page footnotes), run instead:
>
> ```bash
> python3 .virgil/scripts/reattach_chapter_end_notes.py papers/$ARGUMENTS/main.tex
> ```
>
> This script identifies notes-block structure (last paragraph of a
> chapter starting with `^1\.\s+`, followed by `2\.`, `3\.`, … and
> ending at the next chapter or end of section), parses the bodies,
> and matches inline call sites within the parent chapter. Expects
> 70–95% recovery before Tier 1.
>
> If `% orphan footnote` comments exist in the document with no
> known call sites, those are mode 1 — leave them for Tier 3.5 (PDF
> call-site recovery via `recover_orphan_footnotes.py`) and Tier 4.

If `% orphan footnote` comments exist in the document (mode 1),
attempt to re-attach them as `\footnote{…}` at the correct position
in the body text. Use footnote numbering from the PDF to identify the
attachment point. If you can't determine the correct position with
Tier 0, walk Tiers 1–4 below — **don't leave orphan comments in
place once the ladder has been walked**; the Tier 4 fallback always
gives every footnote a home.

> **DOCX-native sources with PDF alternate.** The DOCX extractor
> commonly drops PDF footnotes silently — no `% orphan footnote`
> markers are emitted, and the body text has no `\footnote{…}` either.
> Deep-index does **not** synthesize footnotes from the PDF in this
> case (recovery requires re-extracting against the PDF, which belongs
> to `/index-paper`). If you notice the asymmetry (PDF has visible
> footnotes, `main.tex` has none), record exactly one warning of the form
> `"footnote-recovery-needed: <count> footnotes in PDF source not
> present in main.tex"` for step 5 to merge into
> `entry.indexed.warnings`, and continue. Do not block the deep-index
> pass on this.
>
> **How to derive `<count>` (must be deterministic across re-runs).**
> Run `pdfinfo papers/$ARGUMENTS/$ARGUMENTS.pdf | grep '^Pages:'` to
> get the page count K. Then extract every line of `pdftotext` output
> that is a bare positive integer between 1 and 200 (inclusive) —
> footnote numbers virtually never exceed 200, and this hard cap
> excludes journal-offset page numbers like 730..756 outright.
> Then identify and **subtract the page-number set**:
>
> 1. Look at your bare-integer set. Find the **longest run of
>    consecutive integers** in it (e.g. for `{1,2,3,5,7,8,9,10,11,17}`
>    the longest run is `{7,8,9,10,11}`).
> 2. If that run has length ≥ `min(K, 8)` — i.e. it covers most of
>    the printed pages, or at least 8 consecutive pages for very
>    short papers — treat the entire run as page numbers and remove
>    it from the set.
> 3. If no such run exists (e.g. the PDF doesn't surface page numbers
>    as bare integers at all, or pagination is non-numeric), do
>    nothing — the bare-integer set is already mostly footnotes.
>
> Then take the maximum of what remains. That is the footnote count.
> Do **not** count occurrences of each integer — count once. If the
> remaining set is empty, the count is 0 and you emit no warning.
>
> **Why this works.** Page numbers in `pdftotext` output appear as a
> contiguous arithmetic sequence (one per page boundary, in order),
> whether the article paginates from 1 or from a journal offset like
> 730. Footnote numbers are also a contiguous arithmetic sequence
> in principle, but their range stays under 200 in practice (the
> 200-line cap above already excluded most page-number runs that
> start at high offsets; the contiguous-run detector handles the
> rest). The detector is conservative — it underreports rather than
> overreports (better to miss a footnote-count warning than fire a
> spurious one).

> **PDF-native sources with footnote bodies leaked as paragraph prose.**
> Many PDF extractors (pymupdf in particular) emit footnote bodies as
> ordinary paragraphs at the page-bottom, with no `% orphan footnote`
> marker — the prose just sits there as a paragraph beginning with a
> bare or superscript footnote number (e.g. `1Not absent some extra
> information…`, `7See e.g., Hobbs [1979, 1990]…`). When the source
> is the PDF itself (not a DOCX with a PDF alternate), and the body
> text contains corresponding inline superscript markers (or
> bracketed numbers like `[1]`), **do** re-attach the leaked
> paragraphs as `\footnote{…}` at their call sites. The mapping is
> determined by the leading footnote number on the leaked paragraph
> matching an inline marker in the body text earlier on or near the
> same page. Strip the leading number from the footnote body, escape
> internal braces if needed, and place the `\footnote{…}` inline at
> the call-site superscript position. Footnote-internal citations get
> rewritten per §3g just like body citations.
>
> **Escalation ladder when the inline marker is missing or ambiguous.**
> Do not bail at the first ambiguity. Run through these tiers per
> unresolved footnote until you find the call site. Only the final
> tier produces a `footnote-recovery-needed:` warning, and only after
> all earlier tiers exhaust.
>
> **Before invoking any tier: verify the PDF-page → printed-page
> offset.** Don't assume a fixed offset (e.g. `+10` or `+11`) — the
> number of PDF pages between the cover and printed page 1 varies per
> paper. Pin it by finding the PDF page on which the printed
> page-number footer matches the lowest existing `\pgmark{N}` in
> `main.tex`:
>
> ```bash
> # Find the PDF page whose footer says <N>; offset = pdf_page - N
> for p in $(seq $N $((N+30))); do
>   pdftotext -layout -f $p -l $p papers/$ARGUMENTS/$ARGUMENTS.pdf - 2>/dev/null \
>     | awk -v n=$N '$0 ~ "^[[:space:]]*"n"[[:space:]]*$" { print p; exit }'
> done
> ```
>
> (Or call `recover_missing_pgmarks.py` / `recover_page_break_fragments.py`
> / `extract_pdf_footnotes.py`, which auto-detect the offset.) Mis-typed
> offsets cause every subsequent tier-1 lookup to land on the wrong
> page, with no obvious error signal — verify once at the start of the
> session.
>
> **Before placing reconstructed prose: pre-flight a duplicate check.**
> If you're about to insert a sentence or paragraph reconstructed from
> the PDF, first grep `main.tex` for the leading 4-6 words. The
> extractor sometimes preserves a *truncated* version of the text
> elsewhere (e.g., earlier in the paragraph, or just before the page
> break), and inserting a fresh copy creates a hard-to-spot duplicate.
> If a near-match exists, EXTEND the existing truncated location
> rather than INSERT a fresh copy.
>
> **Tier 1 — context re-read with `-layout`.** Many PDF extractors
> (pymupdf in particular) collapse superscript markers into the
> baseline text or drop them entirely. Re-run `pdftotext` in layout
> mode on the page in question (`$N` is the PDF page, computed from
> the printed page plus the verified offset above):
>
> ```bash
> pdftotext -layout -f $N -l $N papers/$ARGUMENTS/$ARGUMENTS.pdf -
> ```
>
> Layout mode preserves vertical position and often surfaces
> superscripts that the default mode lost. Compare against the
> current `main.tex` body to find the call site, then place the
> `\footnote{…}`.
>
> For batch footnote recovery across many pages, prefer the
> `extract_pdf_footnotes.py` + `reattach_footnotes.py` pipeline:
>
> ```bash
> python3 .virgil/scripts/extract_pdf_footnotes.py \
>   papers/$ARGUMENTS/$ARGUMENTS.pdf \
>   papers/$ARGUMENTS/main.tex \
>   .virgil/work/$ARGUMENTS/footnotes.json
> python3 .virgil/scripts/reattach_footnotes.py \
>   papers/$ARGUMENTS/main.tex \
>   .virgil/work/$ARGUMENTS/footnotes.json
> ```
>
> The first script auto-detects chapter boundaries via `\section{}`
> headings + nearest `\pgmark{}`, walks each chapter's PDF pages, and
> parses vertical-format footnote bodies into a per-chapter JSON. The
> second walks each chapter's body in `main.tex`, finds inline call
> sites (`<letter-or-punct>N<word-boundary>`), and inserts
> `\footnote{<body>}`. Run `clean_fn_trailing_pagenum.py` afterward
> to strip any leaked printed-page-number footers that got swept into
> footnote bodies. Footnotes the auto-pipeline doesn't place fall
> through to Tier 2/3.
>
> **Tier 2 — fresh OCR.** If `ocrmypdf` is available, generate a
> fresh OCR layer for just the relevant page(s):
>
> ```bash
> mkdir -p .virgil/work/$ARGUMENTS
> ocrmypdf --pages $N --force-ocr -O 0 --output-type pdf \
>   papers/$ARGUMENTS/$ARGUMENTS.pdf \
>   .virgil/work/$ARGUMENTS/page-$N.pdf
> pdftotext -layout .virgil/work/$ARGUMENTS/page-$N.pdf -
> ```
>
> Skip silently if `ocrmypdf` is missing (`command -v ocrmypdf` →
> empty). The Tier 1 result is still useful even if Tier 2 isn't
> available.
>
> **Tier 3 — visual inspection.** Rasterize the page to PNG and read
> it directly. Claude Code's `Read` tool natively shows PNG/JPEG
> images, so you can look at the page as a human would and locate
> the superscript marker by eye:
>
> ```bash
> mkdir -p .virgil/work/$ARGUMENTS
> python3 -c "import fitz; doc=fitz.open('papers/$ARGUMENTS/$ARGUMENTS.pdf'); doc[$N-1].get_pixmap(matrix=fitz.Matrix(2,2)).save('.virgil/work/$ARGUMENTS/page-$N.png'); doc.close()"
> ```
>
> Then `Read .virgil/work/$ARGUMENTS/page-$N.png` and locate the
> superscript marker visually. Use the visible word adjacent to the
> superscript to find the corresponding word in `main.tex` (the OCR
> text and the indexed body should share most of the lexical content)
> and place the `\footnote{…}` there.
>
> For multi-page ambiguities you can rasterize a range with a single
> Python invocation — keep the work directory and clean it up at the
> end of the run (or at the start of the next run).
>
> **Tier 3.5 — batch orphan-footnote recovery.** Before falling back to
> Tier 4, run the batch PDF call-site recovery script against all
> remaining orphans:
>
> ```bash
> python3 .virgil/scripts/recover_orphan_footnotes.py papers/$ARGUMENTS
> ```
>
> The script tries six call-site patterns (`.N`, `wordN`, `,N`, ` N`,
> `<close-punct>N`, `<digit>, N`) against the PDF page text, filters
> running headers/footers, and matches body context within ±12K chars
> of the orphan position in `main.tex`. Expects 70–85% additional
> recovery over Tier 1's auto-pipeline output. Anything still
> unattached after this batch run falls through to Tier 4.

> **Tier 4 — orphan-prefix attachment (always succeeds).** When a
> footnote body cannot be confidently matched to a call site after
> Tiers 0–3.5, attach it to the **end of the nearest preceding body
> paragraph** with `[orphan fn N]` prefix:
>
> ```latex
> ... preceding paragraph's last sentence.\footnote{[orphan fn 7] Not
> absent some extra information about the typing context...}
> ```
>
> The `[orphan fn N]` prefix tells the reader the placement is
> approximate. This is **strictly better** than leaving the numbered
> paragraph loose as prose, which (a) clutters the body with
> mis-classified text and (b) wastes the work of having extracted
> the footnote body. Tier 4 always succeeds; every footnote gets a
> `\footnote{}` wrapper.
>
> Optionally, when many orphans converge to nearby positions, emit a
> summary warning of the form:
>
> `footnote-recovery-needed: <N> footnotes attached with approximate
> placement (orphan-prefix tag) — Tiers 0–3.5 could not pin call sites`
>
> Where `<N>` is the count of footnotes attached with `[orphan fn N]`
> prefix. This warning is informational, not a blocker. Re-running
> deep-index does NOT re-do these — `[orphan fn N]` is the canonical
> form for approximate placements.
>
> This rule is **distinct from the DOCX-native case above**. There,
> footnotes were dropped entirely; here they leak as prose. The
> DOCX-native rule forbids synthesis from the PDF (because re-extraction
> is `/index-paper`'s job); the PDF-native rule permits re-attachment
> from prose already in `main.tex` (no re-extraction, just
> repositioning). The two paths cover disjoint extractor failure
> modes.
>
> **Update `entry.indexed.footnoteCount` after re-attachment.** When
> step 5 writes the catalog row, recompute `footnoteCount` as the
> number of `\footnote{` occurrences in the post-deep-index
> `main.tex` (one shell pass: `grep -o '\\footnote{' main.tex | wc
> -l`). The pre-deep-index value (typically 0 for PDF-native leaked
> sources) reflects the extractor's output, which is now stale.
> Updating it gives downstream readers and the future paper-counts
> UI an accurate picture of how many footnotes the document actually
> carries. Skip this re-count when the deep-index pass made no
> footnote re-attachments — preserve the prior value.

**e. Bibliography / references formatting**

> **Idempotency.** If the references section is already an
> `\begin{itemize}` whose `\item` lines start with `\textbf{…}` — the
> output shape this step produces — a prior deep-index pass already
> shaped it. **Leave the itemize block untouched** and proceed to step
> 3f (which still re-emits `references.bib` fresh from the in-document
> entries). Do not re-flow whitespace, re-order entries, or normalize
> font commands (`\emph{}` ↔ `\textit{}`) on a re-run; that just
> creates churn against any other skill or human edit.
>
> **Partial-coverage idempotency.** If ≥80% of `\item` lines start
> with `\textbf{}`, treat as already-shaped (some entries may have
> been hand-edited and de-bolded). Skip the bulk itemization.

> **Batch script for long bibliographies (>50 entries).** For books and
> review articles with hundreds of references, manual itemization is
> error-prone and slow. Run:
>
> ```bash
> python3 .virgil/scripts/format_references_section.py papers/$ARGUMENTS [--style=apa|chicago|endnote|bracket-key]
> ```
>
> Auto-detects style if `--style` is omitted. The script uses a
> state-machine parser that supports multi-word surnames (`McNaughton`,
> `MacEvoy`, `van Fraassen`, `Graf Fara`) via longest-suffix match,
> lowercase particles (`von`, `de`, `van`, `der`, `Mc`, `McC`, etc.,
> up to 3 deep), year regex 1600–2099 with `1967/1973` and `1995a/b`
> forms, accented Latin, hyphenated initials, leaked running-header
> stripping, prefixed page ranges (`S51-S65`), and auto entry-type
> detection.
>
> If the script produces output that looks wrong, fall through to
> manual itemization — but on a long bibliography, the script is
> almost always faster and more accurate than per-entry editing.

The references section is typically the last `\section` of the paper
(headings like "References", "Bibliography", "Works Cited"). After
extraction it usually arrives as one giant run-on paragraph with all
entries concatenated. (Sometimes the preprocessor or the source
already paragraph-separates entries; in that case the split is given
to you. Apply the same per-entry shaping below — bold author, single
line per entry — without further re-paragraphing.) Reformat it as a
LaTeX list with bold author names:

1. Locate the references section heading.
2. Replace the run-on paragraph(s) with `\begin{itemize}` ... `\end{itemize}`.
3. Split into individual bibliography entries. Each entry typically
   starts with an author name and a year, and ends with a period
   followed by the next author's name. Look for patterns like
   `Lastname, F. <year>.` or `Lastname, F., and G. Othername. <year>.`
   to identify entry boundaries.
4. For each entry, emit `\item \textbf{<author portion>} <rest of entry>`.
   The "author portion" is everything from the start of the entry up
   to the year (inclusive of the year and its trailing period).
   - Standard entry: `\item \textbf{Cumming, S. 2008.} "Variabilism." \textit{Philosophical Review} 117: 525–95.`
   - "Same author" dash entries (`———. 1969.`): bold the dash and year:
     `\item \textbf{———. 1969.} "Vacuous Names." ...`
5. Join broken lines within an entry into one line. Rejoin hyphenated
   word breaks (`Univer-\nsity` → `University`).
6. Preserve the order of entries from the original.
7. Preserve `\pgmark{N}` markers — keep them between `\item` entries
   when the original paragraph crossed a page boundary.

Use `\textit{...}` for journal/book titles where appropriate (italics
in the source PDF). Don't try to reformat the citation style — keep
the author's original conventions.

**Worked example.** Input (one run-on paragraph after preprocessing):

```
Bach, K. 2002. "Giorgione Was So-Called Because of His Name."
Philosophical Perspectives 16: 73–103. Barwise, J., and J. Perry.
1983. Situations and Attitudes. Cambridge, MA: MIT Press. Burge, T.
1973. "Reference and Proper Names." Journal of Philosophy 70: 425–39.
———. 1977. "Belief De Re." Journal of Philosophy 74: 338–62.
```

Output:

```latex
\section{References}

\begin{itemize}
\item \textbf{Bach, K. 2002.} "Giorgione Was So-Called Because of His Name." \textit{Philosophical Perspectives} 16: 73–103.
\item \textbf{Barwise, J., and J. Perry. 1983.} \textit{Situations and Attitudes}. Cambridge, MA: MIT Press.
\item \textbf{Burge, T. 1973.} "Reference and Proper Names." \textit{Journal of Philosophy} 70: 425–39.
\item \textbf{———. 1977.} "Belief De Re." \textit{Journal of Philosophy} 74: 338–62.
\end{itemize}
```

**Build the citekey table.** While shaping each `\item`, also assign a
**citekey** for that entry and record `(citekey, fields)` in a working
table. Steps 3f and 3g consume this table to write `references.bib` and
rewrite inline citations in the body.

Citekey rules (matches the project convention from
`library/scripts/triage_batch.py`):

- Lowercase last name of the first author with non-letters stripped, then
  the 4-digit year, then the first significant title word (skip articles
  like *a/an/the/of/on/in/and*). E.g. `bach2002giorgione`,
  `burge1973reference`.
- **Multi-word surnames** (`Graf Fara`, `de Saussure`, `van der Sandt`,
  `de Beauvoir`): concatenate the surname tokens into a single
  lowercase string with non-letters stripped — `graffara2002shifting`,
  `desaussure1916cours`, `vandersandt1992projection`. Use whatever
  the bibliography lists as the surname-position field (typically
  the form before the comma in `Graf Fara, D.`). When the inline
  citation prose mentions the same author by the full surname (e.g.
  `Graf Fara [2002]`), this concatenated form ensures the body's
  `\cite{graffara2002shifting}` resolves cleanly.
- **Same surname, different person** (David K. Lewis vs. Karen S.
  Lewis): year alone disambiguates if the years differ. Use plain
  `lewis1979scorekeeping`, `lewis2020speaker` — no alphabetic suffix
  needed. Reserve `a`/`b`/`c` for genuinely-same-author same-year
  collisions.
- "Same author dash" entries (`———. 1969.`): reuse the previous entry's
  last name with the new year + titleword, e.g. `burge1977belief`.
- Collisions (two distinct works → same key): append `a`, `b`, `c` in
  source order, e.g. `bach2002a`, `bach2002b`.
- **Pre-existing alphabetic disambiguators take precedence.** If the
  printed bibliography itself already disambiguates two same-year
  entries with `(2018a)` / `(2018b)` (or `(2018a)` cited inline as
  `\citet{glanzberg2018a}`), use exactly those keys —
  `glanzberg2018a`, `glanzberg2018b` — *not* the algorithmic
  titleword form. The author has chosen the disambiguation; preserve
  it. This rule is load-bearing for idempotency: without it, a
  re-run would silently re-key the entries and orphan every
  `\cite{glanzberg2018a}` already in the body.

Pick the BibTeX **entry type** that fits each source:

- `@article` — has a journal (e.g. *Philosophical Review*, page range).
- `@book` — no journal, has a publisher.
- `@incollection` — chapter in an edited volume (has `booktitle`,
  usually `editor`).
- `@inproceedings` — conference paper (has a "Proceedings of …"
  booktitle).
- `@techreport` — institutional tech report or working paper
  (CSLI-NN-NN, MIT-AITR-NNNN, etc.). Has `institution` instead of
  `publisher`, optional `number` for the report ID.
- `@misc` — fallback for anything that doesn't fit (theses, web pages,
  unpublished work).

Parse the entry into BibTeX fields: `author`, `year`, `title` (strip
surrounding straight or curly quotes; keep internal punctuation),
`journal` / `booktitle`, `volume`, `number`, `pages` (use `--` for
ranges), `publisher`, `address`, `editor`. Omit any field not present
in the source — never emit empty `{}` values.

**Author field format — BibTeX-canonical.** The printed bibliography
prose typically uses publication-style punctuation (`Ackerman, L.,
Frazier, M., \& Yoshida, M.` or `Barwise, J., and J. Perry`). That
form is *not* parseable by BibTeX/biber — they need names separated by
a literal ` and ` (and only ` and `, no Oxford comma, no `&`).
**Translate to canonical form** when emitting `references.bib`:

- Surname-first form: `{Lastname1, F1. and Lastname2, F2. and Lastname3, F3.}`
- First-last form: `{Firstname1 Lastname1 and Firstname2 Lastname2}`

Pick whichever form the source supplies (initials only ⇒ surname-first;
full given names ⇒ either, but be consistent within an entry). Examples:

| Printed form | `references.bib` |
| --- | --- |
| `Bach, K.` | `Bach, K.` |
| `Barwise, J., and J. Perry.` | `Barwise, J. and Perry, J.` |
| `Ackerman, L., Frazier, M., \& Yoshida, M.` | `Ackerman, L. and Frazier, M. and Yoshida, M.` |
| `Robert Bringhurst` | `Robert Bringhurst` |
| `Jan Tschichold and Robert Bringhurst` | `Jan Tschichold and Robert Bringhurst` |
| `———. 1969.` (same-author dash) | use the previous entry's author field verbatim |

Do **not** preserve the source's `,` `&` `et al.` punctuation between
authors; downstream rendering relies on BibTeX-canonical separators.

**f. Emit `references.bib`**

Write `papers/$ARGUMENTS/references.bib`, **overwriting** whatever
`index_paper.py` previously stamped there (the original is a single-entry
mirror of `master.bib`; we're replacing it with the paper's actual cited
works).

> **Idempotency.** On a re-run where the in-document bibliography is
> unchanged (per §3e's idempotency clause, the itemize was left alone)
> and the format spec below would produce a file byte-identical to
> the existing `references.bib`, **skip the write**. Re-emit only
> when the canonical output would differ from disk. This keeps
> mtime stable across no-op runs.

Format follows `samples/annotation-history/references.bib` — the
canonical in-tree example:

```bibtex
@article{bach2002giorgione,
  author = {Bach, K.},
  title  = {Giorgione Was So-Called Because of His Name},
  journal = {Philosophical Perspectives},
  volume = {16},
  pages  = {73--103},
  year   = {2002},
}

@book{barwiseperry1983situations,
  author = {Barwise, J. and Perry, J.},
  title  = {Situations and Attitudes},
  publisher = {MIT Press},
  address = {Cambridge, MA},
  year   = {1983},
}
```

Field rules:

- Two-space indent, ` = ` separator, brace-quoted values, trailing comma
  on every field, closing `}` on its own line.
- Omit empty fields (don't emit `volume = {}`).
- Preserve special characters as written: `{\'E}`, `\&`, `{e}` for
  protected case, etc.
- Page ranges: replace `–` (en-dash), `—` (em-dash), or single hyphen
  between digits with `--` (double-hyphen, BibTeX standard).
- One blank line between entries.

Order entries to match the order of the body's itemize bibliography
(which already mirrors the printed paper).

This file is **self-contained** — do not look up or merge entries from
`master.bib`. Each paper's `references.bib` is its own namespace; cross-
paper deduplication is a future feature.

**g. Rewrite inline citations**

Walk the body text and replace inline parenthetical / textual citation
prose with `\cite{…}` family commands using the citekey table built in
step 3e.

> **Style detection and rewriter selection.** Citation styles vary
> per discipline:
>
> - **Author-year, Chicago/MLA** — space-separator: `(Author Year)`.
>   Default; pass `--style=chicago` or omit.
> - **Author-year, APA** (psychology, cognitive science) —
>   comma-separator: `(Author, Year)`. Pass `--style=apa`.
> - **Numeric / Vancouver** (biology, medicine) — bare integers in
>   the body. Leave as prose; emit `numeric-citation-style:` warning.
> - **Bracket-key** (SIGGRAPH/CS) — `[GG01]`, `[MAB+97]`. Detect via
>   ≥80% of bracket patterns having a matching `[KEY]` entry in refs.
>   Pass `--style=bracket-key`.
> - **Endnote-style** (humanities books) — full bibliographic detail
>   at first mention; index bib entries under every author surname.
>
> **Multi-word surname handling.** When body says `von Fintel 1994` or
> `Graf Fara 2002`, the standard tokenizer matches only the last token.
> The extended rewriter uses longest-suffix match against the parsed
> surname set from `references.bib`, with particle list (`von`, `de`,
> `van`, `der`, `Mc`, `McC`, etc.) honored to 3 depth.
>
> **Title-only fallback.** After the structured-citation pass, run a
> title-only matcher: any `'<title>'` quote ≥15 chars matching a
> `references.bib` title (strong prefix match) gets `\cite{key}`
> appended after the title. Safeguards: skip text inside existing
> `\cite[]{}` args; require strong prefix match to avoid catching
> concept quotes.

> **Batch tool (preferred for author-year sources).** Run
> `python3 .virgil/scripts/rewrite_citations.py
> papers/$ARGUMENTS/main.tex papers/$ARGUMENTS/references.bib
> [--style=apa|chicago|bracket-key]`. It
> parses both `author = {}` AND `editor = {}` fields from
> `references.bib` (load-bearing for edited collections like
> `@book{block1981imagery, editor = {Block, Ned}}` and
> `@book{gregorygombrich1973illusion, editor = {Gregory, R. L. and
> Gombrich, E. H.}}` — a citation-rewriter that only reads `author`
> silently misses these), normalizes surnames via NFKD-fold for fuzzy
> matching, and applies natbib rewrites (`\cite{}` for parenthetical,
> `\citealt{}` inside footnotes and bare prose, `\citet{}` for
> `Author (Year)`). It also fixes common OCR year garbles like
> `i960` → `1960`. The auto-pass handles ~95% of cases; remaining
> ambiguous mentions get flagged as `missing-bib-entry:` for manual
> resolution per the spec below.

> **Citation-style detection (do this first).** Look at how the body
> text references its bibliography. Two regimes:
>
> - **Author-year** (default in linguistics, philosophy, social
>   science): mentions take the shape `(Author Year)`, `Author
>   (Year)`, `Author and Author Year`, `Author et al. Year`, etc. Use
>   the natbib vocabulary and tables below.
> - **Numeric / Vancouver-style** (default in biology, medicine,
>   chemistry, much of psychology, Nature/Science journals): mentions
>   take the shape of bare superscript or bracketed integers — e.g.
>   `26,27`, `[22-25,28,29]`, `131,134,135,157--159`. The references
>   list is numbered, and the integers in the body are reference IDs.
>
> If the source is **numeric/Vancouver-style**: do NOT apply the
> author-year vocabulary below. Instead, leave the inline numeric
> mentions as prose verbatim, and append exactly one warning of the
> form `numeric-citation-style: source uses Vancouver-style numeric
> citations; inline rewrite skipped` to `entry.indexed.warnings`
> (this is a fifth recomputed-prefix kind alongside the four in §5;
> step 5 must drop any prior `numeric-citation-style:` line and
> re-emit it). Do NOT emit `missing-bib-entry:` warnings either —
> the lookup spec keys on author surnames, which numeric prose
> doesn't carry. The references.bib still gets emitted normally per
> §3e/§3f, just with citekeys that the body doesn't reference. A
> later authenticate/cross-link pass can build the numeric→citekey
> map if/when the renderer's natbib numeric mode gains UX in the
> Library reader. Skip the rest of §3g for numeric-style papers and
> proceed to §3.h.

For author-year sources, continue:

Use **natbib** semantics. The vocabulary is richer than just `\cite` and
`\citet` — pick the form that matches the surface prose so the chip
renders without nested parens or duplicated authors:

- `\cite{key}` — `(Author Year)` parenthetical (the default).
- `\citet{key}` — `Author (Year)` textual.
- `\citealp{key}` — `Author, Year` *without* surrounding parens.
- `\citealt{key}` — `Author Year` *without* surrounding parens.
- `\citeauthor{key}` — author surname only, no year.
- `\citeyear{key}` — year only (no parens).
- `\citeyearpar{key}` — `(Year)` only.

All seven accept the same `[locator]{key}` syntax, e.g.
`\citealp[p.~50]{key}`, `\citeyearpar[pp.~94--95]{key}`.

| Body text | Rewrite |
| --- | --- |
| `(Bach 2002)` | `\cite{bach2002giorgione}` |
| `(Bach, 2002)` | `\cite{bach2002giorgione}` (drop the inner comma) |
| `Bach (2002)` | `\citet{bach2002giorgione}` |
| `(Bach 2002, p. 75)` | `\cite[p.~75]{bach2002giorgione}` |
| `(Bach 2002, pp. 75–80)` | `\cite[pp.~75--80]{bach2002giorgione}` |
| `(Smith and Jones 2008)` | `\cite{smithjones2008keyword}` |
| `Smith and Jones (2008)` | `\citet{smithjones2008keyword}` (textual two-author) |
| `(Smith et al. 2008)` | `\cite{smithetal2008keyword}` |
| `(Bach 2002; Burge 1977)` | `\cite{bach2002giorgione,burge1977belief}` |
| `(Bach 2002a; Bach 2002b)` | `\cite{bach2002a,bach2002b}` |
| `Hobbs (1979, 1985)` | `\citet{hobbs1979coherence,hobbs1985coherence}` (multi-year, same author) |
| `Mann and Thompson (1988, p. 243)` | `\citet[p.~243]{mannthompson1988rhetorical}` (textual + locator) |
| `(e.g., Roberts 1996: 50)` | `(e.g., \citealp[p.~50]{roberts1996information})` |
| `Persson's (2003: 94–95)` | `\citeauthor{persson2003understanding}'s \citeyearpar[pp.~94--95]{persson2003understanding}` |
| `Hume's (1748)` | `\citeauthor{hume1748enquiry}'s \citeyearpar{hume1748enquiry}` |
| `… Smith (2006: 65–67) …` (Smith named earlier in the sentence) | `… \citeyearpar[pp.~65--67]{smith2006attentional} …` |
| `Kehler and Rohde 2017; Rohde 2008, Ch. 6` (bare-form footnote list) | `\citealt{kehlerrohde2017coherence}; \citealt[Ch.~6]{rohde2008coherence}` |

Pattern notes:

- **Parenthetical wrappers** ("(e.g., …)", "(see …)", "(cf. …)"): use
  `\citealp` so the whole thing reads `(e.g., Author, Year)` instead of
  the broken `(e.g., (Author, Year))` that `\cite` would produce.
- **Possessives** ("Persson's", "Hume's"): split into
  `\citeauthor{}` + `'s` + `\citeyearpar{}`. Don't try to fold the `'s`
  into a single chip — the renderer has no facility for it.
- **Continuation back-references** ("Smith earlier … (2006: 65)"): when
  the author was already named in the same sentence/clause, use
  `\citeyearpar[]{}` alone so the rendered text reads `(2006, p. 65)`
  without re-naming Smith.
- **Bare-form footnote lists** (e.g. "*see* Kehler and Rohde 2017; Rohde
  2008, Ch. 6"): use `\citealt` per item — `Author Year` with no parens
  preserves the bare prose shape exactly.

Constraints:

- If prose mentions an author/year with **no matching entry in
  `references.bib`**, leave it as prose AND record both:
  - one line under "Unresolved inline citations" in the deep-index
    summary log; and
  - one entry of the form `"missing-bib-entry: <Author> <Year>"` (one
    per unique author/year pair) for step 5 to merge into
    `entry.indexed.warnings` in `.virgil/catalog.json`. This makes the gap
    durable rather than buried.
- **Ambiguous unsuffixed citation** — if prose has `(Author Year)`
  with no letter suffix but `references.bib` has multiple matching
  entries (`author<year>a`, `author<year>b`, `author<year>c`),
  leave the prose unchanged AND emit
  `"ambiguous-citation: <Author> <Year> (matches: <key1>, <key2>, …)"`
  to `entry.indexed.warnings` (recomputed-prefix on re-runs, same
  shape as `missing-bib-entry:`). Do not try to resolve via
  context heuristics — the user can choose the right suffix
  manually after triage. (Treat this as a fourth recomputed-prefix
  alongside `missing-bib-entry:`, `footnote-recovery-needed:`, and
  `examples-not-converted:` in step 5's drop-and-recompute list.)
- For **multi-author textual citations that include given names**
  ("Barbara Grosz and Candace Sidner (1986)"), leave the prose alone.
  `\citet{}` would render only surnames and silently drop the inner
  given name ("Candace"), producing broken text. Single-author cases
  with a given name ("Philipp Koralus (2014)") are fine to rewrite to
  `\citet{}` — the given name stays as written prose and the
  surname+year becomes the chip; this only breaks when there are inner
  authors whose given names would disappear.
- **Don't** rewrite the visible bibliography list itself — confine the
  scan to the document text *before* the `\section{References}` (or
  "Bibliography" / "Works Cited") heading.
- **Do** rewrite citations inside `\footnote{…}` arguments — footnotes
  routinely contain citations and the renderer accepts `\cite{…}` there.
- **Don't** introduce `\cite{…}` inside math (`\[...\]`, `$...$`,
  equation environments), inside other command arguments
  (`\textbf{…}`, `\section{…}`, `\title{…}`, etc.), or in the preamble.
  Mirror 3c's scope discipline.
- For bare year-only mentions in running prose ("In 2002, Bach argued
  …"), **leave them alone** — the goal is to mark up *citations*, not
  every mention of a year.
- For the "(Bach 2002, p. 75)" form, emit the locator with a tilde
  (`p.~75`) so LaTeX renders it as a non-breaking space.

Every key inside `{…}` must be one that appears in `references.bib`. The
parser at `src/lib/cite-commands.ts` already understands all seven
commands above (plus the comma-separated multi-key form), and the
renderer at `src/lib/bib-parser.ts` (`formatInlineCitation`) has explicit
display cases for each. No preamble change is needed.

**h. Process user notes**

If `.virgil/queue/$ARGUMENTS-deepindex.json` (or the legacy
`.virgil/queue/$ARGUMENTS-richindex.json`) has a `note`, or a coexisting
`.virgil/queue/$ARGUMENTS-paperreview.json` exists, print the note verbatim
in a delimited block:

```
════════════════════════════════════════════════════════════
DEEP-INDEX NOTE · $ARGUMENTS
────────────────────────────────────────────────────────────
<full verbatim note>
════════════════════════════════════════════════════════════
```

Then act on the note — apply whatever additional fixes or adjustments
the user requested.

**h2. Numbered example envelope conversion**

Convert numbered examples in the body — whether already-canonical expex,
`linguex` (`\ex.` / `\a.`), `gb4e` (`\begin{exe}` / `\begin{xlist}`), or
PDF-extracted prose with manual `(1)…(2)…` numbering — into Virgil's
canonical form: `\vexid{<v4-uuid>}\ex…\xe` for single-line examples,
`\vexid{<v4-uuid>}\pex…\a item …\xe` for multi-part. Convert
interlinear glosses (`\gll`-form, column-aligned PDF text) to
`\begingl…\endgl`.

> **Idempotency check (do this first).** Scan the file. If every
> `\ex` and `\pex` is already preceded by `\vexid{<v4-uuid>}` (full
> v4 form: `[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}`),
> a prior pass already canonicalized them. **Do nothing in this
> step** and proceed to 3i. The example region must produce zero
> diffs on a re-run. (If the user manually added a new `\ex`
> without a `\vexid` between runs, only that example gets a fresh
> UUID; existing canonical examples are untouched.)

**Detect-and-convert by source variant.**

*Variant A — Already-canonical expex (`\ex…\xe`, `\pex…\xe`).* Detect:
the regex `\\(?:ex|pex)(?:~|\b|\[|<)` followed eventually by `\\xe`. If
preceded by `\vexid{…}`, leave the entire block untouched. If no
`\vexid`, prepend `\vexid{<fresh-v4>}` on the same line as `\ex` /
`\pex`. Preserve `[exno=N]`, `<tag>`, `\label{…}`, the `~`-suffix, the
body, and any sub-items verbatim. Normalize sub-item markers `\b`/`\c`/
`\d…` to all `\a` (matches what the serializer emits — the parser
auto-cycles a/b/c by position).

*Variant B — `linguex` package.* Detect: `\usepackage{linguex}` in the
preamble, OR a paragraph-starting `\ex.` token (literal `\ex` followed
by `.`) without a matching `\xe` later in the file before the next
`\section`. Convert single-line `\ex. <body>` → `\vexid{<uuid>}\ex\n<body>\n\xe`.
Convert `\ex. <preamble?> \a. item1 \b. item2` →
`\vexid{<uuid>}\pex\n<preamble?>\n\a item1\n\a item2\n\xe`. An example
ends at the next blank line not followed by an `\a.`/`\b.`/`\c.`
continuation, or at an explicit `\z.`. Strip
`\usepackage{linguex}` from the preamble. `\sn.` / `\nl.` (un-numbered
linguex variants) — convert to `\ex` and accept that they'll be
auto-numbered; un-numbered linguex examples are rare.

If the source has `\setcounter{exx}{N}` (or any other counter-restart
directive that overrides linguex's auto-numbering), translate it to
`[exno=N+1]` on the next `\ex` after the directive's position, then
remove the `\setcounter` line. Do not preserve the directive — expex
has no equivalent global counter knob; the per-example `[exno=N]`
override is how we anchor numbering.

```latex
% Source (linguex):
\ex. The cat sat on the mat.

\ex. Consider:
\a. John saw Mary.
\b. Mary saw John.
\c. They saw each other.

% Output:
\vexid{a1b2c3d4-e5f6-4789-abcd-ef0123456789}\ex
The cat sat on the mat.
\xe

\vexid{f1e2d3c4-b5a6-4987-fedc-ba0987654321}\pex
Consider:
\a John saw Mary.
\a Mary saw John.
\a They saw each other.
\xe
```

*Variant C — `gb4e` package.* Detect: `\usepackage{gb4e}` OR
`\begin{exe}…\end{exe}`, OR `\begin{xlist}…\end{xlist}` outside an
existing `\ex…\xe`. Convert `\begin{exe}\ex <body>\end{exe}` (one
item) → `\vexid{<uuid>}\ex\n<body>\n\xe`. **Critical:** when
`\begin{exe}` contains *multiple* top-level `\ex` items, emit each as
a *separate* `\ex…\xe` block with its own `\vexid` — gb4e's `exe` is a
numbered list of unrelated examples while expex's `\pex` is parts of
one. When `\begin{xlist}` nests inside an `\ex`, the outer becomes
`\pex` and the inner items become `\a` items. Preserve `\ex\label{…}`
and `\ex[exno=N]` verbatim. Strip `\usepackage{gb4e}`.

If the source has `\setcounter{ExNo}{N}` (gb4e's global counter
override), translate it to `[exno=N+1]` on the next `\ex` after the
directive's position, then remove the `\setcounter` line — same rule
as for linguex's `exx` counter.

```latex
% Source (gb4e):
\begin{exe}
\ex \label{ex:donkey} Every farmer who owns a donkey beats it.
\ex \begin{xlist}
    \ex Strict reading.
    \ex Sloppy reading.
    \end{xlist}
\end{exe}

% Output:
\vexid{<uuid-1>}\ex\label{ex:donkey}
Every farmer who owns a donkey beats it.
\xe

\vexid{<uuid-2>}\pex
\a Strict reading.
\a Sloppy reading.
\xe
```

*Variant D — PDF-extracted prose with manual numbering.* Detect: a
paragraph-start line matching one of these patterns, with two or more
such lines within ~30 lines of each other:

- `^\(\d+\)\s+\S` — standard `(7) text`.
- `^\(\d+[a-z]\)\s+\S` — sub-letter form `(3a) text`.
- `^\(\d+[a-z]?[''′`'*]+\)\s+\S` — primed variants common in
  linguistics/philosophy: `(4')`, `(4'')`, `(4a')`, `(4*)`, with the
  prime/apostrophe used to mark a transformed or related variant of
  the base example. Treat each primed variant as its **own** example
  (unique `[exno=4']` shape) — but see "Cross-reference repeats"
  below: if a primed marker `(4')` re-appears later for back-
  reference, leave it as prose. **Note:** expex's `[exno=…]` accepts
  brace-quoted strings, so use `[exno={4'}]` to preserve the prime.
- `^\d+\.\s+\S` — bare-number form `7. text` (no parens). Only
  convert when **both** of these hold: (i) ≥2 such lines appear in
  close proximity (within ~30 lines), AND (ii) introductory prose
  signals example shape ("Consider the following:", "the examples
  below", a colon-terminated lead-in). Without the introductory
  signal, bare-number paragraphs are usually procedural lists or
  enumerated arguments — leave them as prose. The
  `\begin{enumerate}` exclusion below still applies.

Strong companion signal across all four detection patterns: prose
nearby that says "consider the following examples", "(N) below", or
"see (N) above". Convert and **strip the source numbering** from the
body text. Sub-items take two equivalent shapes after PDF/DOCX
extraction; both convert to a single `\pex` with `\a` items:

- *Independent-numbered:* `(3a) …  (3b) …  (3c) …` — each sub-item
  carries its own outer number and inner letter.
- *Outer-once + naked-letters:* `(3) a. …  b. …  c. …` — single
  outer number, then bare letter markers `a.` / `b.` / `c.` (often
  on the same logical paragraph after the docx joiner glues them).
  This is the dominant shape in PDF/DOCX-extracted prose.

If a sub-item has its own inner sub-list (`(3a) i. …  ii. …`), nest
the inner items inside `\begin{xlist}…\end{xlist}` under the outer
`\a` (see the worked example below).

If the source has prose between `(N)` and the first sub-item — e.g.
`(11) John was disappointed in Tim.  a. He fired him.  b. He
disobeyed him.` — treat the prose as a leading body line before the
`\a` items, mirroring the Variant B template.

**Emit `[exno=N]` on every converted example using the literal source
number.** Don't try to be clever about "skip when N matches the
auto-counter" — the source numbering is the contract; preserve it
literally on every example so cascading behavior, sectional restarts,
and gaps all stay correct. (See the "Numbering preservation" section
below for why.)

```latex
% Source (PDF-extracted):
(1)  John saw Mary.

(2a) Strict reading.
(2b) Sloppy reading.

(7)  Bach owns a horse.

% Output:
\vexid{<uuid-1>}\ex[exno=1]
John saw Mary.
\xe

\vexid{<uuid-2>}\pex[exno=2]
\a Strict reading.
\a Sloppy reading.
\xe

\vexid{<uuid-3>}\ex[exno=7]
Bach owns a horse.
\xe
```

*With leading prose + naked-letter sub-items + nested inner tier:*

```latex
% Source (PDF/DOCX-extracted):
(11) John was disappointed in Tim.
     a. He fired him.
     b. He disobeyed him.

(14) a. Pre-closing.
        i.  OK.
        ii. OK/right, OK.
     b. Closing.
        i.  Bye.
        ii. Bye.

% Output:
\vexid{<uuid-4>}\pex[exno=11]
John was disappointed in Tim.
\a He fired him.
\a He disobeyed him.
\xe

\vexid{<uuid-5>}\pex[exno=14]
\a Pre-closing.
\begin{xlist}
\a OK.
\a OK/right, OK.
\end{xlist}
\a Closing.
\begin{xlist}
\a Bye.
\a Bye.
\end{xlist}
\xe
```

**Bias toward not converting** when:

- The candidate region sits inside `itemize`/`enumerate`/`quote`/math
  or a command argument.
- The prose says "equation (N)" / "Eq. (N)" / "Figure (N)" referring to
  the same number.
- The list is inside the references / bibliography section.
- The numbering pattern is genuinely ambiguous.
- **Cross-reference repeats.** A candidate `(N)` or `(N-x)` (or
  `(Na)`, `(N.a)`, etc.) whose number matches an example you have
  *already* emitted earlier in the file. These are back-references —
  the author is re-displaying example N (or its sub-item) for
  exposition, not introducing a new example. The body prose nearby
  typically reads as a discussion of the prior example ("recall
  (2-b) above…", or just bare repetition for emphasis). Leave the
  fragment as prose. If converted, you would double-emit `\ex` /
  `\pex` blocks for the same example number, polluting the
  example registry and breaking `[exno=N]` uniqueness. Detection:
  before emitting any `\ex` / `\pex`, check whether `[exno=N]` has
  already been used. If so, the second occurrence is almost always
  a back-reference. (Exception: a paper that legitimately reuses
  numbers via `\setcounter` resets across sections — rare. When in
  doubt, leave as prose and emit `examples-not-converted: candidate
  (N) appears to be a back-reference to earlier example near pgmark
  <P>`.)
- **Sub-item continuations** (e.g. `(26) c.` appearing after an
  earlier `(26) a-b`). The author is extending example 26 with a
  new sub-item at a non-contiguous location. Do **not** emit a
  second `\pex[exno=26]` block (would collide on the exno) and do
  **not** insert a stray `\a item` at body scope (invalid — `\a`
  must live inside `\pex` or `\begin{xlist}`). Leave the
  continuation as prose AND emit
  `examples-not-converted: sub-item continuation of <N> at
  non-contiguous location near pgmark <P>`. The original
  `\pex[exno=N]` block stays as it was; the loss of fidelity (one
  sub-item left as prose) is acceptable until v2 schema supports
  cross-block continuations. (Folding the continuation into the
  original `\pex` is only valid if there is no intervening prose
  between the original block and the continuation — otherwise body
  text would silently be relocated, which is out of scope.)

In any of those cases, leave the region alone and emit a warning of the
form `examples-not-converted: <reason> near pgmark <N>` for step 5 to
merge into `entry.indexed.warnings`.

> **Locator fallback for pgmark-less papers.** When the catalog row
> has `indexed.pgmarkCount == 0` (DOCX-native, plain-text imports,
> etc.), the "near pgmark <N>" suffix has no meaningful value — the
> file has no `\pgmark` anchors. Use one of these alternative
> locators instead, in order of preference: (a) `near §<section
> heading>` if the candidate region falls under a `\section{…}` /
> `\subsection{…}` heading; (b) `at line ~<N>` using the candidate's
> line number in the post-deep-index `main.tex`; (c) `in <first 6
> words of the candidate region's prose>` as a last resort. Pick
> exactly one locator per warning, and apply the same fallback
> consistently across all `examples-not-converted:`,
> `missing-bib-entry:`, and `ambiguous-citation:` warnings emitted
> for the same paper. The §8 log section follows the same fallback
> rule.

**Do NOT convert `\begin{enumerate}` blocks.** Even when the prose
treats them as examples, the false-positive risk on procedural
enumerations (algorithm steps, feature lists) is too high for v1. Leave
all `\begin{enumerate}` untouched.

**`%!v:XXXX` paragraph-fingerprint markers (DOCX-joiner artifact).**
DOCX-extracted bodies sometimes carry inline `%!v:XXXX` (or
backslash-escaped `\%!v:XXXX`) markers — virgil paragraph
fingerprints emitted when the docx joiner glued sub-items into one
logical paragraph. When converting an example, **strip every
intra-example marker** (between `\ex` and the matching `\xe`) and
**preserve only the example's outer trailing `%!v:XXXX`** on the
closing `\xe` line, so the example still carries one fingerprint
for `virgil.json` matching. Do not synthesize fingerprints; if the
example has none, leave `\xe` bare.

**Glosses.** Detect `\gll <src> \\ <gloss> \\ \glt '<translation>'`
(gb4e/linguex form), or PDF-extracted column-aligned blocks (line A:
foreign-language tokens; line B: same token count, word-by-word
glosses; line C: a quoted free translation). Convert to:

```latex
\begingl
\gla <line A> //
\glb <line B> //
\glft ``<line C>'' //
\endgl
```

`\gll` (two source-tiers) → `\gla` + `\glb`. `\glll` (three) → `\gla` +
`\glb` + `\glc`. `\glt '…'` → `\glft \`\`…''` (straight or backtick
quotes converted to LaTeX double-quote pair). Each tier line must end
with `//`. Preserve TeX accents (`\ae`, `\'e`, etc.) verbatim.

Glosses can nest inside `\ex…\xe` or inside an `\a` item, or stand
alone at body scope (the parser handles all three). Already-canonical
`\begingl…\endgl` blocks pass through unchanged.

**Column-alignment fallback.** When the source's gloss-tier token
count doesn't match the source-tier token count, use `{multi-token
gloss}` brace groups in the gloss tier to enforce alignment (e.g.
`\glb in {(the) beginning} was {word.NOM} //` to match a 4-token
source). If alignment is genuinely impossible (clearly different word
counts, no obvious grouping), fall back to `\glpreamble` /  `\glft`
prose tiers — the parser renders these without enforcing column
alignment, which is the right behavior for a corrupted gloss. **Err
toward emitting a parseable gloss** rather than one with mismatched
aligned tiers.

**Numbering preservation (load-bearing).** The rendered example
number after conversion **must match the source number for every
example**, full stop. This is the single most important correctness
property of this step — body prose throughout the paper refers to
examples by their printed number ("see (7) above", "the contrast in
(3a)–(3b)"), and we explicitly do not rewrite those references (see
"Body cross-references" above). If we silently renumber, every body
mention drifts.

Concrete rules per variant:

- **Variant A (canonical expex).** Preserve every `[exno=N]` from the
  source verbatim. If the source has no `[exno=N]` and uses
  expex auto-numbering, the converted file uses the same auto-numbering
  — match by construction.
- **Variant B (linguex).** Linguex auto-numbers via the `exx` counter,
  starting at 1 and incrementing per `\ex.` Default conversion to expex
  auto-numbering matches by construction. **Translate any
  `\setcounter{exx}{N}` directive** in the source to `[exno=N+1]` on
  the next `\ex` after the directive (and drop the `\setcounter` line).
- **Variant C (gb4e).** Same as B with `\setcounter{ExNo}{N}` instead
  of `exx`. Preserve `\ex[exno=N]` verbatim.
- **Variant D (PDF-extracted manual numbering).** **Emit `[exno=N]` on
  every converted example using the literal source number.** This is
  the only variant where the source numbers are encoded as visible
  text, which means we have ground truth to anchor against — and per-
  example anchoring is the only rule that's robust to sectional
  re-numbering, gaps, hand-curated sequences, and any expex cascading
  behavior we'd otherwise have to reason about.

After conversion, **spot-check the first three and last three examples
in the file**: the rendered `[exno=N]` (or auto-number if none) on
each must equal the source number. If any drift, **edit the
`[exno=N]` value on the affected `\ex` / `\pex` to match the source
number — do not regenerate the UUID, do not move the example, do not
touch its body**. The UUID is the parser's stable id and must not
churn. This check belongs in the §3.h₂ output, not in §3i — the
pgmark validator does not catch number drift.

**UUIDs.** Every `\ex` and `\pex` block gets `\vexid{<v4-uuid>}` on
the same line, immediately preceding it (matching the canonical sample
at `samples/annotation-history/document.tex`). Use full v4 UUIDs (e.g.
`ee5126e9-d91e-4c94-afd8-1eed7591c22e`) — generate inline or via
`python3 -c 'import uuid; print(uuid.uuid4())'`. Verify uniqueness
within the file; regenerate any duplicates (the parser uses the UUID
as the example's stable id; a duplicate would silently merge two
examples in the panel).

If the source already has `\vexid` on *every* `\ex|\pex`, preserve
them all (idempotent path above). If only *some* have `\vexid`,
regenerate all — partial reuse causes divergent IDs across re-runs.

**Labels.** Preserve `\label{…}` from source verbatim
(`\vexid{<uuid>}\ex\label{ex:foo}`). Sub-item labels:
`\a\label{ex:foo:a} …`. **Do not synthesize labels** when the source
has none; the example panel keys by `\vexid`, not `\label`, and a
synthesized `\label{ex:N}` pollutes the namespace and breaks if the
example order changes.

**Body cross-references.** Leave inline `(1)` / `(3a)` / "see example
(3)" mentions in body prose alone. Virgil has no inline-example-ref
schema node; rewriting `(N)` → `\ref{ex:foo}` is out of scope for v1.
The `[exno=N]` mitigation in Variant D preserves rendered numbers so
existing mentions stay visually correct.

**Pgmark interaction.** `\ex`/`\pex`/`\xe` are block-level command
pairs, not braced arguments — `\pgmark{N}` markers inside `\ex…\xe`
bodies stay at body scope and the validator (3i) passes them. The one
trap: a pgmark inside a `\begingl…\endgl` aligned tier line (e.g.
between `\gla` and `\glb`) is body-scope by the validator's lights but
the renderer treats one tier line as one logical row and may swallow
the marker. Mitigation, mirroring the rule from §3c and the second-pass
caution under "Idempotency": **before wrapping any region, scan it for
`\pgmark{N}` markers and pull them out to a blank line just before the
wrap**. Never place a pgmark inside a single tier line. If a page
boundary truly cuts mid-gloss in the source, split the gloss into two
`\begingl…\endgl` blocks with the pgmark between them.

**Constraints.**

- Do **not** introduce `\ex`, `\pex`, or `\begingl` inside math
  (`\[…\]`, `$…$`, `equation`, `align`, etc.), inside other command
  arguments (`\textbf{…}`, `\section{…}`, `\title{…}`, `\footnote{…}`,
  etc.), or in the preamble. Mirror 3c's scope discipline. If a
  footnote body itself contains a numbered example (a `(i)`, `(1)`,
  etc. inside the footnote prose), leave that example as plain text
  inside the `\footnote{…}` argument — `\ex…\xe` cannot live there.
- Do **not** convert numbered lists inside the references / bibliography
  section.
- Do **not** synthesize examples from text that wasn't numbered in the
  source.
- Do **not** convert `\begin{enumerate}` blocks (out of scope v1, even
  when used semantically as examples).
- For Variant D, **always emit `[exno=N]` using the literal source
  number** — never trust expex's auto-numbering to coincide with the
  source. See "Numbering preservation" above.

**Pre-validation recovery — run before §3i.** Two recoverable extraction
gaps the prior /index-paper pass sometimes leaves behind. Both are
Tier-1 cheap (the bodies are already in the source PDF; we just need to
locate and inject them):

> **Recovery 1 — pgmark coverage.** If `indexed.pgmarkCount` is
> significantly smaller than the source PDF's page count (often the
> front N body pages, e.g. 1-41 of a 218-page book, are silently
> missing — small-font footnote layout interferes with the
> header/footer page-number detector in `pgmark.py`), recover them
> with:
>
> ```bash
> python3 .virgil/scripts/recover_missing_pgmarks.py \
>   papers/$ARGUMENTS/main.tex papers/$ARGUMENTS/$ARGUMENTS.pdf
> ```
>
> The script auto-pins the PDF-page → printed-page offset by matching
> the lowest existing `\pgmark{N}` against the corresponding PDF
> page's printed-footer, then walks the missing printed pages 1..(L-1)
> where L is the lowest existing pgmark. For each, it extracts the
> first body words via `pdftotext -layout`, locates them in
> `main.tex`, and inserts `\pgmark{N}`. Pages whose call site is
> inside an existing `\footnote{}` argument or at a hyphenated
> word-break are reported as "couldn't auto-place" and need a manual
> Edit (often an inline `\pgmark{N}` insertion at the word break).
>
> This is **not** out-of-scope for /deep-index, despite the body
> extraction itself belonging to /index-paper. The PDF text isn't
> being re-extracted; existing prose is just being annotated with
> page anchors using `pdftotext` lookups (a Tier-1 operation per §3d).
>
> **Recovery 2 — page-break body fragments.** Detect paragraphs that
> end with a hyphen (`-`) followed by a blank line and a new
> paragraph that doesn't continue the hyphenated word. Each such case
> is a silently-dropped body fragment at the page boundary. Run:
>
> ```bash
> python3 .virgil/scripts/recover_page_break_fragments.py \
>   papers/$ARGUMENTS/main.tex papers/$ARGUMENTS/$ARGUMENTS.pdf
> ```
>
> The script reports each candidate with the recovered fragment text
> from `pdftotext -layout` and the surrounding pgmark anchor. Apply
> each manually with the Edit tool — the agent decides whether the
> fragment continues a hyphenated word inline (e.g. `commit-` +
> `ment` → `commit\footnote{...}\pgmark{N}ment`) or starts a fresh
> paragraph after the page break, since that's a context-dependent
> call the script can't safely make. The pre-flight duplicate-check
> rule from §3d applies: before inserting, grep for the leading 4-6
> words to make sure the text isn't already preserved (truncated)
> elsewhere nearby.
>
> **Recovery 3 — opportunistic OCR-artifact cleanup.** If the
> indices (`\section{Index of names}`, `\section{Index of subjects}`)
> have already been itemized but still show OCR artifacts
> (surname-initial concatenation `JoyceJ.`, comma-spacing artifacts
> `Word,28`, Roman-numeral garbles `ii4` → `114`, em-dash between
> digits `27—8`), run:
>
> ```bash
> python3 .virgil/scripts/clean_index_ocr.py papers/$ARGUMENTS/main.tex
> ```
>
> If any `\footnote{...}` body ends with a stray printed page-number
> (`...Convention C unless I say otherwise. 137}`), run:
>
> ```bash
> python3 .virgil/scripts/clean_fn_trailing_pagenum.py papers/$ARGUMENTS/main.tex
> ```
>
> Both scripts are idempotent and safe to run on already-clean input.

**i. Validate pgmark placement & continuity (hard gate)**

Before writing the file out, run the validator:

```bash
python3 .virgil/scripts/pgmark_validate.py papers/$ARGUMENTS/main.tex --baseline-from-catalog
```

Exit code 0 = clean; exit code 1 = blockers (scope violations, or
continuity breaks newly introduced by this pass). Any blocker must be
fixed before write-back. Read the markdown report it prints; for each
finding, edit the file to fix it, then re-run.

Common fixes:

- `pgmark-scope: math display` — split the surrounding `\[...\]` into
  two displays with the pgmark on its own line between them (§3c).
- `pgmark-scope: argument of \<cmd>` — pull the pgmark out of the
  command's brace argument and place it on its own line before the
  command.
- `pgmark-scope: preamble` — move the pgmark below `\maketitle`.
- `pgmark-gap` / `pgmark-out-of-order` (new vs. baseline) — you almost
  certainly deleted or moved a marker by accident; cross-reference the
  PDF and restore the missing one.

**Math-display-open downgrade rule.** When the validator reports a
`math display open` violation but the open `\[` is followed by ASCII
alphanumeric continuation on the same line (e.g., `sh\[sh`), this is
almost always a PDF extraction artifact (unbalanced bracket from a
Unicode angle bracket `〈 〉` mis-extraction, or a phonetic
transcription that included `[`). A single such artifact can produce
a cascade of 7+ false-positive scope violations. Before treating
these as blockers: scan for orphan `\[` on lines where alphanumeric
characters follow within 10 columns; replace each such `\[` with `[`;
re-run the validator. The cascade should clear.

**Low-confidence pgmark re-verification.** `\pgmark[low]{N}` is not
a permanent classification. After §1's preprocessing pass strips soft
hyphens and normalizes prose, content-overlap verification at a
slightly relaxed threshold (30%, was 40%) and wider window
(±1500 chars, was ±800) often successfully promotes markers that
previously failed. Always re-run `[low]` verification after any prose
cleanup; this is a free pass-2 win.

Pre-existing continuity findings (`_pre-existing_` in the report) are
not blockers — they reflect imperfect detection from the original
extraction and are fine to leave. Only `**new**` findings gate the
pass.

> **Empty-baseline case.** When the catalog row has `warnings == []`
> (typical for papers indexed before continuity-warning emission was
> added to `index_paper.py`), the validator has no baseline to
> compare against and will mark **every** continuity gap as "new".
> To handle this:
>
> 1. **Before** running the preprocessor in §1, copy
>    `papers/$ARGUMENTS/main.tex` to
>    `.virgil/baselines/$ARGUMENTS-pre-deepindex.tex` (`mkdir -p` the
>    dir if missing). This is the snapshot of pre-deep-index state.
> 2. **In §3i**, if the catalog row's `warnings` is empty, run the
>    validator a **second time** against the baseline file:
>    `python3 .virgil/scripts/pgmark_validate.py .virgil/baselines/$ARGUMENTS-pre-deepindex.tex --baseline-from-catalog`
>    The script doesn't need a special flag for this — the file path
>    is the only required positional. The output is its own gap set
>    (call it `B`).
> 3. Re-run on the current `main.tex` to get its gap set (call it
>    `C`).
> 4. **Match gaps by `(prev_pgmark, next_pgmark)` pair**, not by
>    line number (line numbers shift during deep-index). A gap in
>    `C` is `_pre-existing_` iff a gap in `B` reports the same
>    `(prev, next)` pgmark pair. Any gap in `C` whose `(prev, next)`
>    pair has no match in `B` is genuinely **new** and gates the
>    pass.
> 5. Scope violations (`pgmark-scope: …`) are always blockers
>    regardless of baseline — they cannot be pre-existing because
>    the pre-deep-index file rendered fine.
>
> Do not silently dismiss "new" findings without this cross-check.

If three iterations fail to clear all blockers, **abort**: leave
`indexed.state` unchanged (do not write `deepIndexed`), append a
notification with `kind: "deep-index-blocked"` (see step 6 for shape,
swap the kind), and stop. Do not silently downgrade the validator
severity to `warn` — that is the failure mode this skill exists to
prevent.

### 4. Write output

Save the improved document back to `papers/$ARGUMENTS/main.tex`.

### 5. Update catalog

**Do not Read/Write `.virgil/catalog.json` directly** — the catalog is
shared across all skills and concurrent sessions, and ad-hoc rewrites
race. Compute the new field values, write them to a patch file, then
call `update_catalog_entry.py` (which holds `lock_catalog`, applies
the patch, and bumps `catalog-version.txt`).

Compute these field values for the patch:

- `indexed.state` = `"deepIndexed"`
- `indexed.lastIndexedAt` = current ISO timestamp
- `indexed.exampleCount` — count the top-level `\ex` / `\pex` blocks
  in the final body (single + multi combined, including unnumbered
  tagged examples like `\ex<*>`). **Do not count `\a` items,
  `\begin{xlist}` sub-items, or nested gloss tiers** — only the outer
  `\ex` / `\pex` envelopes. Examples skipped per §3.h₂'s "Bias toward
  not converting" rules do not contribute to this count (they live as
  prose; the corresponding `examples-not-converted:` warning logs
  them). Frontends ignore unknown fields, so this addition ships
  without a UI change; a future Library badge can surface it.
- `indexed.pgmarkCount` — recompute if step 1b's `repair_pgmarks.py`
  removed any spurious anchors OR the pre-validation Recovery 1 step
  (§3 pre-validation block) added missing pgmarks. Count the distinct
  numeric labels in `\pgmark[opt]{N}` after the pass so the catalog
  stays in sync with the file on disk. If neither operation changed
  the count, omit the field from the patch and the existing count is
  preserved.

Other `indexed` fields (`extractor`, `footnoteCount`, etc.) and
top-level `updatedAt` are preserved automatically — the patch script
deep-merges nested objects and only the keys you include get replaced.

The `warnings` array is **append-only across passes, except for eight
recomputed prefixes: `missing-bib-entry:`, `footnote-recovery-needed:`,
`examples-not-converted:`, `ambiguous-citation:`,
`numeric-citation-style:`, `pgmark-duplicate:`, `pgmark-gap:`, and
`pgmark-out-of-order:`**. Read existing warnings, **drop any prior
lines starting with any of those eight prefixes** (they're recomputed
by this pass), then concatenate the fresh lines from step 3g
(`missing-bib-entry: <Author> <Year>` and `ambiguous-citation:
<Author> <Year> (matches: ...)`, one per unique pair each, OR a
single `numeric-citation-style: ...` line for Vancouver-style
sources), step 3d (`footnote-recovery-needed: <count> ...`, at most
one), step 3.h₂ (`examples-not-converted: <reason> ...`, one per
skipped region), and step 3i (`pgmark-duplicate:`, `pgmark-gap:`,
`pgmark-out-of-order:` lines emitted by the validator against the
post-repair file). Other warning kinds (from earlier indexing) are
preserved untouched. This keeps idempotency clean: re-running
deep-index on the same paper produces the same warnings array (no
duplicates, no ghost entries from a previous run that have since been
resolved).

> **Why the three pgmark-continuity prefixes are recomputed.** Step
> 1b's `repair_pgmarks.py` removes spurious anchors; afterward, the
> §3i validator emits a fresh set of continuity findings against the
> repaired file. Pre-repair `pgmark-duplicate:`, `pgmark-gap:`, and
> `pgmark-out-of-order:` entries in `indexed.warnings` reflect the
> pre-repair state and are now stale. Recomputing on every pass keeps
> the catalog honest. If repair removed nothing AND no new
> continuity findings surfaced (typical for a resume pass), the net
> effect is zero diffs.

> **`missing-bib-entry` lookup spec (load-bearing).** Emit a
> `missing-bib-entry:` line **only when** the inline mention has no
> matching entry in `references.bib` under this lookup:
> 1. **Normalize each surname** (NFKD-fold, strip diacritics, lowercase,
>    drop hyphens / apostrophes / spaces, drop trailing `jr|sr|iii`).
> 2. **Extract every cited surname** from the mention. Handle:
>    `Author1 and Author2`; `Author1 & Author2`; `Author1, Author2, and
>    Author3` (Oxford comma optional); `Author1 et al.` (treat as a
>    prefix match — first surname only); `Author1, Author2, …, AuthorN`.
> 3. **Match against `references.bib`** by (a) parsing each entry's
>    `author = {…}` field into a normalized surname list, then (b)
>    accepting iff: (i) the cited year matches the entry's year, AND
>    (ii) for `et al.` mentions, the first surname is among the entry's
>    first 3 authors; for explicit `Author1 (and|&) Author2` mentions,
>    every cited surname appears in the entry's author list.
> 4. **Emit the warning only if no entry matches.** If multiple entries
>    match (same first author + year), emit `ambiguous-citation:` with
>    the candidate citekeys, not `missing-bib-entry:`.
>
> Heuristic shortcuts that match only on first-author surname + year
> will produce ~30–50% false-positive `missing-bib-entry` warnings on
> multi-author corpora — this is the failure mode the spec above
> exists to prevent. Do **not** emit warnings then post-hoc filter
> them; implement the lookup correctly the first time, and if the
> lookup is too expensive to do inline (large bibliography), build
> the normalized author-list index once at the start of step 3g and
> reuse it.

Compute the `warnings` array. It's **append-only across passes,
except for eight recomputed prefixes: `missing-bib-entry:`,
`footnote-recovery-needed:`, `examples-not-converted:`,
`ambiguous-citation:`, `numeric-citation-style:`, `pgmark-duplicate:`,
`pgmark-gap:`, and `pgmark-out-of-order:`**. To produce it: read
existing `indexed.warnings` from the catalog (plain `cat
.virgil/catalog.json | jq …` is fine; no lock needed for reads),
**drop any prior lines starting with any of those eight prefixes**
(they're recomputed by this pass), then concatenate the fresh lines
from step 3g (`missing-bib-entry: <Author> <Year>` and
`ambiguous-citation: <Author> <Year> (matches: ...)`, one per unique
pair each, OR a single `numeric-citation-style: ...` line for
Vancouver-style sources), step 3d (`footnote-recovery-needed: <count>
...`, at most one), step 3.h₂ (`examples-not-converted: <reason>
...`, one per skipped region), and step 3i (the pgmark validator's
fresh `pgmark-duplicate:` / `pgmark-gap:` / `pgmark-out-of-order:`
findings against the post-repair file). Other warning kinds (from
earlier indexing) are preserved untouched. This keeps idempotency
clean: re-running deep-index on the same paper produces the same
warnings array (no duplicates, no ghost entries from a previous run
that have since been resolved).

Then write the patch to a temp JSON file and call the catalog updater:

```bash
cat > /tmp/$ARGUMENTS-deepindex-patch.json <<'EOF'
{
  "indexed": {
    "state": "deepIndexed",
    "lastIndexedAt": "<ISO>",
    "exampleCount": <N>,
    "warnings": [<recomputed warnings array>]
  }
}
EOF
python3 .virgil/scripts/update_catalog_entry.py "$ARGUMENTS" \
  --patch-file /tmp/$ARGUMENTS-deepindex-patch.json
rm /tmp/$ARGUMENTS-deepindex-patch.json
```

The script holds `lock_catalog`, deep-merges the patch into the
existing entry (so `extractor`, `footnoteCount`, `pgmarkCount`, etc.
are preserved), and bumps `.virgil/catalog-version.txt` — no manual
bump needed.

### 6. Notify

Use `append_inbox_item.py` rather than reading/writing
`inbox.json` directly (same race-protection reason as catalog):

```bash
cat > /tmp/$ARGUMENTS-deepindex-notify.json <<'EOF'
{
  "kind": "indexed",
  "citekey": "$ARGUMENTS",
  "at": "<ISO>",
  "summary": "Deep-indexed $ARGUMENTS"
}
EOF
python3 .virgil/scripts/append_inbox_item.py \
  --item-file /tmp/$ARGUMENTS-deepindex-notify.json
rm /tmp/$ARGUMENTS-deepindex-notify.json
```

### 7. Mark done

Delete `.virgil/queue/$ARGUMENTS-deepindex.json` (or the legacy
`.virgil/queue/$ARGUMENTS-richindex.json`) if it exists. If a coexisting
`.virgil/queue/$ARGUMENTS-paperreview.json` was also processed, delete that too.

If neither queue file exists but a `.json.done` marker is present
(e.g. `<citekey>-richindex.json.done` left behind by a prior pass),
that's the steady state — leave the marker alone, do not delete it,
and do not treat its absence as an error.

### 8. Log

Write a summary to `.virgil/logs/$ARGUMENTS/<ISO>-deepindex.summary.md`:

```markdown
# Deep-index summary: $ARGUMENTS

**Date:** <ISO>
**Preprocessing:** <stats from step 1a>
**Pgmark repair:** <stats from step 1b>
**References emitted:** <N> entries → references.bib
**Inline citations rewritten:** <M> (with <K> ambiguous mentions left as prose)
**Missing bib entries:** <K> author/year pairs in body without a matching entry — added to `indexed.warnings`.
**Examples converted:** <N> (<single>:<multi>:<gloss-only>:<unchanged-canonical>) — <variant breakdown, e.g. linguex 2, gb4e 1, prose 4>.
**AI changes:**
- <list each structural change made>
```

If any inline mentions were left as prose because no matching bib entry
existed (the "ambiguous" count above), list them under a sub-heading so
follow-up triage can find them:

```markdown
**Unresolved inline citations:**
- "(Smith 2008)" near pgmark 12 — no matching entry in references.bib
- "Jones (1995)" near pgmark 17 — no matching entry in references.bib
```

If any candidate example regions were left unconverted because the
heuristics flagged them as ambiguous, list them under a parallel
sub-heading (one line per warning, mirroring the
`examples-not-converted:` lines added to `indexed.warnings`):

```markdown
**Examples skipped (ambiguous):**
- "(1)…(2)…" inside \begin{enumerate} near pgmark 7 — out of scope v1
- "(3) The data:" inside \begin{quote} near pgmark 14 — non-body scope
```

### 9. Outstanding work (REQUIRED — always emit, even if empty)

Append a `## Outstanding work` section to the SAME summary log file
from step 8 (i.e., `.virgil/logs/$ARGUMENTS/<ISO>-deepindex.summary.md`).
List **every** issue you did not resolve in this pass — be specific,
not vague. One bullet per item:

```
- [<category>] <description> — <why deferred>
```

Allowed `<category>` values:

- `source-missing` — page or block literally absent from the PDF
- `figure-reconstruction` — raster-only content (figures, diagrams)
- `user-judgment-required` — requires user input (rare; high bar)
- `validator-false-positive` — the validator's heuristic flagged
  something that's verifiably correct (journal-offset reprint with
  span fitting in PDF page count, multi-section pagination with
  legitimate page-label namespaces, low-confidence-flood on a
  scanned-OCR book where every marker has been positionally
  verified). Distinct from `user-judgment-required` because there's
  no decision for the user to make — the file is already correct.

These are the **only four categories** that may remain after the
convergence loop completes. Everything else is in-scope per §0.5
and must be drained by subsequent passes. If you find yourself
wanting to use a different category, you are almost certainly failing
to exhaust a tier. Go back and try Tier 0 (in-file scan), Tier 3.5
(batch orphan recovery), or Tier 4 (orphan-prefix attachment).

Allowed `<why deferred>` values (be precise — these are auditable):

- `source-missing — verified absent from PDF (pages X–Y)` — with
  evidence: `pdfinfo` page count vs. expected.
- `figure-reconstruction — raster-only content` — for raster figures
  whose meaning is the image. Text in captions is NOT this category;
  it's in-scope.
- `user-judgment-required — <specific question>` — with the exact
  question that needs the user's input. Default expectation: this
  is almost never the right reason.
- `validator-false-positive — <finding kind>: <why it's correct>` —
  e.g., `range-impossible: span fits in PDF page count (offset
  reprint)`. The corresponding catalog warning gets a
  `…-false-positive:` prefix so future passes don't re-flag it.

**If everything was resolved**, write the section with body:

```markdown
## Outstanding work

None. Document is fully cleaned.
```

Do **not** omit the section — its presence (including the "None"
form) is the contract that downstream readers can rely on. A
missing `## Outstanding work` section is a skill-protocol violation.

**Convergence interaction.** The persistence loop uses this list,
together with the audit punch-list from Step 9.5, as the convergence
fingerprint. When two consecutive passes produce the identical
outstanding set, the loop exits. Empty or narrow-out-of-scope-only
outstanding lists are the desired terminal state.

Re-runs across invocations should make the outstanding-work list
shrink, not grow.

### 9.5. Audit punch-list (REQUIRED — drives convergence)

After steps 1–9 complete for the pass, run the audit script:

```bash
python3 .virgil/scripts/audit_deepindex.py papers/$ARGUMENTS
```

The script emits a punch-list of concrete cleanup issues that remain
in `main.tex`, `references.bib`, and the catalog. It checks: invisible
characters (U+00AD, U+200B, U+00A0 word-internal, U+FB00–U+FB06
ligatures, U+2800 Braille blank); hyphenation artifacts; title /
metadata cross-check; `references.bib` sample audit; pgmark continuity
+ low-confidence count; footnote inline-rate; citation completeness.

Append the audit output as a `## Audit punch-list` section to the
SAME summary log file from step 8.

```markdown
## Audit punch-list

- [invisibles] 13 U+00AD soft hyphens remain (samples: line 42, 78, 124)
- [hyphenation-artifacts] 4 broken-word joins remain
- [footnote-inline-rate] 5 leaked-prose paragraphs un-reattached
- ...
```

If the punch-list is **empty**, write:

```markdown
## Audit punch-list

Clean. No remaining issues detected.
```

**Convergence semantics.** Each punch-list item is the next pass's
agenda. The pass-fingerprint includes the punch-list as a set, so an
unchanged punch-list (and unchanged outstanding list, unchanged
validator findings) signals convergence and exits the loop. An empty
punch-list plus an empty outstanding list (or only narrow-out-of-scope
items) is the desired terminal state.

### 10. Streamlining memo (REQUIRED — always emit, even if empty)

Write a memo to
`.virgil/memos/<YYYY-MM-DD>-deepindex-streamlining-$ARGUMENTS.md` with
concrete proposals for streamlining future deep-index runs based on
what you observed this pass:

```markdown
# Deep-index streamlining memo: $ARGUMENTS

**Date:** <ISO>
**Run summary:** [link to `.virgil/logs/$ARGUMENTS/<ISO>-deepindex.summary.md`]

## Bottlenecks this run

- <one bullet per friction point — where you spent disproportionate effort, where the skill text was unclear, where deterministic preprocessing left avoidable cleanup, where the escalation ladder fired and why>

## Proposed tools / scripts

### Generalizable

- <name + one-line purpose + why it would have helped — applies to many papers>

### Paper-specific

- <name + one-line purpose + why this paper specifically needed it — applies narrowly>

## Suggested skill-text changes

- <bullets referencing line numbers in `library/skills/deep-index.md` with concrete proposed edits>
```

If nothing surfaced — the run was straightforward, the existing
scripts and tier ladder handled everything — write:

```markdown
# Deep-index streamlining memo: $ARGUMENTS

**Date:** <ISO>

No streamlining observations from this run.
```

…and stop. Short is fine. The memo's *existence* is the contract;
emptiness is permitted but absence is not. Treat the memo as a chance
to feed back into the skill set: paper-specific scripts are useful
even when they only apply once (the user may generalize them later).

## Output format

The terminal output is a human-readable banner — NOT a technical-stats
dump. The audience is the user; the stats live in the summary log
(§8). Emit one of two banners depending on convergence outcome.

**Converged-clean banner** (audit punch-list empty AND outstanding
list empty or narrow-out-of-scope-only):

```
✓ Deep indexing complete: $ARGUMENTS

  Document: <N> chapters / sections, <M> pages
  Footnotes: <K> inline, <J> approximate placement with [orphan fn N] prefix (or "0 orphaned")
  Citations: <N> clickable, 0 unresolved
  Bibliography: <N>-entry references.bib, all entries parsed
  Cleanup: 0 invisibles, 0 hyphenation artifacts, 0 catalog warnings
  Passes: <P> (converged at pass <P>)

  Outstanding: none (or "<N> permanently-out-of-scope items, see log §9")
```

**Stalled banner** (the pathological-loop guard fired, OR convergence
reached but with non-narrow outstanding items remaining):

```
⚠ Deep indexing stalled: $ARGUMENTS

  Converged at pass <P> with residual:
    - <category>: <count> items

  Re-invoke /library/deep-index $ARGUMENTS to retry from here.
  See .virgil/logs/$ARGUMENTS/<ISO>-deepindex.summary.md §9 for detail.
```

The stalled banner is rare — the convergence loop normally drives
everything to an empty or narrow-only outstanding list. If you find
the loop emitting "stalled" frequently, escalate by re-reading §Scope
doctrine and the tier ladder; the typical cause is prematurely
tagging in-scope items as out-of-scope.

The detailed stats (preprocessing counts, pgmark repair counts,
per-tier escalation counts, AI-changes list, full outstanding-work
list, audit punch-list) all live in the summary log file at
`.virgil/logs/$ARGUMENTS/<ISO>-deepindex.summary.md`. Reference the
log path in the streamlining memo (§10).

## What this command does NOT do

These are the **narrow** out-of-scope boundaries. Everything inside
§Scope doctrine is in-scope and the convergence loop drives it to
resolution.

- Does not re-extract the full document from the PDF in bulk.
  Targeted per-page or per-region re-extraction via `pdftotext
  -layout`, `ocrmypdf`, or PyMuPDF rasterization is **in scope** —
  the §3d tier ladder uses it. What's out of scope is rebuilding the
  whole `main.tex` from the PDF; if the catalog row has
  `extraction-empty-body` or pymupdf returned 0 blocks, that's an
  `/index-paper` failure surfaced at the Preflight check, not a
  /deep-index problem.
- Does not touch `master.bib` or bib authentication — those are
  separate concerns handled by `/authenticate-bib`. Each paper's
  `references.bib` is self-contained; cross-paper deduplication and
  per-entry authentication are future features. Exception: when a
  metadata-vs-content mismatch is explicitly authorized by the
  user (§3a), update `master.bib` via `update_master_bib_entry.py`.
- Does not reconstruct figures or diagrams. Raster-only content
  whose meaning is the image stays as-is; text in captions IS in
  scope and must be cleaned. Tag truly-raster items as
  `figure-reconstruction — raster-only content` in §9.
- Does not collapse multi-display equations into a single `\[...\]`
  when a page boundary runs between them. If `\pgmark{N}` already sits
  between two displays in the input, leave the layout split — fusing
  the displays would force the pgmark either inside math (silently
  swallowed by the renderer) or far from its true position.
- Does not "give up" on hard problems by tagging them out-of-scope.
  If you're tempted to tag something as out-of-scope, re-read §Scope
  doctrine and the tier ladder. The skill is designed to be
  persistent; premature deferral defeats that purpose.

## Idempotency

Running `/deep-index` twice on the same paper should not degrade it.
The preprocessing script detects already-cleaned content (no running
headers to strip = no changes). The AI step should similarly recognize
when structural fixes have already been applied and avoid double-fixing.

**Multi-pass addendum pattern (within a single invocation).** The
internal convergence loop runs Steps 1–9.5 N times until the
pass-fingerprint stabilizes. Each pass either resolves outstanding
items from the prior pass or carries them over. The pass-fingerprint
is `(outstanding-list-as-set, audit-punch-list-as-set,
validator-findings-as-set)`. Two consecutive identical fingerprints
trigger exit.

**Multi-pass addendum pattern (across invocations).** When `/deep-index`
is invoked on a paper that's already `deepIndexed`, the new invocation
writes both the normal summary log AND an addendum log
`<ISO>-deepindex-addendum.summary.md` that cross-references the prior
summary's outstanding items, marking each as `resolved` (no longer
present this pass) or `carried over` (still present, with notes on
what was tried). This makes multi-invocation convergence auditable.

A paper that requires more than 2 invocations to converge is unusual
and warrants a streamlining-memo entry diagnosing the friction.

For the bibliography work specifically: on a second pass, the entries
already exist in `references.bib` and the body already has `\cite{…}` /
`\citet{…}` commands. Re-running 3e–3g should produce **zero diffs** in
both `main.tex` and `references.bib`. If the second pass would change
either file, check first whether the difference is genuine new work or
just spurious re-formatting — the latter signals a bug in the rewrite
heuristics.

The catalog `indexed.warnings` array is recomputed per pass for the
`missing-bib-entry:`, `footnote-recovery-needed:`,
`examples-not-converted:`, `ambiguous-citation:`,
`numeric-citation-style:`, `pgmark-duplicate:`, `pgmark-gap:`, and
`pgmark-out-of-order:` prefixes (step 5). Other warning kinds are
preserved verbatim. If a missing entry from a prior pass has since
been added to `references.bib` (e.g. by a manual edit), the rerun
drops it from warnings. Same for stale pgmark-continuity findings
that have been resolved by the §1b repair pass.

For numbered examples specifically: on a second pass, the `\vexid{…}`
markers from the first pass identify each canonical example, and §3.h₂
short-circuits to a no-op when every `\ex|\pex` is already prefixed
with a v4 `\vexid`. Re-running 3.h₂ should produce **zero diffs** in
the example region. If the user manually added a new `\ex` without a
`\vexid` between runs, that single example gets a fresh UUID; existing
canonical examples are left untouched.

When merging or rewriting math fragments on a second pass, **scan the
merge region for `\pgmark{N}` markers first and pull them out to body
scope before doing the merge**. A well-intentioned "improvement" that
fuses two `\[...\]` displays without first extracting the pgmark
between them will silently re-introduce a swallowed marker — exactly
the bug that step 3i exists to catch.

## LaTeX constraints

The output must be valid LaTeX that `parseLatex()` in Virgil can
handle. Stick to:

- `\documentclass{article}`, `\title`, `\author`, `\date`, `\maketitle`
- `\section`, `\subsection`, `\subsubsection`
- `\pgmark{N}` (preserved from extraction)
- `\footnote{…}`
- `\begin{quote}\textit{…}\end{quote}` for captions
- `\begin{itemize}` ... `\end{itemize}` with `\item` entries (used for
  the bibliography section and any source-document lists)
- `\textbf{…}` for bold (used for author names in bibliography entries)
- `\textit{…}` for italics (used for journal/book titles)
- `\[…\]` for display math
- `\cite{key}` / `\cite{key1,key2}` — parenthetical citations.
  Optional locator: `\cite[p.~75]{key}`, `\cite[pp.~75--80]{key}`.
- `\citet{key}` — textual citations ("Smith (2008) argues …").
  Optional locator same as `\cite`. (`\citep{…}` is also accepted by
  the parser but `\cite{…}` is preferred for parenthetical.)
- `\citealt{key}` — "Author Year" textual without parens. Use for
  bare-form footnote lists ("*see* Kehler and Rohde 2017; …").
- `\citealp{key}` — "Author, Year" without parens. Use inside
  parenthetical wrappers like `(e.g., …)`, `(see …)`, `(cf. …)` so the
  result doesn't get nested parens.
- `\citeauthor{key}` — author surname only, no year. Use for
  possessives ("Persson's") and any continuation reference where the
  year is supplied separately.
- `\citeyear{key}` — year only, no parens. Less common; use when the
  surrounding prose already supplies parens around the citation slot.
- `\citeyearpar{key}` — `(Year)`. Pair with `\citeauthor` for
  possessives, or use alone for continuation back-references where the
  author was named earlier in the sentence.

All seven `\cite…` commands accept `[locator]{key}` and comma-separated
multi-key forms.
- `\vexid{<uuid>}` — example id marker (no-op render; emitted on the
  same line immediately before each `\ex` / `\pex`).
- `\ex…\xe` — single-line numbered example. Optional `[exno=N]`,
  `<tag>`, `\label{…}`, and `~`-suffix to suppress trailing space.
- `\pex…\xe` — multi-part numbered example with `\a` sub-items. Same
  optional attrs as `\ex`.
- `\a` — sub-item marker inside `\pex` or `\begin{xlist}`. Optional
  `<tag>`, `\label{…}`.
- `\begin{xlist}…\end{xlist}` — nested sub-tier inside an `\a` item;
  the parser cycles markers a → i → A → I across nesting depth.
- `\begingl…\endgl` — interlinear gloss envelope. Can nest inside
  `\ex…\xe`, inside an `\a` item, or stand alone at body scope.
- `\gla` / `\glb` / `\glc` — aligned (column-by-column) gloss tiers.
  Each tier line ends with `//`; multi-token cells are wrapped in
  `{braces}` to enforce alignment.
- `\glft` — free-translation tier (one quoted line, ends with `//`).
- `\glpreamble` — gloss preamble tier (free prose, ends with `//`).
- Plain text paragraphs

Do not introduce commands that aren't in this list.

> **Stripped packages.** `\usepackage{linguex}` and `\usepackage{gb4e}`
> are removed from the preamble during 3.h₂ — Virgil's parser
> interprets `\ex` / `\pex` / `\begingl` directly without those
> packages, and keeping them would cause the LaTeX preamble to load
> macro definitions that conflict with the parser's expex
> interpretation.

### Font policy (strip rule)

If the input `main.tex` contains any font-affecting preamble line —
`\usepackage{fontspec}`, `\setmainfont`, `\renewcommand{\rmdefault}{...}`,
`\usepackage{times|palatino|lmodern|mathptmx|newtx|...}`, `\fontfamily`,
`\usepackage[T1]{fontenc}` (when paired with a font choice), or any
similar font-controlling directive — **remove it**. Do not preserve,
translate, or replace it with a different font. The Virgil library
renderer pins fonts independently of the source via
`--library-editing-font`; the indexed `.tex` must stay font-agnostic.

The output preamble should match the minimal preamble emitted by
`tex_emit.py`:

```latex
\documentclass{article}
\usepackage[utf8]{inputenc}
\usepackage{amsmath, amssymb}
\providecommand{\pgmark}[1]{}
\providecommand{\vexid}[1]{}
```

…plus `\title`/`\author`/`\date` lines. Nothing else font-related.
(The `\vexid` provide-command keeps the `.tex` valid as a standalone
LaTeX document — `\vexid{…}` renders as a no-op outside Virgil.
`\providecommand` for the expex envelope commands themselves
(`\ex`, `\pex`, `\xe`, etc.) is **not** added; those are not meant to
typeset under stock LaTeX. Authors who want to compile the file with
pdflatex should also `\usepackage{expex}` themselves.)
