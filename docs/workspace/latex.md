<!-- last-verified: 7770419e 2026-08-13 -->
<!-- derives-from: docs/architecture/VIRGIL.md#latex-round-trip-vocabulary -->
<!-- covers-code: src/lib/latex-parser.ts, src/lib/latex-serializer.ts, src/lib/latex-typography.ts, src/lib/tiptap, src/lib/cite-commands.ts, src/lib/heading-types.ts, src/lib/bib-uid.ts -->

# LaTeX round-trip — operational manifest

> **When to load.** Any task that reads or writes the `.tex` body — modifying
> prose, inserting a construct, or judging what Virgil will do with a snippet.
> The id markers a skill must preserve are in [identity.md](identity.md); the
> inline Atoms in [atoms.md](atoms.md).

Operational cut of
[VIRGIL.md → LaTeX round-trip vocabulary](../architecture/VIRGIL.md#latex-round-trip-vocabulary).
This is the **honest** spec — what the parser actually accepts and the serializer
actually emits, not the wishful one.

## What Virgil does with LaTeX

Virgil **does not compile** LaTeX. `parseLatex()` (`src/lib/latex-parser.ts`)
reads `.tex` → editor model; `serializeToLatex()` (`src/lib/latex-serializer.ts`)
writes it back, **preserving the raw source**. The promise — *render meaningfully
while preserving the source* — holds for **arbitrary** LaTeX because anything
Virgil doesn't model passes through opaquely and byte-faithfully (below).

The parse pipeline: strip preamble → hoist `\title`/`\author`/`\date` → parse body
→ stamp `\vlid`/`\vlidend` ranges → numbering passes (footnotes, headings,
examples, figures) → resolve `\ref` display text → merge sidecar paragraph titles.

## Block constructs accepted

| Source | → node |
|---|---|
| `\part` `\chapter` `\section` `\subsection` `\subsubsection` `\paragraph` `\subparagraph` (+`*`) | `heading` (levels 0–6; SSOT `src/lib/heading-types.ts`) |
| `\title` `\author` `\date` (first of each) | `titleField` (round-trips via the **preamble**, not the body) |
| `\maketitle` | `maketitleMarker` |
| `\[ … \]` | `displayMath` (the **source** form — see below) |
| `\ex` / `\pex` … `\xe`, `\a`, `\xlist`, `\begingl…\endgl` | the expex family (`exampleBlock`, `exampleItem`, `exampleGloss`, …) |
| `\includegraphics[...]{...}` (standalone) | `graphicsBlock` |
| `\begin{verbatim}…\end{verbatim}` | `codeBlock` |
| `\begin{quote}…\end{quote}` | `blockquote` |
| `\begin{itemize}` / `\begin{enumerate}` | `bulletList` / `orderedList` |
| `\begin{figure}` / `\begin{figure*}` | `figureBlock` (+ `figureCaption`; non-caption body kept verbatim as `extras`) |
| `\hrulefill` | `horizontalRule` |
| `% …` comment | `latexComment` |
| **anything else** | `paragraph` (default) |

## Inline constructs accepted

| Source | → node / mark |
|---|---|
| `$ … $` | `inlineMath` (KaTeX) |
| `` `` `` / `''` | smart quotes “ / ” |
| `\textbf{}` | bold mark |
| `\emph{}` / `\textit{}` | italic mark (both) |
| `\underline{}` | underline mark |
| `\texttt{}` | code mark |
| `\textcolor[HTML]{RRGGBB}{}` | textColor mark (**only** the `[HTML]{6-hex}` form) |
| `\footnote{}` / `\thanks{}` | `footnote` atom (consumes a pending `\vfid`) |
| the natbib + biblatex cite family | `citation` atom (consumes a pending `\vcid`) |
| `\ref{}` / `\getref{}` / `\getfullref{}` | `labelRef` node |
| `\ldots` `\dots` `\LaTeX` `\TeX` | literal text (`…`, `LaTeX`, `TeX`) |
| accents / special letters (`\'e` `\`e` `\^o` `\"u` `\~n` `\v{s}` `\c{c}` `\=o` …; `\ss` `\o` `\ae` `\oe` `\i` `\j` …) and en/em dashes (`--`→–, `---`→—) | the composed Unicode glyph — **round-tripped bidirectionally** via the typography table (SSOT [src/lib/latex-typography.ts](../../src/lib/latex-typography.ts): `matchAccent` / `matchSpecialLetter` / `dashesToGlyphs` parse→glyph, `typographyToLatex` serialize→command). Skipped inside code/verbatim/math/`latexCommand` spans |
| `\&` `\%` `\$` `\#` `\_` `\{` `\}` `\textbackslash{}` `\textasciitilde{}` `\textasciicircum{}` | the literal character |
| `\\` | `hardBreak` |

## The two opaque fallbacks

The round-trip promise rests on two fallbacks that keep **any** valid LaTeX
byte-faithful even when Virgil doesn't model it:

1. **Unknown inline `\command`** → kept verbatim as text under the **`latexCommand`**
   mark (grey monospace). Consumes an optional `*`, optional `[...]` args, and up
   to two `{braced}` args, then serializes straight back to raw LaTeX.
2. **Unknown `\begin{env}…\end{env}`** → the **entire** environment kept verbatim
   as a single grey-monospace `latexCommand` paragraph. Only `verbatim`, `quote`,
   `itemize`, `enumerate`, `figure`, `figure*` are modeled; everything else
   (tables, `align`, `tikzpicture`, custom envs) takes this path.

**Operational consequence:** you can leave LaTeX Virgil doesn't model untouched
and trust it to round-trip. But text inside a grey `latexCommand` block is opaque
— Virgil won't structure it, so don't expect to anchor a Card mid-table.

## Serialization and escaping

- **Mark → command:** bold→`\textbf`, italic→`\emph`, underline→`\underline`,
  code→`\texttt`, textColor→`\textcolor[HTML]{HEX}{}`; `latexCommand`→raw
  passthrough; `linkedAnchor`→no command (wrapped by `\vlid`/`\vlidend`).
- **`escapeLatex` escapes** `& % # _ $` (when not already backslash-prefixed),
  `[`→`{[}` / `]`→`{]}`, `~`→`\textasciitilde{}`, `^`→`\textasciicircum{}`, and
  smart quotes. `$` is escaped (→`\$`) so a literal prose `$` isn't re-read as an
  inline-math delimiter (task 037); `[`/`]` are brace-wrapped so they can't begin
  a LaTeX optional arg (task 046, the `$`-twin). It **deliberately does not
  escape** `\ { }` — those stay live LaTeX syntax the editor preserves. So plain
  text a skill inserts as a Card body is escaped for those specials, but
  braces/backslashes you write are treated as real LaTeX.
  With `{ typography }` set it also runs `typographyToLatex` after char-escaping,
  reverse-mapping directly-typed glyphs (é, –, —, …) back to canonical LaTeX
  commands (the smart-quote precedent), suppressed inside code spans.
- **Preamble:** with none supplied, `CLASSIC_PREAMBLE` is the default;
  `ensurePreambleRequirements` (`src/lib/latex-requirements.ts`, the old
  `ensureVirgilCommands`) tops up the seven `\v*` no-op shims (`SHIM_COMMAND_NAMES`:
  `\vfid \vcid \vbid \vexid \vxid \vlid \vlidend`) + any body-detected packages
  led by `\usepackage{xcolor}` on every save
  ([identity.md → injected macros](identity.md#the-injected-macros)). `\vbid` is
  the lone macro that never appears in this `.tex` body — it marks a `.bib`
  entry's durable surrogate uid (a `\vbid{<uid>}` line before each block, minted
  + round-tripped by `serializeBibFile` / `src/lib/bib-uid.ts`); the preamble
  no-op is declared only so a paper opened in raw LaTeX never breaks.

## Display-math source form

The **on-disk** form of display math is `\[…\]` — the serializer emits it and the
block parser recognizes only it. `$$…$$` is the **editor-side** register (the
`displayMath` node's DOM form + its `$$` input rule); it is normalized to `\[…\]`
on save. So: a `.tex` on disk uses `\[…\]`; `$$…$$` appears only live in the
editor.

## Citation vocabulary

SSOT: `src/lib/cite-commands.ts` (`KNOWN_CITE_COMMANDS`, the closed list shared by
parser, bib parser, and the input rule):

- **natbib:** `cite citet citep citealt citealp citeauthor citeyear citeyearpar citetext citenum`
- **biblatex:** `textcite parencite autocite footcite smartcite fullcite footfullcite citetitle citedate citeurl nocite`
- **biblatex multi-cite** (accept `\cmds[pre][post]{k1}[..]{k2}`): `cites textcites parencites autocites footcites smartcites`

Each has a capitalized sentence-start variant; the alternation is longest-first
(`\footfullcite` beats `\footcite`). Optional `[locator]` and comma-separated
multi-key keys are accepted.

## Emitting LaTeX as a skill — the curated subset

`parseLatex()` accepts **more** than a skill should emit. The canonical
allowable-LaTeX doctrine every `.tex`-writing skill consults is
**`_latex-allowlist.md`**, shipped byte-identical in both silos
([editor/skills/_latex-allowlist.md](../../editor/skills/_latex-allowlist.md) /
[library/skills/_latex-allowlist.md](../../library/skills/_latex-allowlist.md)) and
grounded in the renderer's own inline SSOT (`parseInlineContent` +
`KNOWN_CITE_COMMANDS`, machine-checked by `check:coherence` check #6). It prescribes
the inline marks, math, footnotes, cross-refs, escapes, accents, and the full
`\cite…` vocabulary — e.g. the tie `~`, forbidding `\textasciitilde{}` for a
non-breaking space. The library `_latex-output.md` now folds its shared inline/cite
vocabulary into a link to the allowlist and stays the library appendix (structure,
expex, fonts, preamble, pgmark). Keep the asymmetry in mind: **read** expecting the
full vocabulary + opaque passthrough; **write** within the curated subset so the
output stays clean and portable.

## Rules for skills

1. **Preserve the raw source.** Don't normalize or reflow LaTeX you didn't change
   — `unescapeLatex` is a deliberate no-op, and the editor keeps text verbatim.
2. **Don't escape `\ { }`.** They're live syntax; the specials above (incl. `$`
   and `[`/`]`) are escaped for you.
3. **Emit `\[…\]`, not `$$…$$`,** for display math in a `.tex` you write.
4. **Stay in the curated output subset** when composing LaTeX; rely on the opaque
   fallbacks only for source you're passing through unchanged.
5. **Don't add packages or define macros mid-document** — preamble changes are the
   `/editor/style-merge` path, a catastrophic-op exception.
