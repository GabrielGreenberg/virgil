<!-- last-verified: 92e921fb 2026-08-22 -->
<!-- derives-from: docs/architecture/VIRGIL.md#latex-round-trip-vocabulary -->
<!-- covers-code: src/lib/latex-parser.ts, src/lib/latex-serializer.ts, src/lib/latex-lexer.ts, src/lib/latex-typography.ts, src/lib/footnote-content.ts, src/lib/tiptap, src/lib/cite-commands.ts, src/lib/heading-types.ts, src/lib/bib-uid.ts -->

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
| `\ex.` / `\pex.` … (blank-line terminated) | the SAME family, `dialect: "linguex"` (task 355 — see "own dialect" below) |
| `\includegraphics[...]{...}` (standalone) | `graphicsBlock` |
| `\begin{verbatim}…\end{verbatim}` | `codeBlock` |
| `\begin{quote}…\end{quote}` | `blockquote` |
| `\begin{itemize}` / `\begin{enumerate}` | `bulletList` / `orderedList` |
| `\begin{figure}` / `\begin{figure*}` | `figureBlock` (+ `figureCaption`; non-caption body kept verbatim as `extras`) |
| `\begin{forest}…\end{forest}` | `forestBlock` — claimed WHOLE (task 383): the env verbatim in `source`, so the drawn tree (task 384) is a derivation that can't subtract from it. Its leading `[` is the TREE, not an option. Since task 387 the serializer **trims the source's trailing whitespace before appending the `%!v:` anchor**, because `source` is a user-editable attr written verbatim by both pod doors: the renderer accepts `\s*` after the closer while the anchor reader accepts `[ \t]*`, so one press of Enter after `\end{forest}` put the anchor on its own line where `NODE_UUID_ANCHOR` cannot see it — the tree came back uuid-less, a fresh id was minted, and the stranded anchor became an empty paragraph carrying the old identity. Normalizing at the EMIT site rather than at the doors is what makes the append point and the detach point coincide by construction (task 348's rule). NON-whitespace after the closer is left alone: it makes the renderer REFUSE, and the badge names it |
| `\hrulefill` | `horizontalRule` |
| `% …` **full-line** comment | `latexComment` (a MID-line `%` is a comment *tail*, inline table below) |
| any other `\begin{env}…\end{env}` | carried **byte-literally** — see the fallbacks below |
| **anything else** | `paragraph` (default) |

## Inline constructs accepted

| Source | → node / mark |
|---|---|
| `$ … $`, `$$ … $$`, `\( … \)`, `\[ … \]` (mid-paragraph) | `inlineMath` (KaTeX). ONE scanner — `matchInlineMathAt` (`src/lib/latex-lexer.ts`) — shared by the main parser and the card/footnote fork; all four spellings normalize to `$ … $` inline (task 341) |
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
| `\\` (bare) | `hardBreak` |
| `\\*`, `\\[2pt]`, `\\*[1ex]` | carried on `latexCommand` — Virgil doesn't model break spacing, so the whole token + its argument run rides the carrier (`matchLineBreakAt`, task 349 M4) |
| `~` (tie) | **U+00A0** in the document, re-emitted as `~`. A tie is a `"glyph"` member of `CHAR_ESCAPE_TABLE`, so provenance lives as two distinct code points; a prose-typed ASCII `~` still emits `\textasciitilde{}` (task 349 M5) |
| a BARE `{ … }` group | braces carried on `latexCommand`, content stays editable prose (`matchBraceGroupAt`, task 349 M6). An escaped `\{` is still a literal brace |
| a mid-line `% …` tail | text under the **`latexCommentTail`** mark — *not typeset at all*, re-emitted verbatim (`matchCommentTailAt`, task 347). A comment line between two prose lines does NOT break the paragraph, because LaTeX doesn't break there |
| `\verb<d>…<d>` | text under the **`latexVerbatim`** mark (byte-literal — no typography, no escaping) |

## The opaque fallbacks

The round-trip promise rests on three carrier marks that keep **any** valid LaTeX
byte-faithful even when Virgil doesn't model it. `latexCommand` = "raw LaTeX the
editor doesn't model"; `latexVerbatim` = "these bytes are literal";
`latexCommentTail` = "not typeset at all".

1. **Unknown inline `\command`** → kept verbatim as text under the **`latexCommand`**
   mark (grey monospace), then serialized straight back. It carries **ALL** of its
   arguments: `matchCommandArgumentRun` (`src/lib/latex-lexer.ts`) consumes an
   optional `*` and then every abutting `{…}` / `[…]` group in **whatever order**
   — not a fixed "brackets then at most two braces" shape, which silently
   truncated `\definecolor{myblue}{rgb}{0.2,0.4,0.8}`, `\resizebox{3cm}{!}{…}`
   and `\newcommand{\x}[1]{…}` and stopped papers compiling (task 349 M1–M3).
   Since task 360 the mark is applied at TYPE time too, not only at parse time —
   the `latexCommandCarrier` plugin reads those same lexer doors over the
   transaction's own changed ranges, so LaTeX you type in the editor is carried
   in the same dispatch instead of sitting ambiguously in the prose buffer until
   the next save.
   Three bounds, all fail-closed: an unbalanced group ends the run, a group
   spanning a blank line is refused, and the count is capped at TeX's `#1`…`#9`.
   A `{[}` / `{]}` prose protection is not an argument and also ends the run.
2. **Unknown `\begin{env}…\end{env}`** → one paragraph carrying the **entire**
   environment **byte-literally** on `latexVerbatim` (env name + arguments
   included), and
   carrying the block's `%!v:` uuid so its identity survives the save (task 342).
   Only `verbatim`, `quote`, `itemize`, `enumerate`, `figure`, `figure*`, `forest`
   are modeled; everything else (tables, `align`, `tikzpicture`, `alltt`, the fancyvrb
   family, custom envs) takes this path. **Byte-literal is the DEFAULT**, so an
   env Virgil will fail to model in future is safe with nothing to add — the
   verbatim vocabulary (`VERBATIM_ENVS_FULL`) now decides only the *richer*
   treatments (the `codeBlock` node, first-close-wins end-finding, inertness to
   the package/label scanners), never whether the user's bytes are safe.
3. **A modeled branch that meets a body outside its model REFUSES and carries.**
   `\begin{itemize}` whose body holds no `\item` (an `\input{}`, a tuning-only
   body, items hidden inside a nested `verbatim`) is carried whole rather than
   reduced to one empty bullet (task 356).

**Operational consequence:** you can leave LaTeX Virgil doesn't model untouched
and trust it to round-trip. But text inside a grey `latexCommand` block is opaque
— Virgil won't structure it, so don't expect to anchor a Card mid-table.

**Nested constructs are skipped, not split** (task 338). One vocabulary —
`skipOpaqueConstructAt` in `src/lib/latex-lexer.ts` — answers "what is opaque to
this scan?" for every body splitter and every environment terminator: any
`\begin{env}`, the two expex pairs (`\begingl…\endgl`, `\xlist`), and an inline
`\verb` run, with `%` comments respected. So an `\item` at the head of a line
inside a nested environment, or a literal `\a` inside a `verbatim` body nested in
an example, no longer splits the enclosing construct.

**Unterminated ⇒ transparent, at every layer** (tasks 338 / 350 / 356). A
construct whose end nobody can find is not that construct: the parser puts its
cursor back on the opener and the bytes are carried as ordinary content. This
holds for `skipOpaqueConstructAt`, for `\ex`/`\begingl`, for the generic
`\begin{env}` dispatcher (which used to slurp to EOF — and the routine trigger
was *typing*, since the code pane re-parses a document whose tail is inside the
environment for the seconds before the close exists), and for a `%!vtex:begin`
with no matching `end`. A truncated opener degrades locally instead of eating
the rest of the file.

**An example is written back in its OWN dialect** (task 355). Linguistics papers
number examples with one of two mutually incompatible packages, and a real paper
loads both: expex closes explicitly (`\ex \label{s1} … \xe`), linguex terminates
at the blank line (`\ex.\label{s1} …`). So `exampleBlock` carries a per-example
`dialect` attr ([src/lib/example-dialect.ts](../../src/lib/example-dialect.ts))
and each example serializes back in the syntax it arrived in — converting on open
would rewrite every example in a co-authored file Virgil was only asked to READ,
and, since both packages define `\ex`, would need a `\usepackage{expex}` that
breaks the paper. The **FORM** decides which dialect (the period —
`matchExpexOpenerAt` / `matchLinguexOpenerAt`, neither consulting a preamble, so a
fragment or a paste still answers); the **PACKAGE** decides whether Virgil may
model a linguex site at all (asked once of the live preamble). `\exg.` / `\exi.` /
`\exr.`, a glossed part and a third nesting tier are REFUSED whole and fall to the
byte-literal carrier rather than half-parsed. One shared `assembleExampleBody`
behind two splitters keeps every consumer downstream dialect-blind; a NEW example
takes the document's dominant dialect (`dominantExampleDialect` — purely linguex
mints linguex, empty/expex/MIXED mints expex, since expex is injected from the
emit where linguex never is). The requirements fallback detector needed the same
period lookahead: without it a linguex `\ex.` declared expex and
`ensurePreambleRequirements` injected `\usepackage{expex}` after the user's own
`\usepackage{linguex}`, and every example in the paper stopped compiling.

