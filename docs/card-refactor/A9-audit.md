# A9-audit — Appearance & typography (N2 two-class; morph chevron; borrows-from-main-text)

<!-- audited against HEAD 588ae7e (2026-06-09); foundations A0 + AF landed+merged (e279864) -->
<!-- read-only audit chip — the ONLY write is this file. Two kinds (TextObject+Card) never merge; A9 touches the text-object side nowhere except the already-shared FloatChrome title slot. -->

## 0. TL;DR

A9 owns three intertwined reforms over the per-kind card body. All three are **registry-shaped fixes** that the landed foundations (A0 `CARD_REGISTRY`, AF `FloatChrome.titleNode` slot + `chromeSlots.title`) make declarable in one place; today they are scattered across the per-panel `*Card.tsx` files with no SSOT.

1. **C1 — borrows-from-main-text display.** There is **no shared "borrowed main-text display" component**. Instead there are **three independent body-render paths**, and the "faithful atom rendering" the SSOT asks for exists only by accident in one of them:
   - **Path A — nested `RichTextField`** (a *full second TipTap editor* with its **own hand-maintained extension list**): footnote, note, archive, **report**, report-request. Faithful to links/atoms/nested-footnote phenomena **because it is a real editor** — but it is **EDITABLE and actionable**, directly contradicting C1's "display-only, nothing grabbable." And its schema is a **drift hazard**: `RichTextField.tsx:262-267` hand-mirrors `TexBlock/FigureBlock/GraphicsBlock/LatexComment/DisplayMath` from the main editor with a literal comment warning that a new main-editor block atom must be re-registered here or "the same bug class will re-appear."
   - **Path B — manual JSX reconstruction** (plain text, **NOT faithful**): `ExampleCard.tsx:159-216` renders `example.bodyText` / `items[].text` as `whitespace-pre-wrap` strings. A citation, `\ref`, or inline-math inside an example body shows **raw**.
   - **Path C — plain string in a styled `<div>`/`<textarea>`** (not rich at all): highlight (`HighlightCard.tsx:139-147`, `anchorText` string), cutter-comment/suggestion + revision-suggestion (`<textarea>` over flat string fields), todo, citation, bib.
   - **Definitive C1 enumeration** (the SSOT left this open): the borrowed-main-text class is **footnote, archive, example** plus, by the same logic, the **highlight excerpt**. The SSOT's speculative candidates **cutter excerpts and revision-suggestion are NOT eligible** — their `original_text`/`suggested_text`/`user_text` are **flat `string` fields** in the data model, never `JSONContent`, so they *cannot* carry atoms to render faithfully (they render in `<textarea>`s by construction). Report **is** Path A today but is apparatus prose, not borrowed document content — it should stay rich-editable, not move to the display class.

2. **C2 — two typography classes (N2 ratified).** N2 = borrowed-content → **main-text serif one step down** on the panel size scale; everything else → **standard sans**. The scale lives in `panel-typography.ts`. Pinned exact step: main text `--editor-font-size: 1.05rem` ≈ **17px** (`globals.css:77`); **one step down = 15px Source Serif 4** (already the footnote/archive value, `panel-typography.ts:44,46`). The class assignment is **inconsistent today**: `example` is `15`? No — it is **12px serif** (`:53`), wrong on *both* axes for a borrowed kind; `report` is **12px Inter sans** (`:52`) but renders through the same serif `RichTextField` as footnotes, so its declared typography and its render path disagree. The two-class split is **not declared anywhere** — it is implicit in 10 hand-set rows of `DEFAULT_PANEL_TYPOGRAPHY`.

3. **MORPH CHEVRON.** The down-chevron-beside-the-kind-label morph **exists for exactly ONE of the four morph panels** (Revisions), via `kindOptions={["revision-comment","revision-suggestion"]}` + `onKindChange` (`RevisionCommentCard.tsx:104`, `RevisionSuggestionCard.tsx:296`) → `CardKindHeader`/`CardKindDropdown` (`panel-primitives.tsx:320-411`), with the popped path wired through `chromeSlots.title` in `cards/floats/index.tsx:406,441`. **Cutter and Reports have NO convert/morph mechanism at all** (no `convertCard` in their hooks). **Notes** has only a **one-way `+note` button** (`HighlightCard.tsx:149-158` → `onAddNote`), not a dropdown. The chevron must be **generalized to all 4 pairs**, driven by A0's `cardKindsForPanel(panel)` (`predicates.ts:40`), replacing the per-panel special-casing; per-pair **morph compatibility (note↔highlight is doubly lossy)** must be **declared in `CARD_REGISTRY`** (proposed field below). The per-pair data-salvage transform (`useRevisions.convertCard`, `useRevisions.ts:325-374`) is the seed to generalize into a registry-declared converter.

