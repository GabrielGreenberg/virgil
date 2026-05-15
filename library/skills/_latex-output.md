<!-- LaTeX-output constraints for the deep-index subskill family.
     Transcluded by deep-index.md (and any subskill that needs to
     reference the allowed command vocabulary).
     Do not surface this file as a slash command — the build script
     filters leading-underscore files out of the command mirror. -->

## LaTeX output constraints

The output must be valid LaTeX that `parseLatex()` in Virgil can
handle. Stick to the vocabulary below; do not introduce commands
outside this list.

### Document structure

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

### Citations (natbib vocabulary)

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
