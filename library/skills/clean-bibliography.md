---
description: Bibliography cleanup — References itemization, references.bib emission, inline citation rewriting (every style).
arguments: <citekey>
---

# Bibliography cleanup

## Bootstrap (run this first)

This skill operates on the user's Virgil Library. Resolve the library
root and cd into it before running anything else.

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

> Shared doctrine: read [_doctrine.md](_doctrine.md). Even
> 1000+-entry book bibliographies and run-on indices are in-scope —
> deferring is almost always a doctrine violation.

Operates on `papers/$ARGUMENTS/main.tex` and
`papers/$ARGUMENTS/references.bib`. Covers three phases:

- **Step 3e** — itemize the References section, emit one `\item` per
  entry with `\textbf{<author portion>}`, and build the citekey table.
- **Step 3f** — emit `papers/$ARGUMENTS/references.bib` from the
  itemized entries, overwriting the single-entry seed
  `index_paper.py` previously stamped there.
- **Step 3g** — rewrite inline citations in the body text to natbib
  `\cite{…}` family commands.

**Working directory.** Every `python3 .virgil/scripts/<name>.py …`
invocation below assumes pwd is `~/Virgil-Library/` (the library root
where `.virgil/scripts/`, `papers/`, and `master.bib` live). `cd` there
before invoking, or prepend each command with
`cd ~/Virgil-Library && …`.

## Step 3e — Itemize the References section

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

### Batch script (preferred for long bibliographies)

For books and review articles with hundreds of references, manual
itemization is error-prone and slow. Run the auto-detector:

```bash
python3 .virgil/scripts/library/format_references_section.py papers/$ARGUMENTS \
    --diagnostic   # print regex-coverage stats
```

The script auto-detects style from `chicago` / `apa` / `bracket-key`
/ `bracket-numeric` / `siggraph` / `author-year-paren`. It uses a
state-machine parser that supports multi-word surnames (`McNaughton`,
`MacEvoy`, `van Fraassen`, `Graf Fara`) via longest-suffix match,
lowercase particles (`von`, `de`, `van`, `der`, `Mc`, `McC`, etc.,
up to 3 deep), year regex 1600–2099 with `1967/1973` and `1995a/b`
forms, accented Latin, hyphenated initials, leaked running-header
stripping, prefixed page ranges (`S51-S65`), and auto entry-type
detection. The shift-by-one bug (each `\item` containing the tail of
the previous entry plus the head of the next) was fixed in Phase 1.3
— every anchor is now the START of its entry, not the END.

**Style flags** (when auto-detection picks the wrong one):

- `--style=siggraph` for all-caps author Chicago bibliographies
  (SIGGRAPH / Eurographics).
- `--style=author-year-paren` for humanities theses with `Author(s)
  (YYYY[a/b]) Title. Rest.` form.
- `--style=bracket-numeric` for CS-paper `[N]` bibliographies.
- `--same-author-mode` to merge year-only paragraph-starts (`^1998.
  Title…`) into the prior entry's author prefix.

If the script produces output that looks wrong, fall through to
manual itemization — but on a long bibliography, the script is
almost always faster and more accurate than per-entry editing.

**Fallback to year-anchor splitter** when the primary parser yields
implausibly few entries (the script's sanity-check aborts the write
in that case):

```bash
python3 .virgil/scripts/library/itemize_jammed_references.py papers/$ARGUMENTS
```

**Index itemization** (for books with a `\section{Index}` of
flattened-OCR entries):

```bash
python3 .virgil/scripts/library/clean_index_ocr.py papers/$ARGUMENTS/main.tex
```

### Build the citekey table

While shaping each `\item`, also assign a **citekey** for that entry
and record `(citekey, fields)` in a working table. Steps 3f and 3g
consume this table to write `references.bib` and rewrite inline
citations in the body.

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

## Step 3f — Emit / populate `references.bib`

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

### Populate from itemized References (script path)

When `/library/index-paper` only seeded `references.bib` with the
paper itself (so every body `Author Year` mention fires
`missing-bib-entry:`), populate from the itemized References section:

```bash
python3 .virgil/scripts/library/populate_references_bib_from_itemize.py papers/$ARGUMENTS
```

**Precondition (load-bearing).** This script blindly APPENDS — it does
NOT dedupe against existing bib entries. Running it on an
already-populated `references.bib` produces corrupt duplicate entries
(mangled author fields, `-2`-suffixed citekey collisions). Before
invoking, gate on entry count:

```bash
count=$(grep -c '^@' papers/$ARGUMENTS/references.bib)
# Only run if the bib is at seed state (≤ 1 entry — the paper itself).
[ "$count" -le 1 ] && python3 .virgil/scripts/library/populate_references_bib_from_itemize.py papers/$ARGUMENTS
```

Skip the populate step entirely when the bib is already populated
(e.g., on re-runs against a deep-indexed paper, or when `index-paper`
ingested a `.tex` source that came with its own `references.bib`).

### Disambiguate colliding citekeys

When emitted citekeys collide on same-surname-same-year-same-titleword
patterns (kehler-style author-heavy bibliographies):

