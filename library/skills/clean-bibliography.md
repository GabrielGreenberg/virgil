---
description: Bibliography cleanup — References itemization, references.bib emission, inline citation rewriting (every style).
arguments: <citekey>
---

# Bibliography cleanup

> Shared doctrine: read [_doctrine.md](_doctrine.md). Even
> 1000+-entry book bibliographies and run-on indices are in-scope —
> deferring is almost always a doctrine violation.

Operates on `papers/$ARGUMENTS/main.tex` and
`papers/$ARGUMENTS/references.bib`. The canonical narrative is
[deep-index.md](deep-index.md) §3e/3f/3g; this stub documents the
script-invocation order and the style choices.

**Working directory.** Every `python3 .virgil/scripts/<name>.py …`
invocation below assumes pwd is `~/Virgil-Library/` (the library root
where `.virgil/scripts/`, `papers/`, and `master.bib` live). `cd` there
before invoking, or prepend each command with
`cd ~/Virgil-Library && …`.

## Step 3e — Itemize the References section

**Detect the style and itemize:**

```bash
python3 .virgil/scripts/format_references_section.py papers/$ARGUMENTS \
    --diagnostic   # print regex-coverage stats
```

The script auto-detects style from `chicago` / `apa` / `bracket-key`
/ `bracket-numeric` / `siggraph` / `author-year-paren`. The
shift-by-one bug (each `\item` containing the tail of the previous
entry plus the head of the next) was fixed in Phase 1.3 — every
anchor is now the START of its entry, not the END.

**Style flags** (when auto-detection picks the wrong one):

- `--style=siggraph` for all-caps author Chicago bibliographies
  (SIGGRAPH / Eurographics).
- `--style=author-year-paren` for humanities theses with `Author(s)
  (YYYY[a/b]) Title. Rest.` form.
- `--style=bracket-numeric` for CS-paper `[N]` bibliographies.
- `--same-author-mode` to merge year-only paragraph-starts (`^1998.
  Title…`) into the prior entry's author prefix.

**Fallback to year-anchor splitter** when the primary parser yields
implausibly few entries (the script's sanity-check aborts the write
in that case):

```bash
python3 .virgil/scripts/itemize_jammed_references.py papers/$ARGUMENTS
```

**Index itemization** (for books with a `\section{Index}` of
flattened-OCR entries):

```bash
python3 .virgil/scripts/clean_index_ocr.py papers/$ARGUMENTS/main.tex
```

## Step 3f — Emit / populate `references.bib`

When `/library/index-paper` only seeded `references.bib` with the
paper itself (so every body `Author Year` mention fires
`missing-bib-entry:`), populate from the itemized References section:

```bash
python3 .virgil/scripts/populate_references_bib_from_itemize.py papers/$ARGUMENTS
```

**Precondition (load-bearing).** This script blindly APPENDS — it does
NOT dedupe against existing bib entries. Running it on an
already-populated `references.bib` produces corrupt duplicate entries
(mangled author fields, `-2`-suffixed citekey collisions). Before
invoking, gate on entry count:

```bash
count=$(grep -c '^@' papers/$ARGUMENTS/references.bib)
# Only run if the bib is at seed state (≤ 1 entry — the paper itself).
[ "$count" -le 1 ] && python3 .virgil/scripts/populate_references_bib_from_itemize.py papers/$ARGUMENTS
```

Skip the populate step entirely when the bib is already populated
(e.g., on re-runs against a deep-indexed paper, or when `index-paper`
ingested a `.tex` source that came with its own `references.bib`).

When emitted citekeys collide on same-surname-same-year-same-titleword
patterns (kehler-style author-heavy bibliographies):

```bash
python3 .virgil/scripts/fuzzy_citekey_disambiguate.py papers/$ARGUMENTS
```

The disambiguator uses title second-word / journal-initials /
publisher-initials before falling back to year-letter suffixes;
rewrites every `\cite{}`-family call in `main.tex` accordingly.

## Step 3g — Rewrite inline citations

```bash
python3 .virgil/scripts/rewrite_citations.py \
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

**Triaging unresolved mentions.** When the script prints
`Unresolved (N unique): …`, classify each:

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
python3 .virgil/scripts/synthesize_canonical_entries.py $ARGUMENTS \
    --max-entries 30
```

Synthesized entries are marked with a `% synthesized via Crossref on
<date>` comment so future passes / users can verify or replace them.

## Pre-flight (called from /library/authenticate-bib, not here)

Cross-field coherence + PDF cover-page check before authentication:

```bash
python3 .virgil/scripts/validate_bib_coherence.py $ARGUMENTS
```
