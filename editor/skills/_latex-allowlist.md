<!-- Canonical ALLOWABLE-LaTeX doctrine for every `.tex`-writing skill in
     BOTH silos (editor + library). "Allowable" means: renders MEANINGFULLY
     in Virgil, not as raw grey monospace. The vocabulary below is grounded
     in the renderer's own inline SSOT — `parseInlineContent`
     (`src/lib/latex-parser.ts`) plus the `KNOWN_CITE_COMMANDS` registry
     (`src/lib/cite-commands.ts`). Do not hand-extend it; extend the parser
     first, then this list.

     SSOT: this file is the single source of truth. A byte-identical copy
     lives at `library/skills/_latex-allowlist.md` so the editor and library
     bundles (separate on-disk folders) each carry a local copy for their
     skills' `[_latex-allowlist.md](_latex-allowlist.md)` links to resolve.
     The two copies are kept identical by a drift-guard test
     (`library/lib/__tests__/latex-allowlist-doctrine.test.ts`) — edit BOTH,
     or the test fails. A separate coherence check
     (`tools/check-coherence.mjs`, check #6 "allowlist") keeps the Command
     inventory below honest against the renderer SSOT; `/cleanup-virgil`
     runs it. Do not paraphrase this doctrine back into a skill; link to it.

     Not a slash command — the leading underscore filters it out of the
     command mirror in both build scripts. -->

## Allowable-LaTeX doctrine (load-bearing)

Every skill that composes or edits `.tex` — the citation/footnote/suggestion
family, the card writers, style-merge, the library extraction pipeline —
emits LaTeX into a document Virgil renders **without compiling**. Virgil
interprets a curated set of inline commands and renders them meaningfully;
**anything outside that set falls through to raw grey monospace** (the
`latexCommand` fallback). So the rule, stated **here once** and referenced,
never re-paraphrased:

**Write only commands Virgil renders. When a plain character will do, prefer
the plain character.** Concretely, the single most common slip:

- The LaTeX **tie / non-breaking space is `~`** (a literal tilde character).
  Write `ex.~14`, `Fig.~3`, `p.~75`, `Smith~(2008)` — a plain `~`, which is
  the correct LaTeX source for a keep-together space.
- **Never** write `\textasciitilde{}` to mean a tie. `\textasciitilde{}` is
  the escape for a *literal printed tilde glyph* (e.g. a URL or a math
  "approximately"); it is **not** a non-breaking space, and using it for one
  is the exact drift this doctrine exists to prevent.

> **Render note (`~`).** Since task 349 Virgil renders a bare `~` as the
> non-breaking space it MEANS (U+00A0), and re-emits that glyph as `~` — so
> the tie round-trips and reads correctly in the editor. (A bare U+00A0
> arriving by paste is likewise written back out as `~`.) Emitting
> `\textasciitilde{}` for a tie remains wrong: that is the escape for a
> literal printed tilde glyph.

The same principle governs the rest: use `--`/`---` for en/em dashes (not
`\textendash`/`\textemdash`), `` `` ``/`''` for curly quotes, and the accent
commands below for diacritics — all of which Virgil maps to real Unicode
glyphs.

## What Virgil renders

### Text styling (inline marks)

- `\textbf{…}` — bold.
- `\textit{…}`, `\emph{…}` — italic.
- `\underline{…}` — underline.
- `\texttt{…}` — monospace / code span (typographic transforms suppressed
  inside).
- `\verb|…|` — inline verbatim (any single non-letter delimiter).
- `\textcolor[HTML]{RRGGBB}{…}` — coloured text. Only the `[HTML]{RRGGBB}`
  form renders as a colour mark; named-colour `\textcolor{red}{…}` round-trips
  as plain text.

### Math

- `$…$` — inline math. `$$…$$` — display math. `\(…\)` / `\[…\]` — the
  same, LaTeX-native delimiters. Math content is preserved verbatim.

### Footnotes

- `\footnote{…}` — a footnote. Its body may itself contain the inline
  vocabulary here (marks, cites, refs, math).
- `\thanks{…}` — title-attached acknowledgement; threads through the
  footnote apparatus.

### Citations (natbib + biblatex)

Use a `\cite…` command from the registry below. All accept an optional
locator and comma-separated multi-key forms: `\cite[p.~75]{key}`,
`\citet[pp.~75--80]{key1,key2}`. The tie in `p.~75` / `pp.~75--80` is a
plain `~` (see the doctrine above), never `\textasciitilde{}`.

- **natbib:** `\cite`, `\citet`, `\citep`, `\citealt`, `\citealp`,
  `\citeauthor`, `\citeyear`, `\citeyearpar`, `\citetext`, `\citenum`.
- **biblatex (singular):** `\textcite`, `\parencite`, `\autocite`,
  `\footcite`, `\smartcite`, `\fullcite`, `\footfullcite`, `\citetitle`,
  `\citedate`, `\citeurl`, `\nocite`.
- **biblatex (multi-cite** `\cmd[pre][post]{k1}[pre][post]{k2}`**):**
  `\cites`, `\textcites`, `\parencites`, `\autocites`, `\footcites`,
  `\smartcites`.

**The document's FAMILY is not yours to choose; the VOICE is.** natbib and
biblatex are mutually exclusive, and each family's own commands are UNDEFINED
under the other — a `\citet` written into a biblatex paper is not a style
mismatch, it is "Undefined control sequence" and the paper stops compiling.
Virgil does not heal it (a preamble that hard-loads the other family raises a
save-time conflict warning; co-loading both is itself fatal).

So before you compose a cite command, ASK — never guess, never scan for
`\usepackage{biblatex}` yourself:

```bash
python3 editor/scripts/bib_family.py <docPath>
# → {"family":"natbib","source":"stored","textual":"citet","parenthetical":"citep"}
```

That door is the silo's ONE authority. Its ladder is the app's, in the app's
order: the **stored per-doc choice** (`virgil/citations.json` → `bibPackage`,
set by the user in the Citations panel) outranks everything; below it, the LIVE
preamble's `\usepackage`/`\RequirePackage` load (options, `\RequirePackage`,
comma-lists and wrapper packages like `biblatex-chicago` all count, and a
commented-out load does not); below that, the live cite-command usage; and
finally natbib, Virgil's baseline.

