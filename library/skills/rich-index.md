---
description: Apply structural cleanup to an already-indexed paper — produces a human-readable LaTeX document from raw extraction. Sets indexed.state to "richIndexed" (double checkmark). Args: <citekey>
---

# /rich-index

**Structurally improve a paper's `main.tex`** — transform raw extracted
text into properly structured LaTeX that is useful to a human reader.

All paths are relative to the library root (the current working directory).

## Arguments

`$ARGUMENTS` is the citekey (e.g. `cumming2008`).

## Prerequisites

The paper must already be indexed (`papers/<citekey>/main.tex` must
exist). If it doesn't, tell the user to run `/index-pending` first
and stop.

## Steps

### 1. Run deterministic preprocessing

```bash
python3 scripts/rich_preprocess.py papers/$ARGUMENTS/main.tex
```

This applies automated cleanup: strips repeating running headers and
footers, removes leaked page numbers, rejoins hyphenated line breaks,
joins broken paragraphs, and unwraps hard-wrapped lines. Capture the
summary output (e.g. "60 headers removed, 29 page numbers removed").

### 2. Read inputs

Read all of these:

- `papers/$ARGUMENTS/main.tex` (the preprocessed result)
- The source PDF for structural reference: run
  `pdftotext pdfs/$ARGUMENTS.pdf -` and read the first ~8 pages.
  If the PDF doesn't exist (DOCX-only source), skip this step.
- `master.bib` — find the entry for this citekey (authoritative
  title, author, year, journal, etc.)
- Check for user notes:
  - `queue/$ARGUMENTS-richindex.json` — if present with a `note` field
  - `queue/$ARGUMENTS-paperreview.json` — if present, a coexisting
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

**e. Bibliography / references formatting**

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

**f. Process user notes**

If `queue/$ARGUMENTS-richindex.json` has a `note`, or a coexisting
`queue/$ARGUMENTS-paperreview.json` exists, print the note verbatim
in a delimited block:

```
════════════════════════════════════════════════════════════
RICH-INDEX NOTE · $ARGUMENTS
────────────────────────────────────────────────────────────
<full verbatim note>
════════════════════════════════════════════════════════════
```

Then act on the note — apply whatever additional fixes or adjustments
the user requested.

**g. Validate pgmark placement & continuity (hard gate)**

Before writing the file out, run the validator:

```bash
python3 scripts/pgmark_validate.py papers/$ARGUMENTS/main.tex --baseline-from-catalog
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
`indexed.state` unchanged (do not write `richIndexed`), append a
notification with `kind: "rich-index-blocked"` (see step 6 for shape,
swap the kind), and stop. Do not silently downgrade the validator
severity to `warn` — that is the failure mode this skill exists to
prevent.

### 4. Write output

Save the improved document back to `papers/$ARGUMENTS/main.tex`.

### 5. Update catalog

Read `catalog.json`, find the entry for this citekey, and update:

```python
entry["indexed"]["state"] = "richIndexed"
entry["indexed"]["lastIndexedAt"] = "<current ISO timestamp>"
```

Preserve all other fields in the `indexed` object (`extractor`,
`pgmarkCount`, `footnoteCount`, `warnings`).

Write `catalog.json` back. Bump `catalog-version.txt`.

### 6. Notify

Append to `notifications/inbox.json`:

```json
{
  "kind": "indexed",
  "citekey": "$ARGUMENTS",
  "at": "<ISO>",
  "summary": "Rich-indexed $ARGUMENTS"
}
```

### 7. Mark done

Delete `queue/$ARGUMENTS-richindex.json` if it exists. If a coexisting
`queue/$ARGUMENTS-paperreview.json` was also processed, delete that too.

### 8. Log

Write a summary to `logs/$ARGUMENTS/<ISO>-richindex.summary.md`:

```markdown
# Rich-index summary: $ARGUMENTS

**Date:** <ISO>
**Preprocessing:** <stats from step 1>
**AI changes:**
- <list each structural change made>
```

## Output format

```
Rich-indexed $ARGUMENTS.
Preprocessing: <N> headers removed, <M> page numbers removed, ...
AI fixes: <bulleted list of structural changes>.
```

## What this command does NOT do

- Does not re-extract from the PDF. The extraction (`index_paper.py`)
  is assumed complete. This command refines the existing `main.tex`.
- Does not touch `master.bib` or bib authentication — those are
  separate concerns handled by `/authenticate-bib`.
- Does not handle formulas, pictures, graphics, tables, or numbered
  examples — those are out of scope for now.
- Does not collapse multi-display equations into a single `\[...\]`
  when a page boundary runs between them. If `\pgmark{N}` already sits
  between two displays in the input, leave the layout split — fusing
  the displays would force the pgmark either inside math (silently
  swallowed by the renderer) or far from its true position.

## Idempotency

Running `/rich-index` twice on the same paper should not degrade it.
The preprocessing script detects already-cleaned content (no running
headers to strip = no changes). The AI step should similarly recognize
when structural fixes have already been applied and avoid double-fixing.

When merging or rewriting math fragments on a second pass, **scan the
merge region for `\pgmark{N}` markers first and pull them out to body
scope before doing the merge**. A well-intentioned "improvement" that
fuses two `\[...\]` displays without first extracting the pgmark
between them will silently re-introduce a swallowed marker — exactly
the bug that step 3g exists to catch.

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
- Plain text paragraphs

Do not introduce commands that aren't in this list.
