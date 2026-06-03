<!-- last-verified: c315113 2026-06-02 -->
<!-- derives-from: docs/architecture/VIRGIL.md#uuid-marker-emission, docs/architecture/VIRGIL.md#latex-round-trip-vocabulary, docs/architecture/VIRGIL.md#reserved-name-inventory, docs/architecture/VIRGIL.md#cowork-pattern -->
<!-- covers-code: src/lib/latex-parser.ts, src/lib/latex-serializer.ts, src/lib/uuid.ts, src/lib/latex-paragraph-map.ts, src/lib/cite-commands.ts, src/lib/heading-types.ts, src/lib/document-styles.ts, src/lib/tiptap, src/text-objects/text-object-registry.ts, src/text-objects/types.ts, src/lib/storage-fsa.ts, src/app/globals.css, src/lib/collab.ts, src/lib/ai-request-bridge.ts, src/hooks/useDocNotificationStream.ts, editor/scripts/apply_response.py, editor/scripts/list_requests.py -->

# Phase 0 — current-state report (stable subsystems)

> **Status: Phase 0 archaeology seed (stable subsystems).** Exhaustive current-state extraction that seeds the future operational manifest (Phase 2) + UX library (Phase 3); the conceptual summary lives in [VIRGIL.md](VIRGIL.md). Retired once the manifest absorbs it.

