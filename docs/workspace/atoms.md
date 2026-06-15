<!-- last-verified: 12f0ef5 2026-06-15 -->
<!-- derives-from: docs/architecture/VIRGIL.md#ontology -->
<!-- covers-code: src/lib/tiptap/footnote.ts, src/lib/tiptap/citation.ts, src/lib/tiptap/math.ts, src/lib/tiptap/label.ts, src/lib/tiptap/linked-anchor.ts, src/lib/cite-commands.ts, src/lib/latex-parser.ts -->

# Atoms (inline elements) — operational manifest

> **When to load.** Any task that inserts, recognizes, or moves an inline
> element — a footnote marker, a citation, a cross-reference, inline math. For
> the *prose* of a footnote or the *fields* of a citation Card, you also need
> [cards.md](cards.md); for the id mechanics, [identity.md](identity.md).

Operational cut of the **Atom** primitive from
[VIRGIL.md → Ontology](../architecture/VIRGIL.md#ontology). An Atom is an inline
element *within* a TextObject — finer than a TextObject, not itself one. It is
**text-bound** (rule below) and usually one half of an **Atom link** to a Card.

## The inline Atom kinds

| Atom | LaTeX | Id marker | Linked Card | TipTap node/file |
|---|---|---|---|---|
| **footnote** | `\footnote{}` / `\thanks{}` | `\vfid` (before) | `footnote` Card in `footnotes.json` | `Footnote` (`footnote.ts`) |
| **citation** | the natbib/biblatex cite family | `\vcid` (before) | `citation` + `bib` Cards | `Citation` (`citation.ts`) |
| **labelRef** | `\ref{}` / `\getref{}` / `\getfullref{}` | — | none (resolves against a `\label{}`) | `LabelRef` (`label.ts`) |
| **inlineMath** | `$…$` | — | none | `InlineMath` (`math.ts`) |

## footnote

A footnote Atom is **two adjacent `.tex` tokens**: `\vfid{<4hex>}` immediately
before the authored `\footnote{...}` (or `\thanks{...}`, the title-page
acknowledgement variant, which threads the Footnotes panel but doesn't consume the
footnote counter). The Atom carries `footnoteId` ← `\vfid`. The trigger vocabulary
is the SSOT `FOOTNOTE_RE_FULL` in `src/lib/footnote-commands.ts` (the footnote
analog of `cite-commands.ts`), shared by the typed-`\footnote{}` input rule and the
action registry so both recognize the same pattern.

- **Card linkage:** the footnote *prose* is a Card in `footnotes.json` whose `id`
  **equals** the `\vfid` id — that equality *is* the link; there is no separate
  pointer field. Insert recipe (the house-style splice, id allocation, the
  `apply_response.py` write) is in [footnotes.md](footnotes.md).
- Inserting a footnote = splice `\vfid{<fresh-id>}\footnote{<body>}` into the
  paragraph **and** write the matching `footnotes.json` Card, atomically. Never do
  one without the other.

## citation

Citation Atoms cover the full natbib + biblatex vocabulary (SSOT:
`src/lib/cite-commands.ts`) — `\cite` `\citet` `\citep` `\citealt` … `\textcite`
`\parencite` `\autocite` … plus the biblatex multi-cite forms
(`\cites[..]{k1}[..]{k2}`) and capitalized sentence-start variants (`\Citet`, …).
The Atom carries `citationId` ← `\vcid` and the cite **key(s)**.

- **Card linkage:** a citation Atom ties to a `citation` Card (the in-text
  instance) and, through its key, to the `bib` Card (the bibliography entry in the
  `.bib` / `citations.json`). One bib key may be cited many times → many `\vcid`
  Atoms, one bib Card. Per-kind Card shapes are [cards.md](cards.md); adding
  a citation by description is the `/editor/find-citation` skill.

## labelRef

`\ref{}` / `\getref{}` / `\getfullref{}` parse to a `labelRef` node; the
`refCommand` attr records which command was used. Display text is computed by
`resolveRefs` against the matching `\label{}` (which is a **mark**, not an Atom —
see below). No Card, no id marker — a labelRef is a pure cross-reference.

## inlineMath

`$…$` → an `inlineMath` atom node, rendered by KaTeX. No Card, no id marker. (Its
block sibling `displayMath`, `\[…\]`, is a TextObject, not an Atom — see
[latex.md](latex.md) for the display-math source-form nuance.)

## Inline marks (not Atoms)

Marks decorate a *run of text* rather than being discrete inline objects. They are
not Atoms, but a skill editing inline content meets them:

- **`latexCommand`** — the opaque raw-LaTeX passthrough (grey monospace). Any
  inline `\command{…}` Virgil doesn't model is kept verbatim under this mark and
  serializes straight back. This is how arbitrary LaTeX round-trips; see
  [latex.md → opaque fallbacks](latex.md#the-two-opaque-fallbacks).
- **`textColor`** — `\textcolor[HTML]{RRGGBB}{}` (only the `[HTML]{6-hex}` form;
  named colors round-trip as plain text).
- **`label`** — `\label{}` carried as a mark (the target of a `labelRef`).
- **`linkedAnchor`** — the mark that backs a **linkedRange** TextObject; persists
  via `\vlid`/`\vlidend` ([identity.md](identity.md)) and links a Card to a text
  *span* (Mode B anchoring). Its Card-linkage rules are [anchoring.md](anchoring.md).

## Mobility and editing rules

1. **Atoms are text-bound.** They move with the surrounding characters. An atom
   is now drag-droppable (the `InlineAtomGrab` gesture; SSOT for the kinds is
   `src/lib/tiptap/atom-registry.ts`), but the drop only **relocates it in the
   text** — an atom **never pops into a Panel** as a free object the way Cards and
   TextObjects do ([ontology.md](ontology.md)).
2. **Insert the Atom and its Card together.** For footnotes/citations, the `.tex`
   marker and the sidecar Card are written in one atomic operation through
   `apply_response.py` ([structure.md](structure.md#the-write-path)). A marker
   without a Card (or vice versa) is an orphan.
3. **Deleting an Atom affects its Card.** Removing a `\footnote{}` from the text
   leaves its `footnotes.json` Card orphaned; cleanup is
   [gardening.md](gardening.md). The editor's anchor guards catch some cases, but a skill should
   handle the Card deliberately.
4. **Don't hand-write the id markers** (`\vfid` / `\vcid`) — compose the
   content command and let the create path allocate and place the marker
   ([identity.md → rules for skills](identity.md#rules-for-skills)).