```bash
python3 .virgil/scripts/library/fuzzy_citekey_disambiguate.py papers/$ARGUMENTS
```

The disambiguator uses title second-word / journal-initials /
publisher-initials before falling back to year-letter suffixes;
rewrites every `\cite{}`-family call in `main.tex` accordingly.

## Step 3g — Rewrite inline citations

Walk the body text and replace inline parenthetical / textual citation
prose with `\cite{…}` family commands using the citekey table built in
step 3e.

### Citation-style detection (do this first)

Look at how the body text references its bibliography. Three regimes:

- **Author-year** (default in linguistics, philosophy, social
  science): mentions take the shape `(Author Year)`, `Author
  (Year)`, `Author and Author Year`, `Author et al. Year`, etc. Use
  the natbib vocabulary and tables below.
- **Author-bracket-year** (Noûs / Wiley humanities / some philosophy
  journals): mentions take the shape `Author [Year]`, `Author [Year:
  page]`, `Author and Author [Year]`, `Author, Author, and Author
  [Year, §N]`. The author is *outside* the brackets (textual), year
  and locator are *inside*. Pass `--style=bracket-locator`. Distinct
  from bracket-key (`[GG01]`) where the whole citation token is
  inside the brackets. Detection signal: ≥5 occurrences of
  `[A-Z][a-zA-Z\-']+\s+\[\d{4}` in the body trumps the chicago
  default — chicago expects paren-style and will miss every one.
- **Numeric / Vancouver-style** (default in biology, medicine,
  chemistry, much of psychology, Nature/Science journals): mentions
  take the shape of bare superscript or bracketed integers — e.g.
  `26,27`, `[22-25,28,29]`, `131,134,135,157--159`. The references
  list is numbered, and the integers in the body are reference IDs.

If the source is **numeric/Vancouver-style**: do NOT apply the
author-year vocabulary below. Instead, leave the inline numeric
mentions as prose verbatim, and append exactly one warning of the
form `numeric-citation-style: source uses Vancouver-style numeric
citations; inline rewrite skipped` to `entry.indexed.warnings`
(this is a fifth recomputed-prefix kind alongside the four in §5;
step 5 must drop any prior `numeric-citation-style:` line and
re-emit it). Do NOT emit `missing-bib-entry:` warnings either —
the lookup spec keys on author surnames, which numeric prose
doesn't carry. The references.bib still gets emitted normally per
§3e/§3f, just with citekeys that the body doesn't reference. A
later authenticate/cross-link pass can build the numeric→citekey
map if/when the renderer's natbib numeric mode gains UX in the
Library reader. Skip the rest of §3g for numeric-style papers.

### Other style cues

Citation styles vary per discipline:

- **Author-year, Chicago/MLA** — space-separator: `(Author Year)`.
  Default; pass `--style=chicago` or omit.
- **Author-year, APA** (psychology, cognitive science) —
  comma-separator: `(Author, Year)`. Pass `--style=apa`.
- **Numeric / Vancouver** (biology, medicine) — bare integers in
  the body. Leave as prose; emit `numeric-citation-style:` warning
  (see above).
- **Bracket-key** (SIGGRAPH/CS) — `[GG01]`, `[MAB+97]`. Detect via
  ≥80% of bracket patterns having a matching `[KEY]` entry in refs.
  Pass `--style=bracket-key`.
- **Bracket-locator** (Noûs / Wiley humanities / some philosophy
  journals) — author textual, year and page locator in square
  brackets: `Author [Year]`, `Author [Year: page]`, `Author and
  Author [Year]`, `Author, Author, and Author [Year, §N]`. Detect
  via ≥5 occurrences of the pattern `[A-Z][a-zA-Z\-']+ \[\d{4}` in
  the body. Pass `--style=bracket-locator`. Distinguish from
  bracket-key: bracket-locator has a textual author *outside* the
  brackets and a 4-digit year *inside*; bracket-key has the whole
  citation token inside the brackets (`[GG01]`).
- **Endnote-style** (humanities books) — full bibliographic detail
  at first mention; index bib entries under every author surname.

**Multi-word surname handling.** When body says `von Fintel 1994` or
`Graf Fara 2002`, the standard tokenizer matches only the last token.
The extended rewriter uses longest-suffix match against the parsed
surname set from `references.bib`, with particle list (`von`, `de`,
`van`, `der`, `Mc`, `McC`, etc.) honored to 3 depth.

**Title-only fallback.** After the structured-citation pass, run a
title-only matcher: any `'<title>'` quote ≥15 chars matching a
`references.bib` title (strong prefix match) gets `\cite{key}`
appended after the title. Safeguards: skip text inside existing
`\cite[]{}` args; require strong prefix match to avoid catching
concept quotes.

### Batch tool (preferred for author-year sources)

```bash
python3 .virgil/scripts/library/rewrite_citations.py \
    papers/$ARGUMENTS/main.tex papers/$ARGUMENTS/references.bib
```

**Default style is `chicago`** (no flag needed). Other styles:

- `--style=apa` for `Author (Year)` parenthetical-year inline.
- `--style=bracket-key` for `[KEY]` (SIGGRAPH/CS).
- `--style=bracket-numeric` for `[N]` (CS theses).
- `--style=bracket-author-year` for `[Author Year]` SIGGRAPH /
  Eurographics inline.
- `--style=author-year-paren` for humanities `Author (Year)`.
- `--style=bracket-locator` for Lee-style `Author [Year: page]`.

**Always add `--also-possessive`** to rewrite `Author's Year` forms
to `\citeauthor{key}'s \citeyearpar{key}`.

It parses both `author = {}` AND `editor = {}` fields from
`references.bib` (load-bearing for edited collections like
`@book{block1981imagery, editor = {Block, Ned}}` and
`@book{gregorygombrich1973illusion, editor = {Gregory, R. L. and
Gombrich, E. H.}}` — a citation-rewriter that only reads `author`
silently misses these), normalizes surnames via NFKD-fold for fuzzy
matching, and applies natbib rewrites (`\cite{}` for parenthetical,
`\citealt{}` inside footnotes and bare prose, `\citet{}` for
`Author (Year)`). It also fixes common OCR year garbles like
`i960` → `1960`. The auto-pass handles ~95% of cases; remaining
ambiguous mentions get flagged as `missing-bib-entry:` for manual
resolution per the spec below.

**Built-in fixes** (no flag needed, applied automatically):

- Alphabetic year-suffix support: body `Peacocke 2017a` resolves
  against bib key `peacocke2017atemporal`.
- Fused-surname tokenizer: `McDowell`, `MacEvoy`, `O'Brien`,
  `D'Alembert`, `Van Dyck` matched as single surname.
- `NOT_A_SURNAME` filter: skips month / day names, `Theorem`,
  `Chapter`, `Volume`, etc., that look like single-token surnames.
- Year-range guard: years outside 1500-2099 are not matched.
- Skip contexts: `©`, `Copyright`, `First published`, `Reprinted`,
  classical references like `Poetics 14`.

### Natbib vocabulary (author-year sources)

For author-year sources, use **natbib** semantics. The vocabulary is
richer than just `\cite` and `\citet` — pick the form that matches
the surface prose so the chip renders without nested parens or
duplicated authors:

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

### Missing-bib-entry lookup spec (load-bearing)

Emit a `missing-bib-entry:` line **only when** the inline mention
has no matching entry in `references.bib` under this lookup:

1. **Normalize each surname** (NFKD-fold, strip diacritics, lowercase,
   drop hyphens / apostrophes / spaces, drop trailing `jr|sr|iii`).
2. **Extract every cited surname** from the mention. Handle:
   `Author1 and Author2`; `Author1 & Author2`; `Author1, Author2, and
   Author3` (Oxford comma optional); `Author1 et al.` (treat as a
   prefix match — first surname only); `Author1, Author2, …, AuthorN`.
3. **Match against `references.bib`** by (a) parsing each entry's
   `author = {…}` field into a normalized surname list, then (b)
   accepting iff: (i) the cited year matches the entry's year, AND
   (ii) for `et al.` mentions, the first surname is among the entry's
   first 3 authors; for explicit `Author1 (and|&) Author2` mentions,
   every cited surname appears in the entry's author list.
4. **Emit the warning only if no entry matches.** If multiple entries
   match (same first author + year), emit `ambiguous-citation:` with
   the candidate citekeys, not `missing-bib-entry:`.

Heuristic shortcuts that match only on first-author surname + year
will produce ~30–50% false-positive `missing-bib-entry` warnings on
multi-author corpora — this is the failure mode the spec above
exists to prevent. Do **not** emit warnings then post-hoc filter
them; implement the lookup correctly the first time, and if the
lookup is too expensive to do inline (large bibliography), build
the normalized author-list index once at the start of step 3g and
reuse it.

### Triaging unresolved mentions

When the script prints `Unresolved (N unique): …`, classify each:

- **OCR year drift** (`Goodman (1978)` when bib has `goodman1968…`):
  the body text is wrong. Hand off to `di-clean-prose` / a manual
  pass — not clean-bibliography's job.
- **Title-as-citation** (`Hyperproof (1994)`, `Treatise (1710)`):
  the body is referring to a work by title, not author. Leave
  unresolved — these are NOT broken citations.
- **Genuinely missing bib entry**: a real cited work absent from
  the bibliography. Eligible for synthesis (see below).

## Bibliography synthesis (sources gap)

When the source PDF's bibliography is truncated and many
`missing-bib-entry:` warnings remain, synthesize canonical entries
for well-known cited works via Crossref:

```bash
python3 .virgil/scripts/library/synthesize_canonical_entries.py $ARGUMENTS \
    --max-entries 30
```

Synthesized entries are marked with a `% synthesized via Crossref on
<date>` comment so future passes / users can verify or replace them.

## Pre-flight (called from /library/authenticate-bib, not here)

Cross-field coherence + PDF cover-page check before authentication:

```bash
python3 .virgil/scripts/library/validate_bib_coherence.py $ARGUMENTS
```