This is the field-level half of Phase 0, at the **exhaustive altitude** described in [VIRGIL.md → Document discipline → Conceptual doc vs. operational manifest](VIRGIL.md#conceptual-doc-vs-operational-manifest--the-scope-boundary). The readable conceptual account lives in VIRGIL.md's three now-filled stable sections ([UUID marker emission](VIRGIL.md#uuid-marker-emission), [LaTeX round-trip vocabulary](VIRGIL.md#latex-round-trip-vocabulary), [Reserved-name inventory](VIRGIL.md#reserved-name-inventory)); this report is the granular substrate they forward-point to, so the archaeology is **done once here, not re-walked** by the manifest or the UX library.

Each section names the future manifest doc it seeds (the mapping is fixed by VIRGIL.md's stubs and the brainstorm §19 subtask table).

## Scope — and what is deliberately deferred

This report covers the **stable** subsystems only. At the time of writing a card-system refactor was in flight that would churn the card / panel / sidecar / public-type surface, so extracting those here would have extracted a moving target. The refactor has **since landed** (Quotations → Reports), and the three card-layer slices below are now extracted in the sibling report **[phase0-card-current-state.md](phase0-card-current-state.md)**:

- **Card-kind taxonomy** — the `CardKind` union, per-kind anchor/atom-link/lifecycle/theme. → now in [phase0-card-current-state.md §1](phase0-card-current-state.md#1-card-kind-taxonomy).
- **Public-type registry** — the exported types in `src/lib/types.ts`. → now in [phase0-card-current-state.md §2](phase0-card-current-state.md#2-public-type-registry).
- **Sidecar & panel inventory** — per-sidecar purpose and the `PANEL_REGISTRY` panel surface. → now in [phase0-card-current-state.md §3](phase0-card-current-state.md#3-sidecar--panel-inventory).

Still deferred (separate domains, later chips):

- **User-actions surface** — keyboard shortcuts, toolbar buttons, drag/drop affordances, context menus (card-coupled).
- **Existing-skill behavior audit** — what each editor skill *actually does* vs. its prompt (covered partially for the cowork plumbing below, but the per-skill audit is deferred).

Where this report touches sidecar JSON keys, the **infrastructure** sidecars (`virgil.json`, `editor-state.json`, `ai-requests.json`, `notifications.json`, `collab.json`, `doc-settings.json`, the figures cache) are treated as stable; the **card** sidecars were marked **provisional** here and are now **certified** in [phase0-card-current-state.md §3.1](phase0-card-current-state.md#31-the-virgil-sidecar-inventory) (post-refactor: `quotations.json` → `reports.json`).

---

## 1. UUID + marker semantics
*Seeds the manifest's `identity.md`.*

### 1.1 The two id namespaces (SSOT: `src/lib/uuid.ts`)

Virgil has exactly two id flavors, both minted in [src/lib/uuid.ts](../../src/lib/uuid.ts):

| Flavor | Generator | Format | Used for |
|---|---|---|---|
| **Short id** | `generateShortId(existing?)` | 4-char hex (`[0-9a-f]{4}`, ~65 K space, optional collision-avoidance retry against an `existing` set) | Every id that appears **in the `.tex` source**: the `%!v:` block anchors and the `\v*id{}` markers. |
| **Entity id** | `generateEntityId()` | full v4 UUID (`crypto.randomUUID()`) | Sidecar-only entities that **never** appear in `.tex` (notes, todos, comments, archive, revisions, links, AI requests). |

Short ids are compact and human-readable in the raw source; the 4-hex space is small enough that collisions appear in modest docs, so every emit site passes the set of existing same-kind ids as the avoidance set, and the serializer's `assignUuids` runs a dedup pass (see §1.4).

### 1.2 The full marker family (SSOT: `TEXT_OBJECT_REGISTRY.sourceMarker` + `text-objects/types.ts`)

The conceptual single source for "which TextObject kind carries which source marker" is the `sourceMarker` field on each entry of `TEXT_OBJECT_REGISTRY` ([src/text-objects/text-object-registry.ts](../../src/text-objects/text-object-registry.ts)), documented by the `sourceMarker?: { command; idLength: 4 }` field doc in [src/text-objects/types.ts](../../src/text-objects/types.ts) (~lines 340-355). The complete family as shipped:

| Marker | Identifies | Kind | Auto / authored | Emit point (serializer) | Parse point (parser) |
|---|---|---|---|---|---|
| `%!v:<4hex>` | a **TextObject** (block) — paragraph, heading, list, listItem, blockquote, codeBlock, displayMath, latexComment, titleField, maketitleMarker, figureBlock, graphicsBlock | trailing line-end **comment** anchor (not a macro) | Virgil-auto | `serializeNode` appends ` %!v:${uuid}` to every uuid-bearing block (`latex-serializer.ts` ~154-398) | `NODE_UUID_ANCHOR` consumed after each block; `stripUuidAnchor` strips trailing anchors from paragraph text (`latex-parser.ts` ~1184, 1672, 1684) |
| `%!v:blank` | an empty, unidentified paragraph | sentinel comment | Virgil-auto | empty paragraph with no uuid → `%!v:blank\n` (`latex-serializer.ts` ~213) | → empty `paragraph` node (`latex-parser.ts` ~1598) |
| `\vfid{<4hex>}` | a **footnote** Atom | inline no-op macro | Virgil-auto | emitted immediately before `\footnote{}` / `\thanks{}` (`latex-serializer.ts` ~391, 648) | stashes `pendingFootnoteId` for the next `\footnote`/`\thanks` (`latex-parser.ts` ~341) |
| `\vcid{<4hex>}` | a **citation** Atom | inline no-op macro | Virgil-auto | emitted before the cite command (`latex-serializer.ts` ~404, 654) | stashes `pendingCitationId` for the next cite command (`latex-parser.ts` ~352) |
| `\vexid{<4hex>}` | an **exampleBlock** (`\ex`/`\pex`) | block no-op macro | Virgil-auto | emitted before `\ex`/`\pex` (`latex-serializer.ts` ~483) | stashes `ctx.pendingExampleId` (`latex-parser.ts` ~1287) |
| `\vxid{<4hex>}` | an **exampleItem** (`\a` row) | block no-op macro | Virgil-auto | emitted before `\a` (`latex-serializer.ts` ~524) | consumed by `splitPexBody`; a stray `\vxid` at `parseBody` scope is discarded so it doesn't accrete (`latex-parser.ts` ~1305) |
| `\vlid{<4hex>}` … `\vlidend{<4hex>}` | a **linkedRange** (the `linkedAnchor` mark's range) | paired inline no-op macros | Virgil-auto | `serializeInlineSequence` opens `\vlid{id}` when a `linkedAnchor` mark starts and closes `\vlidend{id}` when it ends; ranges still open at a block boundary are closed and reopened (`latex-serializer.ts` ~603-637) | the inline parser emits transient `_linkedAnchorBoundary` sentinels; the post-pass `applyLinkedAnchorBoundaries` walks the assembled doc and stamps `linkedAnchor` marks over each open range, then removes the sentinels (`latex-parser.ts` ~367-392, 821-881) |
| `%!vtex:begin <id>` … `%!vtex:end <id>` | a **texBlock** (raw-LaTeX passthrough) | block comment sentinels | Virgil-auto (wraps user-authored raw LaTeX) | `latex-serializer.ts` ~260-269; a literal `%!vtex:end` inside the body is escaped to `%!v tex:end` so a pasted snippet can't terminate the block early | `latex-parser.ts` ~1553-1591; the body is slurped **verbatim** (no recursive parse) and the escape is reversed |
| `% AI request (<kind>): <text>` | an **aiRequestMarker** placeholder | LaTeX comment (ephemeral; carries no stable id) | Virgil-auto | `latex-serializer.ts` ~430-436, 660-671 | (round-trips as a comment) |

**Auto-managed vs. authored — the honest rule:** *every* marker above is Virgil-managed. The user authors the underlying content commands (`\footnote{}`, `\citep{}`, `\section{}`, `\ex…\xe`, etc.); Virgil owns and injects the id markers and strips them from the rendered display. A user never types or sees a `\vfid` / `%!v:` / `\vlid`. The only thing the user "authors" inside a marker is the **raw LaTeX body** between `%!vtex:begin`/`%!vtex:end` (the texBlock), and even there the sentinels themselves are Virgil's.

### 1.3 The `linkedRange` story — superseded model

The earlier model (still reflected in VIRGIL.md's Ontology bullet before this chip) was: *"linkedRange uses the `linkedAnchor` mark's `anchorId` instead of a source marker."* As of **Phase E** that is only half true. The linkedRange's **identity** is still the `linkedAnchor` mark's `anchorId` ([src/lib/tiptap/linked-anchor.ts](../../src/lib/tiptap/linked-anchor.ts) — `LinkedAnchor` mark, attrs `anchorId` / `kind` (default `"note"`) / `linkId` / `tintColor`), but the range is now **also persisted to the `.tex`** as paired `\vlid{id}…\vlidend{id}` markers (registry entry `text-object-registry.ts` ~831, `sourceMarker: { command: "vlid", idLength: 4 }`). The `textRange.textSnapshot` on the card link remains the recovery path (`reanchorByText`) when the mark vanishes. VIRGIL.md has been corrected in this chip; see §7.

### 1.4 `assignUuids` — the assignment SSOT (`latex-serializer.ts` ~798-936)

`assignUuids(doc)` is the single pass that mints missing block ids before serialization. Rules:

- **Container nodes** (`bulletList` / `orderedList` / `blockquote`) get **one** uuid; their inner paragraphs are stripped of uuids (the container or its `listItem` owns the anchor identity).
- **`listItem`s** get a per-item uuid (so an anchor/marginalia can pin a single line).
- **Headings, titleFields** always get a uuid; **non-empty paragraphs** (outside a container) get one.
- **Atom blocks** (`displayMath`, `latexComment`, `codeBlock`, `exampleBlock`, `figureBlock`, `graphicsBlock`) always get one.
- A first **dedup pass** clears duplicate uuids (e.g. from a bad recovery) so the second pass re-mints unique ones.
- Inline `citationId` / `footnoteId` are deduped in **separate id namespaces** (`dedupInlineId`) because React keys are namespaced `citation:` / `footnote:`.

The serializer keeps a local `UUID_BEARING_NODE_TYPES` set (mirroring the `textObject` schema group) since it operates on `JSONContent` without the live schema — **adding a kind to the schema group requires adding it here too** (`latex-serializer.ts` ~15-31).

Companion functions in the serializer: `extractSidecarData` (titles + content fingerprints keyed by uuid → `virgil.json`) and `recoverOrphanedUuids` (re-attaches a sidecar uuid to a node whose marker was lost, by **unique** content fingerprint match — ambiguous matches are skipped).

`src/lib/latex-paragraph-map.ts` maps `.tex` line numbers ↔ paragraph uuids (for code-editor scroll-to-paragraph and error-line → margin-marker mapping), re-deriving ranges from the `%!v:<hex>` markers.

---

## 2. LaTeX round-trip vocabulary
*Seeds the manifest's `latex.md`.*

Virgil **does not compile** LaTeX. `parseLatex()` ([src/lib/latex-parser.ts](../../src/lib/latex-parser.ts)) reads `.tex` → `JSONContent`; `serializeToLatex()` ([src/lib/latex-serializer.ts](../../src/lib/latex-serializer.ts)) writes `JSONContent` → `.tex`, preserving the raw source. This is the **honest** spec of what the parser accepts and the serializer emits — not the wishful one.

### 2.1 The pipeline (`parseLatex`, parser ~663-732)

`stripPreamble` (everything between `\begin{document}` and `\end{document}`) → hoist `\title`/`\author`/`\date` from the preamble into the doc tree → `parseBody` → `applyLinkedAnchorBoundaries` (stamp `\vlid`/`\vlidend` ranges) → `hoistTitleFieldsToTop` → numbering passes (`numberFootnotes`, `numberHeadings`, `numberExamples`, `numberFigures`) → `resolveRefs` (`\ref`/`\getref`/`\getfullref` display text) → `mergeSidecarTitles` (paragraph titles by uuid).

### 2.2 Block constructs accepted (`parseBody`, parser ~1148-1680)

| Source | → node | Notes |
|---|---|---|
| `\part` `\chapter` `\section` `\subsection` `\subsubsection` `\paragraph` `\subparagraph` (+ `*`) | `heading` (levels 0-6) | optional trailing `\label{}`, then optional `%!v:`. Level/command table is the SSOT in [src/lib/heading-types.ts](../../src/lib/heading-types.ts). |
| `\title` `\author` `\date` (first occurrence each) | `titleField` | font-size/face prefix commands (`\rmfamily`, `\Large`, `\bfseries`, …) split into `rawPrefix`; `\today` → `isToday`. Always round-trip via the **preamble**, not the body. |
| `\maketitle` | `maketitleMarker` | |
| `\[ … \]` | `displayMath` | **the source form of display math** (see 2.5). |
| `\ex` / `\pex` … `\xe` | `exampleBlock` | expex; optional `[exno=N]`, `<tag>`, `\label{}`, `~` space-suppress. |
| `\begingl` … `\endgl` | `exampleGloss` | aligned tiers `\gla`/`\glb`/`\glc` and prose tiers `\glft`/`\glpreamble`, cells `//`-delimited. |
| `\a` (inside `\pex`/`\xlist`) | `exampleItem` | nested `\begin{xlist}…\end{xlist}` → recursive `exampleItemList`. |
| `\includegraphics[...]{...}` (standalone) | `graphicsBlock` | bare, outside a `figure` env. |
| `\begin{verbatim}…\end{verbatim}` | `codeBlock` | |
| `\begin{quote}…\end{quote}` | `blockquote` | recursive `parseBody` on the body. |
| `\begin{itemize}…\end{itemize}` | `bulletList` | optional `listPreamble`; `\item`s split respecting nesting. |
| `\begin{enumerate}…\end{enumerate}` | `orderedList` | |
| `\begin{figure}` / `\begin{figure*}` `…\end{figure}` | `figureBlock` (+ `figureCaption` child) | `\caption{}`/`\label{}` extracted; everything else in the env body kept verbatim as `extras` (the round-trip source of truth). |
| `\hrulefill` | `horizontalRule` | |
| `\partitle{…}` | (legacy) attaches a title to the following paragraph | migration only; serializer no longer emits it. |
| `% …` comment | `latexComment` | trailing `%!v:` stripped into the node uuid. |
| (anything else) | **paragraph** | default; see 2.4. |

**`%!v:` and `%!vtex:` comment handling** is part of `parseBody`'s `%`-branch (parser ~1551-1635): `%!vtex:begin/end` → `texBlock` (verbatim), `%!v:blank` / standalone `%!v:<uuid>` → empty paragraph, trailing `%!v:` → silently consumed, any other `%` → `latexComment`.

### 2.3 Inline constructs accepted (`parseInlineContent`, parser ~175-641)

| Source | → node / mark | Notes |
|---|---|---|
| `$ … $` | `inlineMath` (atom) | rendered via KaTeX. |
| `` `` `` / `''` | smart quotes “ / ” | lone `` ` `` / `'` pass through. |
| `\textbf{}` | **bold** mark | |
| `\emph{}` / `\textit{}` | **italic** mark | both map to italic. |
| `\underline{}` | **underline** mark | |
| `\texttt{}` | **code** mark | |
| `\textcolor[HTML]{RRGGBB}{}` | **textColor** mark | **only** the `[HTML]{6-hex}` form; named-color `\textcolor{red}{}` round-trips as plain text (no mark). |
| `\footnote{}` | `footnote` atom | consumes a pending `\vfid`. |
| `\thanks{}` | `footnote` atom (`thanks: true`) | title-page acknowledgement; threads through the Footnotes panel, does not consume the footnote counter. |
| natbib + biblatex cite commands | `citation` atom | the full vocabulary is the SSOT in [src/lib/cite-commands.ts](../../src/lib/cite-commands.ts) (see 2.6); consumes a pending `\vcid`; single-key `\cmd[pre][post]{keys}` and multi-cite `\cmds[..]{k1}[..]{k2}` forms. |
| `\ref{}` / `\getref{}` / `\getfullref{}` | `labelRef` node | `refCommand` attr selects the command. |
| `\ldots` `\dots` `\LaTeX` `\TeX` | literal text (`…`, `LaTeX`, `TeX`) | |
| `\&` `\%` `\$` `\#` `\_` `\{` `\}` `\textbackslash{}` `\textasciitilde{}` `\textasciicircum{}` | the literal character | |
| `\\` | `hardBreak` | |
| `\vfid{}` `\vcid{}` `\vlid{}` `\vlidend{}` | (consumed as id markers; see §1) | |

### 2.4 What is passed through opaquely (the two fallbacks)

Virgil's "renders meaningfully while preserving the source" promise rests on two opaque fallbacks that keep **any** valid LaTeX round-tripping byte-faithfully even when Virgil doesn't model it:

1. **Unknown inline `\command`** (parser ~588-627) → kept verbatim as text carrying the **`latexCommand`** mark (rendered grey-monospace). Consumes an optional `*`, optional `[...]` args, and up to two `{braced}` args. The `latexCommand` mark serializes straight back to raw LaTeX (`serializeMarks`, serializer ~96-102).
2. **Unknown `\begin{env}…\end{env}`** (parser ~1535-1546) → the **entire** environment is kept verbatim as a single grey-monospace `paragraph` with the `latexCommand` mark. Only `verbatim`, `quote`, `itemize`, `enumerate`, `figure`, `figure*` are modeled; everything else (tables, `align`, `tikzpicture`, custom envs, …) takes this path.

`extractBraced` does balanced-brace extraction respecting `\{`/`\}`; `unescapeLatex` is a deliberate **no-op** (text passes through verbatim — the editor preserves raw LaTeX rather than normalizing it).

### 2.5 Serialization rules (`serializeToLatex` + `escapeLatex`)

- **Mark → command:** bold→`\textbf`, italic→`\emph`, underline→`\underline`, code→`\texttt`, textColor→`\textcolor[HTML]{HEX}{}`; `latexCommand` mark → raw passthrough; `linkedAnchor` mark → no command (wrapped by `\vlid`/`\vlidend` outside the inline run).
- **`escapeLatex`** (serializer ~133-148) escapes only `& % # _` (when not already backslash-prefixed), `~`→`\textasciitilde{}`, `^`→`\textasciicircum{}`, and smart quotes. It **deliberately does not** escape `\`, `{`, `}`, `$` — those are live LaTeX syntax the editor preserves.
- **Preamble:** if no preamble is supplied, `CLASSIC_PREAMBLE` is the default. `ensureVirgilCommands` tops up the six `\providecommand` no-ops + `\usepackage{xcolor}` (see §5.1); title fields are re-injected just before `\begin{document}`.

### 2.6 Display-math nuance — `\[…\]` vs `$$…$$`

The **source** round-trip form of display math is `\[…\]`: the serializer emits `\[…\]` (serializer ~386) and the block parser recognizes only `\[…\]` (parser ~1264). `$$…$$` is **not** a parsed source form — it is the **editor-side** representation: the `displayMath` node's `renderHTML` emits `$$…$$` to the DOM, and its input rule turns typed `$$` into a block ([src/lib/tiptap/math.ts](../../src/lib/tiptap/math.ts) ~179, 200-224). So a `.tex` on disk uses `\[…\]`; `$$…$$` only appears live in the editor and is normalized to `\[…\]` on save. (The agent doc `docs/agents/main-text.md` lists displayMath's LaTeX as "`$$…$$` and `\[…\]`", conflating the two registers — a minor imprecision noted in §7, not corrected here since this chip does not re-stamp the agent docs.)

### 2.7 Citation vocabulary (SSOT: `src/lib/cite-commands.ts`)

`KNOWN_CITE_COMMANDS` is the closed list, shared by the parser, the bib parser, and the TipTap input rule:

- **natbib:** `cite citet citep citealt citealp citeauthor citeyear citeyearpar citetext citenum`
- **biblatex:** `textcite parencite autocite footcite smartcite fullcite footfullcite citetitle citedate citeurl nocite`
- **biblatex multi-cite** (the `MULTI_CITE_NAMES` set, accept the `\cmds[pre][post]{k1}[pre][post]{k2}` form): `cites textcites parencites autocites footcites smartcites`

Each also has a capitalized sentence-start variant (`\Citet`, `\Parencite`, …); the alternation is built longest-first so `\footfullcite` beats `\footcite` and `\citeyearpar` beats `\citeyear`. Optional `[locator]` and comma-separated multi-key keys are accepted.

### 2.8 Cross-check against `library/skills/_latex-output.md`

The library deep-index skills are told to emit a **curated subset** of the above (document structure, the seven core `\cite…` forms, expex examples, a minimal preamble with `\providecommand{\pgmark}[1]{}` + `\providecommand{\vexid}[1]{}`). That file is a *constraint on skill output*, not the parser's full capability — `parseLatex()` accepts strictly more (e.g. all biblatex forms, `\textcolor[HTML]`, arbitrary opaque commands/environments). When updating either, keep this asymmetry in mind: the skill subset is intentionally narrower than the round-trip vocabulary.

---

## 3. TipTap extension inventory
*Seeds the manifest's `atoms.md`. Report-only — no dedicated VIRGIL.md stub; referenced from [UUID marker emission](VIRGIL.md#uuid-marker-emission).*

Barrel: [src/lib/tiptap/index.ts](../../src/lib/tiptap/index.ts) (re-exported from `src/lib/tiptap-extensions.ts`). Every custom extension, what it is, and the marker/atom it owns. (The agent doc [docs/agents/main-text.md](../agents/main-text.md) carries a prose table verified at `e86a264`; this is the marker-anchored cut, current at `c315113`.)

### 3.1 Block nodes (members of the `textObject` schema group)

The `textObject` schema group is the single answer to "is this graspable?" Members (per `main-text.md` + the serializer's `UUID_BEARING_NODE_TYPES`): `paragraph`, `heading`, `bulletList`, `orderedList`, `listItem`, `blockquote`, `codeBlock`, `displayMath`, `titleField`, `latexComment`, `texBlock`, `figureBlock`, `graphicsBlock`, `exampleBlock`, `exampleItem`. `linkedRange` is a TextObject too but lives outside the group (it's a mark range, not a node).

| Extension (file) | Kind | LaTeX / marker owned |
|---|---|---|
| StarterKit paragraph / heading / lists / blockquote / codeBlock | nodes | plain / `\part…\subparagraph` / `itemize`,`enumerate` / `quote` / `verbatim` |
| `DisplayMath` (`math.ts`) | atom block node | `\[…\]` source / `$$…$$` editor form |
| `TexBlock` (`tex-block.ts`) | atom block node (`selectable:false`) | `%!vtex:begin/end <uuid>` raw passthrough; exports `insertTexBlock`, `collectTexBlockUuids`, `freshTexBlockAttrs` |
| `FigureBlock` + `FigureCaption` (`figure-block.ts`, `figure-caption.tsx`) | block node + `inline*` child | `\begin{figure}…\caption…\label…\end{figure}`; structured `extras`/`source[]`/`widthPercent`/`label` |
| `GraphicsBlock` (`graphics-block.ts`) | atom block node | bare `\includegraphics` |
| `TitleField` + `MaketitleMarker` + `EmptyParagraphTitleCleaner` (`title.ts`) | nodes | `\title`/`\author`/`\date` (preamble) / `\maketitle` |
| `ExampleBlock`, `ExampleItemList`, `ExampleItem`, `ExampleGloss`, `AlignedGlossRow`, `ProseGlossRow`, `GlossCell` + `ExpexNumbering` plugin (`expex.ts`) | nodes + plugin | expex `\ex`/`\pex`/`\a`/`\xlist`/`\begingl…\endgl`/`\gla`…; owns `\vexid` (block) + `\vxid` (item) markers |
| `LatexComment` (`latex-comment.ts`) | node | `% …` |
| `AiRequestMarker` (`ai-request.ts`) | invisible inline node | `% AI request (kind): text` |
| `PgMarkChip` (`pgmark.ts`) | decoration plugin | `\pgmark[level]{N}` printed-page chips (library-indexed papers; harmless without) |

### 3.2 Inline atoms

| Extension | LaTeX / marker |
|---|---|
| `Footnote` (`footnote.ts`) | `\footnote{}` / `\thanks{}`; carries `footnoteId` (← `\vfid`) |
| `Citation` (`citation.ts`) | the cite-command family; carries `citationId` (← `\vcid`); exports `consumePendingCitationCreate`, `markPendingCitationCreate` |
| `InlineMath` (`math.ts`) | `$…$` |
| `LabelRef` + `LabelHandler` (`label.ts`) | `\ref{}` / `\getref{}` / `\getfullref{}` (node) and `\label{}` (the `label` mark) |

### 3.3 Marks

| Extension | LaTeX |
|---|---|
| `LatexCommandMark` (`latex-command.ts`) | the opaque raw-LaTeX passthrough mark (grey monospace) |
| `LinkedAnchor` (`linked-anchor.ts`) | the linkedRange mark; attrs `anchorId` / `kind` (default `note`) / `linkId` / `tintColor` (renders `data-tint-color`, the Highlight swatch). Round-trips via `\vlid`/`\vlidend` |
| `TextColor` (`text-color.ts`) | `\textcolor[HTML]{RRGGBB}{}` |
| `label` (in `label.ts`) | `\label{}` as a mark |
| StarterKit | bold / italic / underline / code |

### 3.4 Behavioral plugins / guards

| Extension | Role |
|---|---|
| `SlashPopupExtension` (`slash-popup.ts`) | `\`-triggered command popup over `VIRGIL_COMMANDS` (declared in `commands.ts`; barrel exports `VIRGIL_COMMANDS`, `VIRGIL_COMMAND_NAMES`, `COMMAND_MAP`) |
| `SmartQuotes` (`smart-quotes.ts`) | straight→curly quotes on input |
| `TabIndent` (`tab-indent.ts`) | Tab→indent in prose fields (priority 50, below list/expex Tab handlers) |
| `LinkedAnchorGuard`, `TextObjectOrphanGuard`, `MarginaliaAnchorGuard` (`linked-anchor.ts`) | three guards that keep anchored cards from being silently orphaned — `MarginaliaAnchorGuard` re-inserts a placeholder paragraph (same uuid) when a transaction would delete an anchored paragraph or a `linkedAnchor`-marked range |
| `DocStructureObserver` (`doc-structure/`) | the keystroke-sanctity diff engine — **first** extension in the list; publishes the per-transaction `StructureDiff` on the `DocStructureBus` |

---

## 4. As-shipped cowork plumbing
*Seeds the manifest's `structure.md` / `actions.md` and the as-shipped clarifications to VIRGIL.md's [Cowork pattern](VIRGIL.md#cowork-pattern). **This subsystem diverges sharply from the v1 design in VIRGIL.md's confident section — see §4.6.***

Virgil calls no model. An external agent (Claude) reads the same `.tex`/`.bib` and writes JSON sidecars; the app polls and surfaces them. Here is what the shipped code actually does — verified by repo-wide grep (the v1 vocabulary returns **zero** source hits; see §4.6).

### 4.1 `editor/scripts/apply_response.py` — the writeback

The single sanctioned writeback. CLI surface (argparse): `doc` (positional), `op` (positional, optional — inline JSON or `@file`), `--revert <id>`, `--complete-only <id>`, `--note <note>`. **There are no named subcommands.** Three operations:

- **default apply** (`apply(doc, op)`): inserts the result card into one of seven panel sidecars (`PANEL_TO_SIDECAR`: `notes`, `todos`, `cutter`, `revisions`, `footnotes`, `citations`, `quotations`), rejects a duplicate card id (idempotency), flips the matching `ai-requests.json` request `status → "complete"` and sets `resultId`, clears the source card's `aiRequest` flag (when `clearSourceFlag`, default true), appends a `notifications.json` item (`kind: "ai-request-complete"`), bumps `virgil/version.txt`. A `requestId` of the form `virtual:<panel>:<cardId>` synthesizes the link **without** touching `ai-requests.json`.
- **`--revert <id>`**: deletes the result card (scans all seven sidecars for the `resultId`), sets the request `status → "submitted"` (note: not `draft`), drops `resultId`, appends a `kind: "ai-request-failed"` notification, bumps version.
- **`--complete-only <id>`**: marks a request complete **without** creating a card (used by skills like style-merge that mutate the `.tex` directly); no `resultId` set.

**Atomicity (as-shipped, weaker than advertised):** each sidecar is written eagerly and independently via a plain non-atomic `write_text` (open/truncate/write) in `editor/scripts/_common.py`. There is **no** staged-then-committed transaction and **no** rollback. The only crash-safety property is **idempotent re-run** (duplicate-id rejection + no-op on already-complete requests). A sibling script (`rename_citekey.py`) *does* ship a real `os.replace`-based atomic writer, but `apply_response.py` does not use it.

**No pen dance.** `apply_response.py` never reads/writes `collab.json` or any `pen-context.json` (no such file exists in `src/`), has no TTL, and never enables-then-restores collab. The writeback writes sidecars unconditionally. (The pen/turn-taking system is a *separate, browser-side* subsystem — §4.4.)

**The `update` op is deferred:** skills that update an existing card fall back to a direct sidecar Edit (per `editor/AGENTS.md`).

### 4.2 `editor/scripts/list_requests.py` — the request lister

Consumed by `/editor/review`. Emits **JSONL** (one object per line) from three sources, all filtered to non-`complete`:

1. **`ai-requests.json`** — each open request; also accumulates a `bridged` set of `(panel, cardId)` from each request's `linkedTo` so card-flags already represented aren't double-listed.
2. **`bib-review-requests.json`** — open bib reviews (tolerates a `requests` or `reviews` top-level array).
3. **Four card-flag panels** (`notes`, `todos`, `cutter`, `revisions`) — emits a card only when `aiRequest` is truthy, for cutter/revisions only when `kind == "comment"`, and only when `(panel, cardId)` is **not** already bridged. Id form: `virtual:<panel>:<cardId>`. This is the back-compat route for papers created before the bridge.

A summary line (`# N open: …`) goes to stderr.

### 4.3 `src/lib/ai-request-bridge.ts` — the card-flag bridge

`bridgeCardAiRequestFlag(docId, link, value, ctx)` collapses a per-card sticky `aiRequest: true` flag into an `ai-requests.json` entry. On `value === true` it upserts a request (creating one with `status: "submitted"`, `id: generateEntityId()`, `kind` from `ctx.kind ?? PANEL_TO_KIND[link.panel]`, `linkedTo: link`); on `value === false` it drops the matching open request. **Best-effort:** errors are logged, not thrown — the card flag is the source of truth and `ai-requests.json` self-heals on the next toggle/drain. The bridged card kinds (`PANEL_TO_KIND`): `notes→note`, `todos→todo`, `cutter→suggestion`, `revisions→suggestion` — i.e. notes, todos, cutter-comments, revision-comments.

### 4.4 `src/hooks/useDocNotificationStream.ts` — the notification poller

Polls `<doc>/virgil/notifications.json` every **6 s**; tracks "unseen" via a per-doc localStorage key (`virgil-doc-notification-seen-at:<docId>`) holding the newest item's `at` timestamp; returns items strictly newer than the last-seen stamp for the consumer to toast. Entry shape `DocNotification = { kind: "ai-request-complete" | "ai-request-failed"; at; summary; requestId? }`. **As-shipped it is not yet wired to a UI host** (per `editor/AGENTS.md`) — the poller exists but nothing consumes its output.

### 4.5 `src/lib/collab.ts` + `useCollab.ts` — the pen / turn-taking subsystem (browser-side, separate)

A fully separate, browser-side subsystem; the Python writeback has **no** knowledge of it. Pure types/constants in `collab.ts`, runtime state machine in `useCollab.ts`. `collab.json` (sidecar, `COLLAB_SIDECAR_FILE = "collab.json"`) holds `{ enabled, participants[], pen, presence{} }`, where `pen = { holder, since, lastHeartbeat, lastActivity, requestedBy[] }`. Constants (`COLLAB_TIMINGS`): `penHeartbeatMs 30 s`, `penActiveMs 60 s`, `penIdleMs 3 min`, `penStaleMs 5 min` (partner may take over), `cardHeartbeatMs 10 s`, `cardStaleMs 60 s`, `pollMs 5 s`. The hook exposes `enableCollab` / `takePen` / `passPen` / `requestPen` / `takeOver` / `bumpActivity` / `claimCard`, a holder heartbeat, a poll gated on `pen.holder` (no wakeups when the pen is free), and a `beforeunload` release.

### 4.6 Divergences from the v1 design (VIRGIL.md's confident Cowork section)

VIRGIL.md's [Cowork pattern](VIRGIL.md#cowork-pattern) describes a **v1 target**, much of which is **not built**. Verified by repo-wide grep across `src/`, `editor/`, `library/` (zero hits for `pen-context|--synthesize-task|write-with-comment|write-silent|complete-task|safetyLevel|safety_level`):

| VIRGIL.md (v1 target) | As-shipped |
|---|---|
| Two-field `status` (lifecycle) + `result` (outcome) vocabulary | **Single** `AiRequest.status: "draft" \| "submitted" \| "complete"` (`types.ts` ~199) + optional `resultId?` (a *pointer* to the result card, not an outcome enum). No `result` field. |
| Per-Task **safety levels 1/2/3** mapped to subcommands `write-silent` / `write-with-comment` / `complete-task` | No safety level anywhere; no such subcommands. Only default-apply / `--revert` / `--complete-only`. |
| `apply_response.py` subcommands `complete-task`, `write-with-comment`, `write-silent`, `complete-only`, `revert` + `--synthesize-task` flag | Only `--revert`, `--complete-only`, and the default apply op exist. No `--synthesize-task`. |
| "The editing lock (the pen)… **Fully scripted inside `apply_response.py`**" with `.virgil/pen-context.json`, TTL ≈ +30 s, enable-then-restore collab | **Not in the writeback at all.** The pen is the separate browser subsystem of §4.5; `apply_response.py` never touches it. No `pen-context.json` in `src/`. |
| "writes these N files atomically, roll back on failure" | Non-atomic eager `write_text`; crash-safety is idempotent re-run only (§4.1). |
| Notification toast loop | Poller shipped but **unwired** (§4.4). |

VIRGIL.md already carried one such as-shipped note (the single-`status` one). This chip adds brief as-shipped notes for the pen, the safety-level/subcommand table, and atomicity directly in VIRGIL.md's Cowork section (Deliverable 3), in the same light-touch style — it does **not** rewrite the section, which remains the v1 target.

---

## 5. Reserved-name inventory
*Seeds the manifest's `gardening.md` (including the future user-overlay deny-list).*

Every name Virgil reserves such that a user authoring their own `.tex` / preamble / files cannot safely override it.

### 5.1 Injected LaTeX macros (SSOT: `ensureVirgilCommands` + `CLASSIC_PREAMBLE`)

Virgil injects **six** no-op entity-id macros plus **one** package. Two injection sites:

- **Seed** ([src/lib/document-styles.ts](../../src/lib/document-styles.ts) `CLASSIC_PREAMBLE` ~21-37): declares `\providecommand{\vfid}[1]{}`, `\providecommand{\vcid}[1]{}`, `\providecommand{\vexid}[1]{}` and `\usepackage{xcolor}` (plus `inputenc`, `amsmath`, `amssymb`).
- **Lazy top-up** ([src/lib/latex-serializer.ts](../../src/lib/latex-serializer.ts) `ensureVirgilCommands` ~45-84): on **every save**, scans the preserved/user preamble and splices in, before `\begin{document}`, whichever of these are missing: `\usepackage{xcolor}`, `\providecommand{\vfid}[1]{}`, `\providecommand{\vcid}[1]{}`, `\providecommand{\vexid}[1]{}`, `\providecommand{\vxid}[1]{}`, `\providecommand{\vlid}[1]{}`, `\providecommand{\vlidend}[1]{}`. This runs even against a **user-authored** preamble.

**Seed-vs-lazy asymmetry (note):** the seed declares only `\vfid`/`\vcid`/`\vexid`; `\vxid`/`\vlid`/`\vlidend` are added only by `ensureVirgilCommands` on the first save that needs them. So an older doc's preamble may be missing three of the six until Virgil next writes it. (The `document-styles.ts` comment still describes the markers as "(footnotes, citations, examples)" / three macros — minor internal staleness vs. the six-macro reality.)

**`\pgmark`** is reserved-by-convention but injected by the **library** Python pipeline (`library/scripts/tex_emit.py` → `\providecommand{\pgmark}[2][high]{}`), not the editor serializer; the editor only consumes it (`pgmark.ts`). The expex control words (`\ex \pex \xe \a \begingl \endgl \gla \glb \glft …`) are package commands the parser depends on but does not define.

### 5.2 Marker comment conventions (all `%!v`-prefixed)

| Prefix | Meaning | Defining file |
|---|---|---|
| `%!v:<4hex>` | block / paragraph UUID anchor | `uuid.ts` (`NODE_UUID_REGEX`, `NODE_UUID_ANCHOR`) |
| `%!v:blank` | empty unidentified paragraph | `latex-serializer.ts` |
| `%!vtex:begin <id>` / `%!vtex:end <id>` | raw-LaTeX (texBlock) open / close | `tex-block.ts`, `latex-serializer.ts` |
| `%!v tex:end` | escaped literal end-marker inside a texBlock body | `latex-serializer.ts` (the on-disk encoding of an escaped `%!vtex:end`) |

No other `%!v…` families exist in `src/`. Copies of the `%!v:` regex live in `latex-parser.ts` (trailing-anchor strip, per-list-item), `latex-paragraph-map.ts`, and `latex-serializer.ts` (preamble-line strip) — all matching the same convention.

### 5.3 Reserved CSS classes & `data-*` attributes (SSOT: `src/app/globals.css`)

All app styling is one file ([src/app/globals.css](../../src/app/globals.css), ~4057 lines; no `*.module.css`). Reserved class families (the structural / hook classes an extension author or pasted content shouldn't collide with):

- **Editor / TipTap:** `.tiptap`, `.ProseMirror`, `.react-renderer`, `.node-<name>` (generated by `ReactNodeViewRenderer`; e.g. `.react-renderer.node-texBlock` — note the rhythm-rule caveat in agent memory), `.annotation-editor`.
- **Headings / blocks:** `.heading-wrapper*`, `.heading-annotation*`, `.heading-label*`, `.section-folded`, `.tex-block*`, `.maketitle-marker`, `.latex-comment*`, `.latex-cmd`, `.display-math`, `.inline-math`, `.math-popover*`, `.math-placeholder`, `.math-error`.
- **expex (all unscoped `.expex-*`):** `.expex-block`, `.expex-number`, `.expex-body`, `.expex-item*`, `.expex-gloss*`, `.expex-gloss-cell`, etc.
- **pgmark:** `.pgmark-chip*`, `.pgmark-rule*` (DOM hooks emitted by the plugin).
- **Links / marginalia / drop-mode:** `.linked-anchor`, `.dropmode-bar-*`, `.marginalia-drop-indicator`, `.virgil-archive-drop-target`.
- **Floats / cards / panels:** `.text-object-grab-handle`, `.lifted-text-overlay*`, `.card-drag-handle`, `.par-float-body`, `.virgil-bar` (the only `.virgil-`-prefixed class), `.panel-*`, `.iconbtn-*`, `.topbarbtn*`.
- **Reserved `data-*` namespace** (the behavioral hook surface): structural (`data-type`, `data-empty`, `data-paragraph-kind`, `data-section-number`, `data-tint-color`, `data-margin-side`, `data-strip-side`, `data-zen-mode`, …), cards/links (`data-card`, `data-card-key`, `data-card-selected`, `data-card-hovered`, `data-link-card`, `data-link-highlight`, `data-floating-card`, `data-omni-entry`, `data-panel-theme`, …), drop-mode (`data-drop-mode-active`, `data-lift-mode`, `data-pop-button`, …), helper-mode (`data-helper`, `data-helper-mode`), and the large print/prefs sub-namespace (`data-print-e-*`, `data-print-p-*`, `data-show-hl-*`, `data-pref-mode`, …).

### 5.4 Reserved file / folder paths (SSOT: `src/lib/storage-fsa.ts`)

[src/lib/storage-fsa.ts](../../src/lib/storage-fsa.ts) is the single disk boundary. Reserved on-disk names, per paper:

- **`virgil/`** (`VIRGIL_SUBDIR`) — the sidecar folder.
- **`virgil/figures-cache/`** (`FIGURES_CACHE_DIR`) — rasterized figures `<sha>.webp` + `index.json` (`FIGURE_INDEX_FILE`), keyed by source-content sha.
- **`virgil/.history/`** (`HISTORY_DIR`) — shadow snapshots `<ISO-timestamp>/` of `virgil.json` + `editor-state.json`.
- **`.virgil/`** (distinct from `virgil/`) — the agent/library plumbing sibling: `.virgil/queue/`, `.virgil/models/`, `.virgil/catalog.json`, `.virgil/notifications/inbox.json`, `.virgil/libraries/<slug>.json`, `.virgil/library-path.json`, and (design-only — written by the library `apply_response.py`, not `src/` TS) `.virgil/pen-context.json`. See [library/AGENTS.md](../../library/AGENTS.md) for the full `.virgil/` layout.

**Sidecar JSON filenames under `virgil/`:**

- **Stable infrastructure** (well-grounded in non-card code): `virgil.json` (paragraph titles + fingerprints), `editor-state.json` (last paragraph + folds), `ai-requests.json`, `notifications.json`, `collab.json` (`COLLAB_SIDECAR_FILE`), `document-settings.json` (preamble style id), `bib-review-requests.json`, `bib-settings.json`.
- **Card-coupled (now certified post-refactor in [phase0-card-current-state.md §3.1](phase0-card-current-state.md#31-the-virgil-sidecar-inventory)):** `notes.json`, `todos.json`, `cutter.json`, `revisions.json`, `reports.json` (← renamed from `quotations.json`), `citations.json`, `footnotes.json`, `examples.json`, `archive.json`, `annotations.json`; legacy `suggestions.json`, `comments.json`; non-card `focus.json`, `library-overlay.json`. (Originally listed here provisionally; the card report is now the doc-of-record.)

### 5.5 v2-reserved overlay paths (design-only, NOT in code)

`~/.virgil-user/` (user-owned, app-update-safe root: `voice-profile.md`, `commandment-overrides.md`, `rejection-corpus/`, `skill-preferences/*.json`, `dream-state/`, …) and `<docpath>/.virgil/user-overrides/` (per-doc tuning: `voice-snippet.md`, `revise-skill-prefs.json`) are **reserved by design only**. A repo-wide grep for `virgil-user` / `user-overrides` returns **zero hits under `src/`** — they live solely in `EDITOR_SKILLS_BRAINSTORM.html` and VIRGIL.md's stub. No code reads, writes, or deny-lists them today; the deny-list enforcement is aspirational. This is the seed for `gardening.md`'s future user-overlay deny-list.

---

## 6. SSOTs touched (quick index)

| Fact | Single source |
|---|---|
| id generation (short vs entity) | `src/lib/uuid.ts` |
| `%!v:` block-anchor regex | `src/lib/uuid.ts` (`NODE_UUID_REGEX`, `NODE_UUID_ANCHOR`) |
| which TextObject kind carries which source marker | `TEXT_OBJECT_REGISTRY.sourceMarker` (`src/text-objects/text-object-registry.ts`) + `src/text-objects/types.ts` field doc |
| block id assignment + dedup | `assignUuids` (`src/lib/latex-serializer.ts`) |
| injected preamble macros | `ensureVirgilCommands` (`src/lib/latex-serializer.ts`) + `CLASSIC_PREAMBLE` (`src/lib/document-styles.ts`) |
| accepted LaTeX (parse) | `parseLatex` / `parseInlineContent` / `parseBody` (`src/lib/latex-parser.ts`) |
| emitted LaTeX (serialize) | `serializeToLatex` / `serializeNode` (`src/lib/latex-serializer.ts`) |
| heading level ↔ command | `src/lib/heading-types.ts` |
| citation command vocabulary | `src/lib/cite-commands.ts` |
| TipTap extension set | `src/lib/tiptap/index.ts` |
| disk paths + sidecar boundary | `src/lib/storage-fsa.ts` |
| reserved CSS / `data-*` | `src/app/globals.css` |
| AI-request writeback | `editor/scripts/apply_response.py` |
| card-flag → request bridge | `src/lib/ai-request-bridge.ts` |
| pen / turn-taking | `src/lib/collab.ts` + `src/hooks/useCollab.ts` |

---

## 7. Drift & discrepancies found

Surfaced honestly per the doc-graph discipline. Items marked **[fixed]** were corrected in VIRGIL.md by this chip; the rest are noted for a future `/cleanup-virgil` pass (this chip does **not** re-stamp the `docs/agents/*` derivatives).

1. **[fixed] VIRGIL.md's UUID/Ontology marker list was incomplete.** Its Ontology bullet and the UUID-marker stub named only `%!v:`, `\vcid`, `\vfid`, `\vexid` and claimed *"linkedRange uses the linkedAnchor mark's `anchorId` instead [of a marker]."* The shipped family also includes **`\vxid`** (example items) and **`\vlid`/`\vlidend`** (linkedRange, persisted to `.tex` since Phase E). VIRGIL.md's UUID section and Ontology bullet were updated.

2. **VIRGIL.md's confident Cowork section describes a largely-unbuilt v1 target** (the pen dance in `apply_response.py`, the two-field status/result vocabulary, safety levels 1/2/3, the named subcommands, `--synthesize-task`, atomic-with-rollback writes). Verified absent by repo-wide grep (§4.6). **[partially fixed]** brief as-shipped notes were added to the Cowork section (Deliverable 3); the section is intentionally **not** rewritten (it remains the v1 design target).

3. **VIRGIL.md references two design docs that are not in the committed repo.** Its Status callout and Related-documents list cite `EDITOR_SKILLS_V1.html` and `MEMO_V1_AND_ROT_PREVENTION.md`. In this worktree (based on `chip-1-rot-prevention` @ `c315113`) those files **do not exist and were never committed on any branch** (`git log --all` is empty for both) — they exist only as untracked working-tree files in the *shared* tree (the concurrent card-refactor session's snapshot). Only `EDITOR_SKILLS_BRAINSTORM.html` is tracked. **Not fixed** (these are chip-1's design-source references; the user may intend to commit the files during chip integration — flagged here for that decision). The coherence script's check 1 is unaffected because these are prose/Related-documents references, not `derives-from`/`covers-code` header edges.

4. **`docs/agents/main-text.md` lists displayMath's LaTeX as "`$$…$$` and `\[…\]`."** The honest source round-trip form is `\[…\]`; `$$…$$` is the editor/DOM/input-rule register only (§2.6). Minor imprecision in a derivative; **not corrected** (this chip does not re-verify the agent docs).

5. **`src/lib/document-styles.ts` preamble comment is stale.** It describes the entity-id markers as "(`\vfid`/`\vcid`/`\vexid`)" / "(footnotes, citations, examples)" — three of the six. Reflects the seed-vs-lazy asymmetry (§5.1); the lazy injector owns the other three. Code comment only; noted, not changed.

---

## 8. Related documents

- **[VIRGIL.md](VIRGIL.md)** — the canonical conceptual spine; this report is the exhaustive seed its three stable sections forward-point to.
- **[docs/agents/main-text.md](../agents/main-text.md)** — the editor/content-model/links derivative (TipTap table, marker prose). `derives-from` VIRGIL.md's UUID + LaTeX sections.
- **[docs/agents/architecture.md](../agents/architecture.md)** — registries / hooks / persistence / sidecars derivative.
- **[library/skills/_latex-output.md](../../library/skills/_latex-output.md)** — the library skills' curated LaTeX-output subset (cross-checked in §2.8).
- **[editor/AGENTS.md](../../editor/AGENTS.md)** — the editor skill bundle + cowork plumbing prose (cross-checked in §4).
