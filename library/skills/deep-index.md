---
description: Apply structural cleanup to an already-indexed paper — produces a human-readable LaTeX document from raw extraction. Sets indexed.state to "deepIndexed" (double checkmark). Args: <citekey>
---

# /deep-index

> **Naming note.** This skill was previously called `/rich-index`. Old
> queue files (`.virgil/queue/<citekey>-richindex.json`) and catalog entries
> (`indexed.state == "richIndexed"`) are still accepted on read; new
> writes use the deep-index vocabulary throughout.

**Structurally improve a paper's `main.tex`** — transform raw extracted
text into properly structured LaTeX that is useful to a human reader.

All paths are relative to the library root (the current working directory).

> **Where any memo you write goes.** Dev memos (skill retros, ideas for
> improving this pipeline) → `.virgil/memos/<YYYY-MM-DD>-<slug>.md`.
> Paper-specific analyses or reports → `papers/<citekey>/notes/<slug>.md`.
> Never drop a markdown file at the library root.

## Arguments

`$ARGUMENTS` is the citekey (e.g. `cumming2008`).

## Prerequisites

The paper must already be indexed (`papers/<citekey>/main.tex` must
exist). If it doesn't, tell the user to run `/index-pending` first
and stop.

## Steps

### 1. Run deterministic preprocessing

```bash
python3 .virgil/scripts/deep_preprocess.py papers/$ARGUMENTS/main.tex
```

This applies automated cleanup: strips repeating running headers and
footers, removes leaked page numbers, rejoins hyphenated line breaks,
joins broken paragraphs, and unwraps hard-wrapped lines. Capture the
summary output (e.g. "60 headers removed, 29 page numbers removed").

### 2. Read inputs

Read all of these:

- `papers/$ARGUMENTS/main.tex` (the preprocessed result)
- The source PDF for structural reference: if any `.pdf` exists in
  `papers/$ARGUMENTS/` — even when the catalog's primary source is a
  DOCX (a PDF *alternate* counts) — run
  `pdftotext papers/$ARGUMENTS/$ARGUMENTS.pdf -` and read the first ~8 pages.
  Skip only when no PDF is present at all. The PDF is structural
  reference material; it does NOT authorize introducing new content
  (pgmarks, footnotes) that the indexed `main.tex` doesn't already have
  — see §3c, §3d for scope.
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

**a. Header / `\maketitle` cleanup**

Compare the current `\title{…}`, `\author{…}`, `\date{…}` fields
against `master.bib`. Fix them if they're wrong (e.g. title includes
the journal name, or author is in wrong format). Ensure `\maketitle`
is present after the preamble. Remove any author names, journal
titles, or institutional affiliations that leaked into the body text
as paragraphs or headings on the first page (they belong in the
preamble fields, not in the document body).

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

**c. `\pgmark` alignment**

> **Short-circuit for DOCX-native (or otherwise pgmark-less) papers.**
> If the catalog row has `indexed.pgmarkCount == 0` — typical for
> DOCX-native extraction, plain-text imports, etc. — there are no
> markers to align. **Skip §3c entirely.** Do **not** read the PDF
> alternate and synthesize new pgmarks; that's out of scope for
> deep-index (it would re-extract page boundaries, which belongs to
> `/index-paper`). The validator in §3i will pass trivially in this
> case (zero markers ⇒ no scope violations, no continuity gaps).

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

**d. Orphan footnote reattachment**

If `% orphan footnote` comments exist in the document, attempt to
re-attach them as `\footnote{…}` at the correct position in the body
text. Use footnote numbering from the PDF to identify the attachment
point. If you can't determine the correct position with confidence,
leave the comment in place.

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
> Use the highest distinct footnote number that appears as a
> standalone integer at the foot of a page in `pdftotext` output of
> the PDF alternate. In practice: extract every line that is a
> bare positive integer ≤ 200, take the maximum, and use that as the
> count. Footnote numbers that appear inline in body prose (as
> superscript markers) are not in `pdftotext` output as standalone
> integers, so this filter is robust. Do **not** count occurrences of
> each integer — count once. If the PDF has no footnotes (no bare
> integer lines), the count is 0 and you emit no warning at all.

**e. Bibliography / references formatting**

> **Idempotency.** If the references section is already an
> `\begin{itemize}` whose `\item` lines start with `\textbf{…}` — the
> output shape this step produces — a prior deep-index pass already
> shaped it. **Leave the itemize block untouched** and proceed to step
> 3f (which still re-emits `references.bib` fresh from the in-document
> entries). Do not re-flow whitespace, re-order entries, or normalize
> font commands (`\emph{}` ↔ `\textit{}`) on a re-run; that just
> creates churn against any other skill or human edit.