## Serialization and escaping

- **Mark → command:** bold→`\textbf`, italic→`\emph`, underline→`\underline`,
  code→`\texttt`, textColor→`\textcolor[HTML]{HEX}{}`; `latexCommand`→raw
  passthrough; `linkedAnchor`→no command (wrapped by `\vlid`/`\vlidend`).
- **Escaping is ONE table read by both rungs on both surfaces** —
  `CHAR_ESCAPE_TABLE` in [src/lib/latex-typography.ts](../../src/lib/latex-typography.ts)
  (emit = `escapeLatexChars`, parse = `matchCharEscapeAt`; tasks 339/360). Three
  member kinds: `escape` (a LaTeX special that must be escaped to render at
  all), `protect` (legal but ambiguous, wrapped in its own brace group), and
  `glyph` (an ACTIVE character whose Unicode counterpart carries the provenance
  — today the `~` tie ↔ U+00A0).
  **Every member is written unconditionally** — `& % # _ $ ~ ^` and `{ } \ [ ]`
  alike. `$`→`\$` so a prose `$` isn't re-read as an inline-math delimiter
  (task 037); `[`→`{[}` rather than `\[`, which starts display math (task 046);
  `\`→`\textbackslash{}`.
  Task 339's evidence-keyed `emit: "prose-only"` narrowing (braces/brackets
  escaped only in a run with no backslash) and the field that declared it are
  **retired** by task 360, which made its premise true: a type-time carrier
  marks raw LaTeX the moment an edit writes it, and both inline parsers carry a
  control symbol (`\,` `\;` `\ `), so a bare `\` surviving in a text node is a
  LITERAL backslash and escaping it is what round-trips it. Net effect for a
  skill: a plain-prose Card body gets its braces and brackets escaped, and text
  you write as real LaTeX is carried on the `latexCommand` mark rather than
  left ambiguous in the prose buffer.
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
- **Detection believes only the bytes the compiler would.** Every scan that
  decides a requirement (or a bib family) runs over `projectDetectableLatex`
  (`src/lib/latex-lexer.ts`) first — comments and verbatim bodies projected away
  — so a commented-out `% \usepackage{biblatex}` or an `\includegraphics` inside
  a `\begin{verbatim}` no longer injects a package the document never runs
  (tasks 344 / 345). The declaration side reads the same vocabulary
  (`PACKAGE_DETECTORS`, `src/lib/latex-requirement-collector.ts`).

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

`matchCiteCommandAt` answers **vocabulary AND argument shape in one call**, and
both inline parsers (`latex-parser.ts` and the card/footnote fork
`footnote-content.ts`) call it — the multi-cite forms repeat `[pre][post]` before
*each* `{key}` group, which the fork's hand-written loop got wrong (task 341).

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
2. **A backslash in your run makes it "ambiguous LaTeX".** `& % # _ $ ~ ^` are
   always escaped for you; `{ } \ [ ]` are escaped only in a run with **no**
   backslash. So `\cmd[opt]{arg}` you write stays live syntax, but a
   pure-prose `{` will be escaped to `\{`.
3. **Emit `\[…\]`, not `$$…$$`,** for display math in a `.tex` you write.
4. **Stay in the curated output subset** when composing LaTeX; rely on the opaque
   fallbacks only for source you're passing through unchanged.
5. **Don't add packages or define macros mid-document** — preamble changes are the
   `/editor/style-merge` path, a catastrophic-op exception.
