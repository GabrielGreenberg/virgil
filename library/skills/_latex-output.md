<!-- LaTeX-output constraints for the deep-index subskill family.
     Transcluded by deep-index.md (and any subskill that needs to
     reference the allowed command vocabulary).
     Do not surface this file as a slash command — the build script
     filters leading-underscore files out of the command mirror. -->

## LaTeX output constraints

The output must be valid LaTeX that `parseLatex()` in Virgil can
handle. Stick to the vocabulary below; do not introduce commands
outside this list.

> **Shared allowable-LaTeX doctrine.** The inline command vocabulary —
> text styling, math, footnotes, **citations**, cross-references, escapes,
> the tie `~` vs. `\textasciitilde{}` rule, accents — is the cross-silo
> SSOT in [_latex-allowlist.md](_latex-allowlist.md). Read it first; this
> file is the **library appendix** that adds only the extraction-specific
> vocabulary below (document structure, expex numbered examples, the
> font-strip rule, the minimal preamble, `\pgmark{N}`). Do not re-paraphrase
> the shared vocabulary here — link to it.

### Document structure

- `\documentclass{article}`, `\title`, `\author`, `\date`, `\maketitle`
- `\section`, `\subsection`, `\subsubsection`
- `\pgmark{N}` (preserved from extraction)
- `\begin{quote}…\end{quote}` for captions (italicize the body with
  `\textit{…}` per [_latex-allowlist.md](_latex-allowlist.md))
- `\begin{itemize}` ... `\end{itemize}` with `\item` entries (used for
  the bibliography section and any source-document lists)
- Plain text paragraphs

Inline styling (`\textbf`, `\textit`, `\emph`, `\texttt`, …), math
(`\[…\]`, `$…$`), footnotes (`\footnote{…}`), and `\thanks{…}` are all in
the shared allowlist. Two extraction-specific notes on the shared
commands:

- `\thanks{…}` — title-attached acknowledgements / affiliations.
  Canonical form: `\title{The Paper Title\thanks{Acknowledgement
  text}}`. Never re-attach as orphan-prefix body text or invent
  an `\acknowledgements` section. `audit_deepindex.py` uses a
  brace-balanced extractor so the nested `\thanks{…}` does not
  pollute the title-vs-catalog cross-check (cohenmscoherence memo).
- `\textbf{…}` / `\textit{…}` are the workhorses for bibliography entries
  (author names in bold, journal/book titles in italics).

### Citations

Use the natbib / biblatex `\cite…` vocabulary from
[_latex-allowlist.md](_latex-allowlist.md) (locator + multi-key forms
included). For extraction, the common picks are `\cite{key}` (parenthetical),
`\citet{key}` (textual — "Smith (2008) argues …"), `\citealt`/`\citealp`
(bare and parens-safe forms for footnote lists and `(e.g., …)` wrappers), and
`\citeauthor`/`\citeyear`/`\citeyearpar` for possessives and split
author/year references.

### Numbered examples (expex)

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

### Minimal preamble

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