**Deepest-fix shape:** one `BorrowedMainText` *display-only* renderer (read-only TipTap mounting the **main editor's** extension set via a single shared schema module — kills Path B/C drift), a **registry-declared `bodyClass: "borrowed" | "sans"`** field on `CardMeta` that derives `panel-typography` defaults (kills the implicit 10-row table), and a **registry-declared `morph` descriptor** (`{ to, lossy, convert }`) that powers one chevron for all 4 pairs (kills 3-of-4 missing + 1 one-way + 1 dropdown asymmetry). No new per-keystroke work — all of it is static-registry + on-demand render.

**Confidence:** High on the fragmentation map and the morph generalization (every file:line re-verified against `588ae7e`). Medium on the C1 display-component scope — see Open Questions: making borrowed bodies *read-only* changes today's behavior (footnote/note bodies are edited in place), so the "display-only" mandate collides with the live in-card editing UX and needs Gabriel's ratification on where the line falls.

---

## 1. Current reality (code-derived, EXACT file:line) — against the finished foundations

### 1.1 The card body render paths (the C1 substrate)

| Path | Mechanism | Faithful to atoms? | Editable? | Kinds | Key file:line |
|---|---|---|---|---|---|
| **A** | Nested `RichTextField` (real TipTap, own ext list) | **Yes** (real nodes) | **Yes** (editable; read-only only under reader chrome) | footnote, note, archive, report, report-request | `RichTextField.tsx:238-417`; mounted by `EditableCard` `panel-primitives.tsx:943-959` |
| **B** | Manual JSX over plain strings | **No** (raw text) | No | example | `ExampleCard.tsx:159-216` |
| **C** | Plain string in styled div/textarea | **No** | varies (textareas editable; highlight read-only) | highlight, cutter-comment, cutter-suggestion, revision-suggestion, todo, citation, bib | `HighlightCard.tsx:139-147`; `CutterSuggestionCard.tsx:262-289` (FieldBlock); `RevisionSuggestionCard.tsx:324-330` |

- **The drift hazard (Path A schema duplication):** `RichTextField.tsx:238-268` declares its own `extensions: [StarterKit(...), InlineMath, Citation, LatexCommandMark, Placeholder, TabIndent, TexBlock.configure({cardContext:true}), FigureBlock(...), FigureCaption, GraphicsBlock(...), LatexComment(...), DisplayMath]`. The literal comment at `:260-261`: *"If a new block-atom type is added to the main editor, also register it here (or the same bug class will re-appear)."* This is a manually-synced second schema — the single deepest C1 fragmentation.
- **Chrome-driven read-only is the only "display" mode today:** `EditableCard` threads `editable={cardEditable}` where `cardEditable = !cardKind || !chrome.editableCardKinds || chrome.editableCardKinds.includes(cardKind)` (`panel-primitives.tsx:746-748`). Reader sets `editableCardKinds: ["note"]` (`chrome-config.ts:139`) → every card except note mounts read-only. This proves a read-only RichTextField *works* and is the natural seed for the display class — but it is gated on chrome, not on kind-intrinsic borrowed-ness.
- **Compressed bodies are a fourth, lossier path:** every kind's compressed (collapsed) state renders a flattened one-liner via `makeCompressedSummary(content, lines)` (notes/footnote/archive/report) or a manual `.replace(/\s+/g," ").trim()` string (example `:148-153`, cutter/revision suggestion `:393-399`/`:310-316`, highlight `:128-135`). None render atoms; a citation in a compressed footnote shows its display text only if it survived the JSON→plain flattening.

### 1.2 Typography reality (the C2 substrate)

- **Scale anchor:** `--editor-font-size: 1.05rem` (`globals.css:77`, ≈17px); panel body documented as 13px/400 in `STYLE_GUIDE.md:72-73` (note: this 13px doc value disagrees with the actual `panel-typography.ts` values of 12/15 — a doc-vs-code drift).
- **`DEFAULT_PANEL_TYPOGRAPHY`** (`panel-typography.ts:43-54`), keyed by `PanelBodyKey` (10 keys):
  - **15px Source Serif 4** (one step below main text): `footnote`, `archive` — these are the *only* two that already satisfy N2's borrowed-content rule.
  - **12px Source Serif 4**: `example` — **wrong size** for a borrowed kind (should be 15px serif per N2).
  - **12px Inter (sans)**: `note`, `cut`, `revision`, `citation`, `bib`, `todo`, `report` — correct for "everything else → sans," **except `report`** which renders through the serif `RichTextField` (declared-sans vs rendered-serif mismatch).
- The file's own header comment (`:38-42`) already names two tiers ("12px Inter compact" / "15px Source Serif 4") — so the two-class idea exists informally but is **not codified, not derived, and inconsistently applied** (example is the outlier).
- **Three parallel keyings** the registry should collapse: `PanelBodyKey` (typography, 10 keys, `panel-typography.ts:12-22`), `PanelThemeKey` (colors, 11 keys, `panel-theme.ts:14-25`), `ThemeKey`/`CardMeta.themeKey` (CARD_THEMES, `cards/types.ts:49` + `panel-primitives.tsx:212-239`), and `CardKind` (16, `cards/types.ts:28-44`). None is derived from `CARD_REGISTRY`; they are hand-aligned (e.g. `note`→panelKey `note`→themeKey `note`, but `revision-comment`→themeKey `comment`→panelKey `revision`→colorKey `revision`).

### 1.3 Morph reality (the chevron substrate)

- **The dropdown primitive already exists and is registry-labelled:** `CardKindHeader` (`panel-primitives.tsx:320-342`) renders `CardKindDropdown` when `options.length > 1 && onChange`; the dropdown labels come from `cardTypeLabel(opt)` which is **registry-derived** (`panel-registry.ts:212-214` ← `CARD_REGISTRY[k].label`). `PanelCard` threads `kindOptions`/`onKindChange` into it (`panel-primitives.tsx:1463-1467, 1725-1726`).
- **Only Revisions wires it.** Docked: `RevisionCommentCard.tsx:104-106`, `RevisionSuggestionCard.tsx:296-298`. Popped (AF): `cards/floats/index.tsx:406-414` (comment) and `:441-449` (suggestion) populate `chromeSlots.title` with a `CardKindHeader`. The AF Session-9 `remapCardPopKey` already moves the float rect on the comment↔suggestion key flip — so the **popped morph plumbing is complete** and kind-blind; A9 only needs to *populate `chromeSlots.title`* for the other 3 pairs.
- **The data transform is per-pair and hand-written:** `useRevisions.convertCard(id, "comment"|"suggestion")` (`useRevisions.ts:325-374`) salvages fields across the shape change (`comment.text`→`suggestion.user_text`; `suggestion.user_text||suggested_text`→`comment.content`). This is the only converter that exists. It is **lossy** (suggestion→comment drops `original_text`/`explanation`/`instructions`).
- **Notes' "morph" is not a morph:** `HighlightCard.tsx:149-158` shows a `+ note` button → `onAddNote(id)` (one-way, additive; the highlight tint stays). There is no highlight↔note dropdown, and note→highlight is unreachable.
- **Cutter & Reports:** no convert/morph anywhere (`grep convert src/hooks/useCutter*.ts src/panels/Cutter/` and `…Reports…` → empty). The cards pass no `kindOptions`.
- **Morph pairs (from `cardKindsForPanel`, `predicates.ts:40-41`):** notes→`[note,highlight]`; revisions→`[revision-comment,revision-suggestion]`; cutter→`[cutter-comment,cutter-suggestion]`; reports→`[report,report-request]`. Exactly the 4 pairs the chevron must serve.

### 1.4 The unified header / FloatChrome seam (where the chevron mounts)

- Docked: `PanelCard` renders `CardKindHeader` in the header (via `kindLabelOverride`/`kindOptions`/`onKindChange`, `panel-primitives.tsx:1725-1726`).
- Popped: `FloatWindow` renders `FloatChrome` and maps `floatable.chromeSlots?.title → FloatChrome titleNode` (`FloatWindow.tsx:163`), and `chromeSlots?.trailing → trailing` (`:164`). `FloatChrome.titleNode` supersedes the plain `title` string (`FloatChrome.tsx:54-55, 76-83`). The slot is **reserved and live** for exactly this control.

---

## 2. Wart — no shared borrowed-main-text display component; three drifting render paths (C1)

**WHAT.** "Render this card's body the way the main text renders it (links, atoms, citation-in-footnote, math-in-footnote), display-only" has three independent implementations, only one of which is faithful, and that one is editable (wrong) and schema-duplicated (fragile).

**WHERE.**
- Path A schema dup: `RichTextField.tsx:238-268` (esp. the warning comment `:260-261`).
- Path B (not faithful): `ExampleCard.tsx:159-216` — `example.bodyText` / `items[].text` as plain strings.
- Path C (not rich): `HighlightCard.tsx:139-147` (`anchorText` string).
- Editable-not-display: `EditableCard` mounts the body editable except under reader chrome (`panel-primitives.tsx:746-748, 943-959`).

**WHY it's wrong.** (1) The "display-only, nothing grabbable" mandate is violated for footnote/note/archive (editable in the main app). (2) Example bodies silently lose atom fidelity — an example with a `\ref` or citation reads as raw source. (3) The second schema in `RichTextField` is a standing regression generator: any new main-editor block atom must be hand-added in two places. (4) Four kinds render the same conceptual thing ("borrowed document text") four different ways → no single place to fix a rendering bug.

**DEEPEST FIX.** A single read-only `<BorrowedMainText value={…} />` component:
- Mounts a **read-only TipTap** instance over the **main editor's extension set**, imported from **one shared schema module** (extract the main editor's node/mark list into `src/lib/tiptap/borrowed-schema.ts` and have *both* the main `Editor` and `BorrowedMainText` consume it — `RichTextField`'s hand-list is deleted in favor of it). This is the deepest C1 fix: schema drift becomes structurally impossible.
- `editable={false}`, `nothing draggable/grabbable` (no drop targets registered, no inline-atom grab), so the display-only invariant is enforced by construction rather than by chrome whitelist.
- Used by the borrowed kinds (footnote, archive, example, highlight-excerpt) **in display/collapsed/popped read contexts**. Editing those bodies remains via the existing editable path **only when the kind is intentionally editable** (see Open Question Q1 — this is the scope line Gabriel must draw).
- `ExampleCard`'s manual JSX (`:159-216`) is replaced by `BorrowedMainText` fed the example block's parsed content; `HighlightCard`'s string snippet becomes `BorrowedMainText` fed the anchored range's content (if/when the range is harvested as rich content — otherwise it stays a faithful string, which is acceptable since a highlight anchor is contiguous main-text already styled by the in-doc tint).

---

## 3. Wart — the two typography classes are undeclared and inconsistently applied (C2)

**WHAT.** N2's two classes (borrowed→serif-one-step-down; else→sans) are implicit in 10 hand-set `DEFAULT_PANEL_TYPOGRAPHY` rows, with `example` and `report` violating the intended class.

**WHERE.** `panel-typography.ts:43-54`. Cross-check: `example` is borrowed (Path B) but typed **12px serif** (should be 15px serif); `report` is typed **12px sans** but renders serif via Path A `RichTextField`.

**WHY it's wrong.** The class is not a property of the panel-typography table — it is a property of the **card kind** ("does this card display borrowed document text?"). Storing it as 10 free-form rows means a new card kind, or a class reassignment, is an invisible hand-edit with no validation, and the example/report drift went unnoticed precisely because nothing declares the rule.

**DEEPEST FIX.** Declare the class on `CardMeta`:
```ts
// cards/types.ts — proposed
/** N2 typography class. "borrowed" → main-text serif one step DOWN on the
 *  panel size scale (15px Source Serif 4, one step below --editor-font-size
 *  1.05rem≈17px); "sans" → the standard compact panel sans (12px Inter). */
bodyClass: "borrowed" | "sans";
```
Then `DEFAULT_PANEL_TYPOGRAPHY` is **derived**, not hand-kept: borrowed → `{ "Source Serif 4", 15 }`, sans → `{ "Inter", 12 }` (the user-override layer on top is unchanged — overrides still live in `panel-typography.ts`'s mutable registry). Assignment: `footnote`/`archive`/`example` = `borrowed`; everyone else = `sans`. This fixes example (12→15 serif) and forces a decision on report (Open Question Q2: is a report borrowed document text or apparatus? Today it renders serif but is typed sans — pick one).

**Exact pinned values (C2 answer):** borrowed = **15px Source Serif 4** (one step down from 17px main text); sans = **12px Inter**. Color stays `#44403c` for both (current default).

---

## 4. Wart — the morph chevron exists for 1 of 4 panels; 3 different mechanisms (chevron)

**WHAT.** The "switch this card's kind within its panel" affordance is a registry-labelled dropdown for Revisions only, a one-way button for Notes, and absent for Cutter and Reports.

**WHERE.** Revisions dropdown: `RevisionCommentCard.tsx:104-106`, `RevisionSuggestionCard.tsx:296-298`, `cards/floats/index.tsx:406-414, 441-449`. Notes one-way: `HighlightCard.tsx:149-158`. Cutter/Reports: none. Transform: `useRevisions.ts:325-374`.

**WHY it's wrong.** A0 already declares the morph set (`cardKindsForPanel`), the dropdown primitive is already registry-labelled (`CardKindHeader`), and the AF popped slot is already wired (`chromeSlots.title` → `FloatChrome.titleNode`). Everything needed to make this uniform is landed — yet 3 of 4 panels special-case or omit it, and the one transform that exists is hand-written per pair with no compatibility declaration. This is exactly the "scattered switches → registry-derived" mandate.

**DEEPEST FIX.** Registry-declared morph + one consumer:
```ts
// cards/types.ts — proposed
/** Polymorphic-panel morph target + per-pair compatibility. null = this
 *  kind doesn't morph (single-kind panels, system kinds). The chevron is
 *  shown ⟺ morph !== null. `lossy` drives a confirm prompt; `convert`
 *  is the field-salvage transform (generalizes useRevisions.convertCard). */
morph: {
  to: CardKind;            // the other half of the pair
  lossy: boolean;          // note↔highlight = true; revision/cutter/report pairs declare their own
  // convert is registered at boot (like toFloatable) so card-registry stays UI/data-free:
} | null;
```
- `note.morph = { to: "highlight", lossy: true }`, `highlight.morph = { to: "note", lossy: true }`, and the four `*-comment/suggestion` + `report/report-request` analogues. The chevron renders ⟺ `CARD_REGISTRY[kind].morph !== null`, and its `options` = `cardKindsForPanel(panel)` (so the dropdown is always the full pair, registry-ordered).
- The per-pair `convert(card) → newCard` transforms register at boot via a `registerCardMorph(kind, fn)` indirection (same pattern as `registerCardFloatable`/`registerCardDropSpec`, so `card-registry.tsx` stays a runtime leaf — no cycle). `useRevisions.convertCard` becomes the registered `revision` transform verbatim; cutter/reports/notes get their own (today they don't convert at all, so this is net-new but trivial — they're symmetric string/rich salvages).
- **One docked consumer** (`PanelCard` already does this via `CardKindHeader`) + **one popped consumer** (`chromeSlots.title` populated for all morph kinds in `cards/floats/index.tsx`, not just revisions). The `+note` button on `HighlightCard` is **deleted** in favor of the chevron (note↔highlight becomes a real bidirectional, confirm-gated morph).
- `lossy` drives a one-line confirm ("Converting to a highlight will discard the note body. Continue?") before the transform — the only new UX.

---

## 5. Wart — compressed-body + empty-state per kind are ad-hoc (C3 consistency)

**WHAT.** Each card's collapsed one-liner and empty placeholder are hand-rolled with per-file copy and styling.

**WHERE.** Empty: `"empty"` (`EditableCard` `:920`), `"Empty example"` (`ExampleCard.tsx:212`), `"empty highlight"` (`HighlightCard.tsx:132,144`), `"empty suggestion"` (`CutterSuggestionCard.tsx:398`, `RevisionSuggestionCard.tsx:316`), `"Text here."` placeholders in footnote/note/archive. Compressed: `makeCompressedSummary` (Path A) vs manual `.replace().trim()` (Paths B/C), all calling `compressedBodyStyle(compressedLines)` but with different wrappers and color tokens (`text-ink-subtle` / `text-emerald-700/90` / `text-ink-faint`).

**WHY it's wrong.** No SSOT for "what a collapsed/empty card looks like per class," so they drift (color cues, italics, caps). After C1/C2 land, the compressed renderer for a borrowed kind should itself use `BorrowedMainText` (faithful, truncated) rather than a flattened string.

**DEEPEST FIX.** Fold compressed + empty into the body-class abstraction: a borrowed-class card's compressed view is `BorrowedMainText` clipped to `compressedLines`; a sans-class card's is the existing summary string. Empty placeholder text comes from one registry-or-helper map keyed by `bodyClass` (e.g. borrowed → "(empty)" in muted serif; sans → "(empty)" in muted sans), not five literals. Lower priority than C1/C2/chevron but completes the C3 consistency pass.

---

## Target design — the deepest-fix shape

Three registry-declared properties + two shared renderers, all consuming the landed foundations:

1. **`CardMeta.bodyClass: "borrowed" | "sans"`** — derives `panel-typography` defaults (borrowed = 15px Source Serif 4; sans = 12px Inter), kills the implicit 10-row table and the example/report drift. A dev assertion (mirroring A0's lifecycle assertion) checks every kind's declared `bodyClass` matches its render path.
2. **`src/components/BorrowedMainText.tsx`** — one read-only TipTap renderer over a **shared** `src/lib/tiptap/borrowed-schema.ts` extracted from the main editor (consumed by both the main `Editor` and this), display-only (no drop targets, nothing grabbable). Replaces Path B (`ExampleCard` JSX) entirely and `RichTextField`'s hand-mirrored block-atom list. C1's "faithful + display-only" satisfied by construction.
3. **`CardMeta.morph: { to; lossy } | null` + `registerCardMorph(kind, convert)`** — the chevron renders ⟺ `morph !== null`, `options = cardKindsForPanel(panel)`, the transform is registered at boot (leaf-safe). One docked consumer (`PanelCard`/`CardKindHeader`, already there) + one popped consumer (`chromeSlots.title` populated for all 4 pairs in `cards/floats/index.tsx`, today only revisions). Generalizes `useRevisions.convertCard`; deletes the `+note` one-way button.

**How it consumes the foundations:**
- A0: `CardMeta` gains `bodyClass` + `morph`; `cardKindsForPanel` is the dropdown's `options`; `cardTypeLabel` (registry-derived) is the dropdown's labels. The boot-registration indirection mirrors `registerCardFloatable`/`registerCardDropSpec` so `card-registry.tsx` stays a runtime leaf (no `predicates → card-registry → UI` cycle).
- AF: the popped morph mounts in the **already-reserved** `chromeSlots.title` → `FloatChrome.titleNode` slot; the comment↔suggestion key-remap on morph (`remapCardPopKey`, AF Session-9) generalizes to every lossy/symmetric pair flip — A9 must call the convert through the same `EditorPane`-wrapped path that already remaps the float key, so cutter/report/note morphs keep their floats alive exactly as revisions do today.

---

## Keystroke sanctity — per-keystroke risk + event-driven design

**No new per-keystroke risk.** Everything A9 adds is static-registry (`bodyClass`, `morph`) or on-demand render (`BorrowedMainText` mounts once per visible card, not per keystroke).

Specific checks:
- **`BorrowedMainText` is NOT a doc walk.** It renders one card's already-resolved body (`JSONContent` / parsed example block), not a descent over the main doc. It must **not** subscribe to the main editor's transactions; it renders from the same card-source memo the panel already uses. Card-source memos stay gated on `useStructuralRevisions` counters + the reactive `editor` (per AGENTS.md), never an update counter — A9 changes none of that gating.
- **No new `editor.on('update'|'transaction')` subscriber.** A9 touches none of the sanctioned subscribers. `RichTextField`'s own `onUpdate` (`RichTextField.tsx:391-398`, 250ms debounce) is a *nested* editor's local handler, not the main editor's; replacing the editable path with a read-only `BorrowedMainText` for display kinds **removes** work (no `onUpdate` at all in display mode).
- **Live position is unaffected.** A9 is appearance-only; it does not read or recompute in-text positions, so the `getBus(editor).structure` measure-time resolution path is untouched.
- **Morph transform is O(1) per click.** `convert(card)` salvages a fixed set of fields on one record; it is not proportional to doc size. The float key-remap reuses AF's existing O(1) `remapCardPopKey`.

---

## Fragmentation table

| Surface | File(s) (file:line) | Disposition |
|---|---|---|
| Borrowed body — Path A (nested editor, schema dup) | `RichTextField.tsx:238-268` (warning `:260-261`); mounted `panel-primitives.tsx:943-959` | Extract `borrowed-schema.ts`; display kinds → read-only `BorrowedMainText`; editable kinds keep RichTextField but over the shared schema |
| Borrowed body — Path B (example, not faithful) | `ExampleCard.tsx:159-216` | Replace manual JSX with `BorrowedMainText` |
| Borrowed body — Path C (highlight string) | `HighlightCard.tsx:139-147` | `BorrowedMainText` (or keep faithful string — Q3) |
| Chrome-gated read-only (the only "display" mode) | `panel-primitives.tsx:746-748`; `chrome-config.ts:69,139` | Subsumed by intrinsic `bodyClass`-driven display-only |
| Typography defaults (implicit 2-class, 10 rows) | `panel-typography.ts:43-54` | Derive from `CardMeta.bodyClass`; fix example 12→15 serif, resolve report |
| Parallel keyings (PanelBodyKey/ThemeKey/PanelThemeKey/CardKind) | `panel-typography.ts:12-22`; `panel-theme.ts:14-25`; `cards/types.ts:49`; `cards/types.ts:28-44` | Long-term: key all off `CardKind` via `CARD_REGISTRY`; A9 lands `bodyClass` first |
| Morph dropdown primitive (registry-labelled) | `panel-primitives.tsx:320-411` (`CardKindHeader`/`CardKindDropdown`) | Keep; drive from `CARD_REGISTRY.morph` |
| Morph wiring — Revisions only (docked) | `RevisionCommentCard.tsx:104-106`; `RevisionSuggestionCard.tsx:296-298` | Generalize: every morph card passes `kindOptions = cardKindsForPanel(panel)` (or `PanelCard` reads it from registry) |
| Morph wiring — Revisions only (popped) | `cards/floats/index.tsx:406-414, 441-449` | Populate `chromeSlots.title` for cutter/report/note pairs too |
| Morph one-way button (Notes) | `HighlightCard.tsx:149-158` | Delete `+note` button; replace with bidirectional chevron |
| Morph absent (Cutter, Reports) | (none) | Add `morph` decl + `registerCardMorph` transform |
| Morph transform (hand-written, 1 pair) | `useRevisions.ts:325-374` | Register as the `revision` converter; add the other 3 |
| Compressed/empty per-kind ad-hoc | `EditableCard:910-922`; `ExampleCard:148-153,212`; `HighlightCard:128-135`; cutter/revision `:390-399`/`:307-318` | Fold into body-class: borrowed→clipped `BorrowedMainText`, sans→summary; empty text from one map |

---

## Definition of Done for this arena

1. **One borrowed-main-text display component** (`BorrowedMainText`) over a **single shared schema** consumed by both the main editor and cards; example bodies render atoms faithfully; no second hand-maintained block-atom list; display-mode bodies are read-only/non-grabbable.
2. **`CardMeta.bodyClass`** declared per kind; `DEFAULT_PANEL_TYPOGRAPHY` derived from it; example fixed to 15px serif; report's class resolved; borrowed = **15px Source Serif 4**, sans = **12px Inter**, both confirmed against the user-override layer (`panel-typography` mutable registry still wins per-field).
3. **`CardMeta.morph` + `registerCardMorph`** drive **one** chevron for all 4 morph pairs (notes/revisions/cutter/reports), docked (via `PanelCard`) and popped (via `chromeSlots.title`); the `+note` one-way button is gone; lossy pairs (note↔highlight at minimum) confirm before converting; the float survives a morph for every pair (reusing AF's `remapCardPopKey`).
4. **Adding a card kind = one registry entry** also declares its `bodyClass` and `morph` — no edits to `panel-typography.ts` or per-panel `*Card.tsx` morph wiring.
5. Compressed + empty states consistent per body-class.
6. `tsc` clean; no new lint; keystroke `__virgilBusStats()` `emitCount` flat on plain typing; STYLE_GUIDE updated with the two-class rule + the morph chevron convention.

---

## Open questions for the human

- **Q1 (scope of "display-only").** C1 says borrowed bodies are "display-only, nothing grabbable or actionable." But footnote/note/archive bodies are **edited in place today** (RichTextField). Does "display-only" mean (a) only the *example/highlight* read paths and the *collapsed/popped read* views become read-only, while footnote/note/archive keep in-card editing; or (b) all borrowed bodies become read-only display surfaces and editing moves elsewhere (e.g. only in the float, or a dedicated edit mode)? This decides whether `BorrowedMainText` replaces or merely *augments* the editable path. **Recommendation: (a)** — borrowed-display for non-editable contexts (example, collapsed, reader, popped-read), keep editing for footnote/note/archive in their existing editable surface, both over the shared schema.
- **Q2 (report's class).** Reports render serif (Path A) but are typed sans (12px Inter). Is a report **borrowed document text** (→ serif, `bodyClass:"borrowed"`) or **apparatus prose** (→ sans, fix the render path)? **Recommendation: apparatus/sans** — a report is AI-authored commentary, not borrowed source; keep it editable rich but sans, matching its declared 12px Inter.
- **Q3 (highlight excerpt).** A highlight's body is the anchored main-text *range*, already styled by the in-doc tint. Render via `BorrowedMainText` (faithful atoms if the range carries any) or keep the faithful serif string (`HighlightCard.tsx:70-74`)? **Recommendation: keep the serif string** unless the range is harvested as rich content — a highlight range is contiguous prose and the string is already faithful; not worth a TipTap mount per highlight.
- **Q4 (morph compatibility shape).** Is a single `lossy: boolean` + per-pair `convert` enough, or do we want richer compatibility (e.g. "blocked" pairs, or a salvage-preview)? **Recommendation: `{ to, lossy }` + registered `convert`** now; richer compat is YAGNI until a non-symmetric pair appears.
- **Q5 (note↔highlight direction).** Today only highlight→note (`+note`) exists. Does the chevron expose **both** directions (note→highlight discards the body — lossy), or keep highlight→note one-way? **Recommendation: both, with the lossy confirm** — uniformity is the point of the chevron; the confirm covers the data loss.

---

## Cross-arena seams

| Arena | Shared surface | Where (file:line) |
|---|---|---|
| **A4** (selection/focus/keyboard, N1) | Compressed↔expanded is the *expansion* axis A4 owns; A9's compressed-body renderer must read A4's expansion state, not re-derive it. A9 must NOT couple appearance to selection (N1 ⟂). The `+note`→chevron change touches the same `onClick`/`cardStore` call sites A4 is reforming. | `anchored-card-store.ts:129-152`; `HighlightCard.tsx:103-124,149-158`; compressed gate `panel-primitives.tsx:910-922` |
| **A5** (omni-view) | Omni reuses the **same** `*Card.tsx` components, so `bodyClass` typography + the morph chevron land in omni automatically — but omni passes its own props (`onConvert` etc.); A9 must ensure omni's render of the 4 morph panels threads the new registry-driven chevron (today omni wires revisions' convert but not cutter/reports). | `panels/Cutter/omni.tsx:55-74`; `panels/Reports/omni.tsx:43-59`; `panels/Notes/omni.tsx:39-53`; `panels/Revisions/omni.tsx:36,63,81` |
| **A6** (marginalia gutter) | `note↔highlight` morph changes the marker: `note.markerType="note"` vs `highlight.markerType=null` (tint, `card-registry.tsx:96`). A morph that flips note→highlight must add/remove the gutter marker; A6 owns the marker pipeline. | `cards/card-registry.tsx:82-101`; A6 marker render |
| **AF** (foundation, popped header) | A9 populates the reserved `chromeSlots.title` slot for 3 more pairs; relies on AF's `remapCardPopKey` to keep floats alive across a morph (today only revisions exercise it). Also: AF Session-6 hand-off noted A9 "may re-tint the now-neutral float header per kind" — out of A9's appearance scope to consider. | `FloatChrome.tsx:54-55,76-83`; `FloatWindow.tsx:161-164`; `cards/floats/index.tsx:406-449` |
| **A0** (foundation) | A9 adds `bodyClass` + `morph` to `CardMeta` and `registerCardMorph` (mirroring `registerCardFloatable`/`registerCardDropSpec`); must keep `card-registry.tsx` a runtime leaf (no UI import) — transforms register at boot from a UI-aware module. | `cards/types.ts:68-109`; `cards/card-registry.tsx:43-71` |
| **A3** (creation & lifecycle) | A morph is a kind-flip; it interacts with pristine-card tracking (`pristine.markDirty` in `useRevisions.convertCard:327`) and the lifecycle `clone/delete/bindAnchor` declarations. A3 owns the lifecycle provider; A9's morph transforms must not bypass it. | `useRevisions.ts:325-374`; `cards/types.ts:61-66` (lifecycle) |

---

## Stale-ref corrections

- **`chromeSlots.title` is correct on the `Floatable` side; the `FloatChrome` prop is `titleNode`.** SSOT Session-6/9 and the AF hand-off say the morph mounts in "`FloatChrome chromeSlots.title` slot." Precisely: `Floatable.chromeSlots.title` (`floats/types.ts:45`) is mapped to the prop **`FloatChrome.titleNode`** (`FloatWindow.tsx:163` → `FloatChrome.tsx:54-55`). The trailing slot is `chromeSlots.trailing` → `FloatChrome.trailing` (not `chromeSlots.trailing` as a prop name). Use the `Floatable.chromeSlots.{title,trailing}` names when building floats; use `titleNode`/`trailing` when editing `FloatChrome` directly.
- **SSOT §7 A9 / Decisions: "comment↔revision-suggestion" pair** — the spine kinds are `revision-comment`↔`revision-suggestion` (`cards/types.ts:38-39`); bare `comment` is only the on-disk data discriminator (`card-registry.tsx:172,399`). The morph `kindOptions` literal is `["revision-comment","revision-suggestion"]` (`RevisionCommentCard.tsx:104`), and `convertCard` still takes the legacy `"comment"|"suggestion"` data tokens (`useRevisions.ts:326`). The chevron operates on spine kinds; the transform bridges to disk tokens.
- **SSOT §8/Decisions "borrowed candidates likely cutter excerpts + revision-suggestion"** — CORRECTED: cutter-suggestion/comment and revision-suggestion store `original_text`/`suggested_text`/`user_text`/`explanation`/`instructions` as **flat `string`** (`CutterSuggestionCard.tsx:23-28`, `lib/types` field shapes; rendered in `<textarea>`, `:262-289`), so they are **not** borrowed-main-text candidates (cannot carry atoms). Definitive borrowed set = footnote, archive, example (+ highlight excerpt as a faithful string).
- **SSOT A0 hand-off "`resolveCardKind` (key-based)"** — realized as `cardKindForPopoutKey` (float dispatch); not a name A9 needs, but noting the SSOT's `resolveCardKind` mention is the link-registry's link-based resolver, a different function.
- **`panel-typography.ts` header comment claims `example` is in the "15px Source Serif 4" tier conceptually but the row is `fontSize: 12`** (`:53`) — the comment (`:38-42`) lists example under serif but the actual value is 12, not 15. This is the C2 example-drift bug, not just a doc nit.
- **`STYLE_GUIDE.md:72-73` "Panel scale: body 13px/400"** disagrees with `panel-typography.ts` actual values (12px sans / 15px serif). Doc-vs-code drift to reconcile when A9 updates the STYLE_GUIDE.
- **`RichTextField.variant` only supports `"footnote" | "note"`** (`RichTextField.tsx:54`, `panel-primitives.tsx:649`), and **every** Path-A card passes `variant="footnote"` (footnote/note/archive/report all use `"footnote"`, `NoteCard.tsx:131`, `ArchiveCard.tsx:101`, `ReportCard.tsx:108`). The `"note"` variant is effectively dead — flag for A1 gardening, not A9.