The references section is typically the last `\section` of the paper
(headings like "References", "Bibliography", "Works Cited"). After
extraction it usually arrives as one giant run-on paragraph with all
entries concatenated. Reformat it as a LaTeX list with bold author
names:

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

Pre-existing continuity findings (`_pre-existing_` in the report) are
not blockers — they reflect imperfect detection from the original
extraction and are fine to leave. Only `**new**` findings gate the
pass.

If three iterations fail to clear all blockers, **abort**: leave
`indexed.state` unchanged (do not write `deepIndexed`), append a
notification with `kind: "deep-index-blocked"` (see step 6 for shape,
swap the kind), and stop. Do not silently downgrade the validator
severity to `warn` — that is the failure mode this skill exists to
prevent.

### 4. Write output

Save the improved document back to `papers/$ARGUMENTS/main.tex`.

### 5. Update catalog

Read `.virgil/catalog.json`, find the entry for this citekey, and update:

```python
entry["indexed"]["state"] = "deepIndexed"
entry["indexed"]["lastIndexedAt"] = "<current ISO timestamp>"
entry["updatedAt"] = "<same ISO timestamp>"
```

Preserve all other fields in the `indexed` object (`extractor`,
`pgmarkCount`, `footnoteCount`).

The `warnings` array is **append-only across passes, except for two
recomputed prefixes: `missing-bib-entry:` and `footnote-recovery-needed:`**.
Read existing warnings, **drop any prior lines starting with either
prefix** (they're recomputed by this pass), then concatenate the fresh
lines from step 3g (`missing-bib-entry: <Author> <Year>`, one per
unique pair) and step 3d (`footnote-recovery-needed: <count> ...`, at
most one). Other warning kinds (from earlier indexing) are preserved
untouched. This keeps idempotency clean: re-running deep-index on the
same paper produces the same warnings array (no duplicates, no ghost
entries from a previous run that have since been resolved).

Write `.virgil/catalog.json` back. Bump `.virgil/catalog-version.txt`.

### 6. Notify

Append to `.virgil/notifications/inbox.json`. The file is wrapped:
`{"items": [...]}`. Push the new entry onto the `items` array (don't
replace the wrapper, don't write a bare object at the top level):

```json
{
  "items": [
    "...existing entries...",
    {
      "kind": "indexed",
      "citekey": "$ARGUMENTS",
      "at": "<ISO>",
      "summary": "Deep-indexed $ARGUMENTS"
    }
  ]
}
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
**Preprocessing:** <stats from step 1>
**References emitted:** <N> entries → references.bib
**Inline citations rewritten:** <M> (with <K> ambiguous mentions left as prose)
**Missing bib entries:** <K> author/year pairs in body without a matching entry — added to `indexed.warnings`.
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

## Output format

```
Deep-indexed $ARGUMENTS.
Preprocessing: <N> headers removed, <M> page numbers removed, ...
AI fixes: <bulleted list of structural changes>.
```

## What this command does NOT do

- Does not re-extract from the PDF. The extraction (`index_paper.py`)
  is assumed complete. This command refines the existing `main.tex`.
- Does not touch `master.bib` or bib authentication — those are
  separate concerns handled by `/authenticate-bib`. Each paper's
  `references.bib` is self-contained; cross-paper deduplication and
  per-entry authentication are future features.
- Does not handle formulas, pictures, graphics, tables, or numbered
  examples — those are out of scope for now.
- Does not collapse multi-display equations into a single `\[...\]`
  when a page boundary runs between them. If `\pgmark{N}` already sits
  between two displays in the input, leave the layout split — fusing
  the displays would force the pgmark either inside math (silently
  swallowed by the renderer) or far from its true position.

## Idempotency

Running `/deep-index` twice on the same paper should not degrade it.
The preprocessing script detects already-cleaned content (no running
headers to strip = no changes). The AI step should similarly recognize
when structural fixes have already been applied and avoid double-fixing.

For the bibliography work specifically: on a second pass, the entries
already exist in `references.bib` and the body already has `\cite{…}` /
`\citet{…}` commands. Re-running 3e–3g should produce **zero diffs** in
both `main.tex` and `references.bib`. If the second pass would change
either file, check first whether the difference is genuine new work or
just spurious re-formatting — the latter signals a bug in the rewrite
heuristics.

The catalog `indexed.warnings` array is recomputed per pass for the
`missing-bib-entry:` prefix only (step 5). Other warning kinds are
preserved verbatim. If a missing entry from a prior pass has since been
added to `references.bib` (e.g. by a manual edit), the rerun drops it
from warnings.

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
- Plain text paragraphs

Do not introduce commands that aren't in this list.

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
```

…plus `\title`/`\author`/`\date` lines. Nothing else font-related.