Within the family the door reports, pick the VOICE:

| voice | natbib | biblatex |
|---|---|---|
| textual — "Smith (2008) argues …" | `\citet{…}` | `\textcite{…}` |
| parenthetical — "… (Smith 2008)" | `\citep{…}` | `\parencite{…}` |

Bare `\cite{…}` is kernel-neutral and safe in either family, but it renders
whatever the loaded package makes of it — prefer the voice commands above.

*Scope.* This is the rule for a document Virgil is EDITING — someone else's
paper, whose family is a fact to be read. The **library** extraction pipeline
is the other case: it authors `main.tex` and its preamble from scratch
(`library/scripts/tex_emit.py`), loads no bib package, and normalizes every
extracted citation to natbib — so there the family is its own closed decision
and the door does not apply. `bib_family.py` ships in the editor bundle
(`.virgil/scripts/editor/bib_family.py` inside a synced paper folder).

### Cross-references

- `\ref{label}` — a reference to a `\label{…}`.
- `\getref{label}` / `\getfullref{label.sub}` — Virgil's resolved-reference
  commands.

### Text macros & symbols

- `\ldots` / `\dots` — an ellipsis (…).
- Escaped literals: `\&`, `\%`, `\$`, `\#`, `\_`, `\{`, `\}`, and
  `\textbackslash{}` (a literal `\`), `\textasciicircum{}` (a literal `^`),
  `\textasciitilde{}` (a literal `~` glyph — **not** a tie; see above).
- `\\` — a hard line break.

### Accents & special letters

LaTeX accent commands (`\'e`, `` \`a ``, `\"o`, `\^i`, `\~n`, `\c{c}`,
`\v{s}`, `\.z`, `\u{a}`, `\H{o}`, …) and special-letter commands (`\ss`,
`\o`, `\O`, `\ae`, `\AE`, `\aa`, `\AA`, `\l`, `\L`, `\oe`, `\OE`, …) render
as the composed Unicode glyph. Prefer them (or the literal Unicode
character) over any font/encoding hackery.

## Command inventory

The machine-checked canonical list. Every entry here is verified against the
renderer SSOT by `tools/check-coherence.mjs` (check #6): a command listed
here that the renderer does **not** handle is a hard error; a cite command
the parser gained but this list lost is a drift warning. (Accents /
special-letters are documented in prose above, not enumerated here — the
parser matches them by table, not by a fixed command name.)

```latex-allowlist
# inline marks & text
\textbf \textit \emph \underline \texttt \verb \textcolor
\footnote \thanks
\ref \getref \getfullref
\ldots \dots
\textbackslash \textasciitilde \textasciicircum
# citations (natbib)
\cite \citet \citep \citealt \citealp \citeauthor \citeyear \citeyearpar \citetext \citenum
# citations (biblatex singular)
\textcite \parencite \autocite \footcite \smartcite \fullcite \footfullcite \citetitle \citedate \citeurl \nocite
# citations (biblatex multi-cite)
\cites \textcites \parencites \autocites \footcites \smartcites
```

## What NOT to emit

- No `\textasciitilde{}` for a tie — use `~`.
- No `\LaTeX` / `\TeX`. A typeset LOGO is not literal text, so there is no
  character the document model can hold it as, and a reverse map would rewrite
  every prose occurrence of the word into a command. They are ordinary
  unmodelled zero-argument commands: the bytes survive (the raw-LaTeX carrier
  re-emits them byte-identically) but they render as grey monospace, so write
  the plain word. A card/citation *preview* may still display "LaTeX" — a
  projection is a view and never writes back — which is not licence to emit
  the command into a document.
- No commands outside the inventory above (they render as raw grey
  monospace). If you genuinely need one, that is a signal to extend the
  Virgil renderer + this list, not to smuggle the command into a document.
- No `\usepackage`/preamble commands in body prose — preamble requirements
  are injected separately (`latex-requirements.ts`).
