# A8-audit — Print + reader/library

> Read-only audit + design for the **A8** Wave-2 arena of the card-system refactor.
> Scope: **per-kind card rendering in PRINT (appendices) and the read-only READER/LIBRARY**.
> Re-pinned against `HEAD = 588ae7e` (2026-06-09), *after* both foundations landed
> (A0 card SSOT `src/cards/`, AF `Floatable` subsystem `src/floats/`). All `file:line`
> below are verified current; SSOT/older-audit drift is recorded in the Stale-ref section.
> This audit owns the **print + reader leg** of the DoD#5 cross-surface-coherence guarantee
> and coordinates the C1 borrowed-content display class with A9.

---

## 0. TL;DR

- **There is no per-kind card switch in print or in the reader — by design, and it already
  holds.** Both surfaces render through the **same live panel component tree** the docked rail
  uses. Print: `PrintAppendices` → `renderPanel(kind)` → `<PaneRailBody panelKind={kind}>`
  (`EditorPane.tsx:4257-4262`). Reader: `PaperRender` mounts the canonical `<EditorPane
  editable={false} chrome={READER_CHROME}>` (`library/components/PaperRender.tsx:235-246`).
  **So A8 inherits A0/AF/A9 for free at the card-body level** — there is nothing to "make
  registry-derived" inside a per-kind card renderer, because no such renderer exists here.
  This is the architecture `library/READER_INHERITANCE.md` codifies and the audit confirms is intact.
- **The fragmentation that *does* exist is one level up: a hand-maintained "which panels are
  printable" set, duplicated across FOUR sites, none registry-derived, and all of them silently
  drop the `reports` panel** (`report` + `report-request`, a real polymorphic panel with a live
  `ReportsHost`). Adding/removing a printable panel today means editing four parallel lists +
  one CSS allowlist. This is the A8 analog of the A0 "~14 sync sites" wart, scoped to the
  print-panel set.
- **Three dead/stale couplings in the print CSS.** The `@media print` rules target DOM hooks that
  **no longer exist in the tree**: `[data-card-id]` (cards stamp `data-card-key`, never
  `data-card-id`), `[data-pop-button]`, `[data-close-button]`, and `.panel-header-controls`
  (zero producers in `src/`). So print's break-inside hygiene and its "strip the popout/close
  chrome from appendices" pass are **both silently no-ops** — appendix cards print with their
  docked drag-grip + collab pills + (for popped cards) chrome, and break mid-card.
- **`print.defaults.json` still ships a removed panel key** (`"quotations": false`) that is not in
  `PrintPanelKey` — a dead key the personal-prefs promotion pipeline keeps re-emitting (cf. the
  `release_prefs_snapshot_gotcha` memo about stale snapshot keys).
- **The deepest fix is registry-driven printable-panel derivation**: replace the four hand-synced
  lists with a single source derived from `PANEL_REGISTRY` + the A0 predicates
  (`cardKindsForPanel`), generate the CSS allowlist (or collapse it to one attribute-driven rule),
  and re-point the dead print-strip selectors at the real `data-card-key` / `PopoutButton`
  surface so print chrome-stripping actually works. Reader needs no structural change — its only
  per-kind seam (`editableCardKinds: ["note"]`) is already correctly typed against the canonical
  `CardKind` and is an A4/A9 policy knob, not an A8 wart.
- **Findings: 7.** Confidence: **high** on the print plumbing (small, fully read), **high** on the
  "no per-kind switch" architectural claim (grep-confirmed zero card-kind branches across all four
  files), **medium** on the precise visual intent of the dead print-strip selectors (the deep fix
  is clear; the exact desired print appearance of an appendix card header is a Gabriel call).

---

## 1. Current reality (code-derived, EXACT file:line) — against the finished foundations

### 1.1 Print is panel-derived, reusing the live component tree (NOT a per-kind switch)

- **`src/components/PrintAppendices.tsx`** (49 lines, whole file read). A pure presentational
  shell:
  - `PANEL_ORDER: PrintPanelKey[]` (`:16-27`) — a hand-ordered list of 10 panel kinds.
  - Renders `PANEL_ORDER.filter(k => options.panels[k]).map(...)` (`:35`), each as a
    `<section data-print-appendix={kind}>` with `<h2>{PANEL_REGISTRY[kind].label}</h2>` (`:42`)
    and `<div className="print-appendix-body">{renderPanel(kind)}</div>` (`:44`).
  - The label is **already registry-derived** (`PANEL_REGISTRY[kind].label`). The *set* of
    printable panels is not.
- **Mount + the `renderPanel` wiring:** `src/components/EditorPane.tsx:4256-4262`:
  ```
  {viewPrefs && (overrideEditor ?? editor) && (
    <PrintAppendices
      options={viewPrefs.prefs.printOptions}
      renderPanel={(kind: PrintPanelKey) => (
        <PaneRailBody side="left" panelKind={kind as PanelKind} ... />
  ```
  `PaneRailBody` (`EditorPane.tsx:5175`) is the **identical** component the docked rail mounts
  (`EditorPane.tsx:3267`, `:3336`). Its body is a flat `if (panelKind === "...")` dispatch to the
  per-panel host (`ExamplesHost`/`FootnotesHost`/`NotesHost`/`ReportsHost`/… — confirmed it
  handles `examples, footnotes, citations, notes, todo, archive, cutter, reports, revisions,
  errors, search, wordcount, bibliography`). **So whatever a card looks like docked, it looks like
  in print** — the per-kind card rendering is A9's, surfaced here verbatim. The `kind as PanelKind`
  cast (`:4262`) is the seam where `PrintPanelKey` is treated as a `PanelKind` subset by hand.
- **Reader doesn't render the print appendices:** the mount is gated on `viewPrefs &&` and the
  reader passes a real `readerViewPrefs`, BUT `PrintAppendices` only paints under `@media print`
  (`.print-only { display:none }`, `globals.css:4084`), and the reader never invokes `runPrint`.
  Practically inert in the reader.

### 1.2 The print orchestration + the printable-panel union

- **`src/lib/print.ts`** (119 lines, whole file read):
  - `PrintPanelKey` (`:20-30`) — an **independent hand-copied 10-member union**:
    `notes · footnotes · citations · bibliography · examples · todo · archive · revisions ·
    cutter · errors`. **NOT** `Extract<PanelKind, …>` — a parallel literal union (grep-confirmed
    no `Extract<PanelKind`). **Omits `reports`, `outline`, `search`, `wordcount`, `omni`.** Of
    those, `outline`/`search`/`wordcount`/`omni` are correctly non-appendix; **`reports` is a
    genuine gap** (it's a card panel like the others).
  - `PrintElementKey` (`:9-18`) — 9 in-text element toggles (title, citations, examples, …);
    orthogonal to cards, out of A8's card-rendering scope but part of the same print module.
  - `applyPrintAttrs` (`:49-94`) — stamps `data-print-e-<k>` / `data-print-p-<k>` on `<html>` and
    the `--print-font-size` var; the `panels` loop (`:55-57`) iterates `Object.entries`, so a
    stale key in the JSON (see §1.4) just emits a dead `data-print-p-quotations` attribute.
  - `DEFAULT_PRINT_OPTIONS` loaded from `./print.defaults.json` (`:43-45`).
- **`PrintPanelKey` is used in three `Record<PrintPanelKey, boolean>` shapes** (`PrintOptions.panels`,
  `:34`) and threaded through `useViewPrefs` / `reader-view-prefs`.

### 1.3 The print CSS — a fifth hand-synced list + three dead selectors

`src/app/globals.css` `@media print` block (`:4086-4207`):
- **Panel allowlist (`:4186-4197`)** — a hand-written 10-selector list
  `html[data-print-p-notes="true"] [data-print-appendix="notes"], …` enumerating the **same 10
  panels** as `PrintPanelKey` (again **no `reports`**). This is the **fifth** place the printable
  set is hand-maintained (union + `PANEL_ORDER` + `print.defaults.json` + `PrintDialog.PANEL_ROWS`
  + this).
- **DEAD selector — `[data-print-appendix] [data-card-id]` (`:4143`)** for `break-inside: avoid`.
  **Cards stamp `data-card-key`, never `data-card-id`** (`panel-primitives.tsx:1698`;
  grep: zero `data-card-id` producers in `src/`). So per-card page-break avoidance in appendices
  **never fires** — appendix cards split across page boundaries.
- **DEAD selectors — `[data-print-appendix] [data-pop-button]`, `[data-close-button]`,
  `.panel-header-controls` (`:4204-4206`)** meant to hide popout/close/header controls in print.
  **All three have zero producers in `src/`** (grep-confirmed). The real DOM is: the docked card
  header (`panel-primitives.tsx:1717-1739`) renders `CardDragHandle` (the 6-dot grip),
  `headerTrailing` (collab claim pill / presence dots / AI checkbox), and — only when
  `isPoppedOut` — `CardJumpChevron` + `CardPopoutButton`. The close button is the shared
  `PopoutButton` (`POPOUT_BUTTON_CLASS = "iconbtn-sm"`, `panel-primitives.tsx:1148`) — **no
  `data-pop-button`/`data-close-button` attribute exists.** So print appendices currently show the
  docked drag-grip + collab pills uncleaned.

### 1.4 `print.defaults.json` carries a removed panel key

`src/lib/print.defaults.json` `panels` block lists **`"quotations": false`** — a panel **deleted
between the A0/AF audits** (A0 §3.3: zero `quotation` refs survive in `src/`). `PrintPanelKey` has
no `quotations` member, so this key is dead weight: `applyPrintAttrs` emits a useless
`data-print-p-quotations="false"` attribute, and the promotion pipeline keeps re-shipping it. Same
class as the `release_prefs_snapshot_gotcha` memo (stale snapshot keys promoted blindly).

### 1.5 The PrintDialog — a fourth hand-synced printable list

`src/components/PrintDialog.tsx:59-70`: `PANEL_ROWS: { key: PrintPanelKey; label: string }[]` — a
hand-written list of the 10 printable panels with **hand-written labels** ("Footnotes",
"Bibliography", …) that **duplicate `PANEL_REGISTRY[k].label`** and re-encode the same 10-panel
set (no `reports`). `ELEMENT_GROUPS` (`:29-57`) is the element-toggle analog (orthogonal to cards).

### 1.6 Reader chrome — the only per-kind card seam, already canonical-typed

`src/components/editor-layout/chrome-config.ts` (204 lines, whole file read):
- `EditorChromeConfig` (`:33-80`): the host-suppression shape. Two card-relevant fields:
  - **`editableCardKinds?: CardKind[]`** (`:69`) — read-only-card whitelist. **`CardKind` is
    imported from `@/panels/_shared/types`** (`:15`), which post-A0 **re-exports the canonical
    16-kind union from `@/cards/types`** (`panels/_shared/types.ts:32-35`,
    `cards/types.ts:28-44`). So this is correctly typed against the SSOT — no drift.
  - **`visiblePanelKinds?: PanelKind[]`** (`:61`) — panel whitelist; reader uses `[outline,
    footnotes, examples, citations, bibliography, notes]` (`:131-138`).
- `READER_CHROME` (`:123-140`): `editableCardKinds: ["note"]` (`:139`) — the reader's only per-kind
  card decision (only Note cards stay editable). Consumed once, correctly:
  `panel-primitives.tsx:745-748` (`cardEditable = !cardKind || !chrome.editableCardKinds ||
  chrome.editableCardKinds.includes(cardKind)`) → threaded into `RichTextField`
  (`RichTextField.tsx:81`). **This is an A4 (selection/edit-policy) / A9 (appearance) knob, not an
  A8 print/reader-plumbing wart** — flagged here only for cross-arena coherence.
- **`ActionKind` token drift (`:23-31`)** — the action-toolbar kind union still uses the **legacy
  pre-A0 tokens `"comment"` and `"cut"`** (vs the canonical `revision-comment` / `cutter-comment`).
  `CALLBACK_TO_ACTION_KIND` (`:164-174`) maps `onAddComment → "comment"`, `onCutSelection → "cut"`.
  This is a card-*creation* vocabulary (A3/A10 territory, reader gates it to `["note"]` via
  `actionToolbarKinds`), not card *rendering*, but it's a live token-drift seam in an A8-owned file
  — flag to A3/A10.

### 1.7 Reader mount — pure inheritance, no per-kind render path

`library/components/PaperRender.tsx` (250 lines, whole file read): parses `.tex` → JSON
(`:167-181`), wraps in `<DocPipeline>` (`:234`), mounts `<EditorPane editable={false}
chrome={READER_CHROME} viewPrefs={readerViewPrefs} ...>` (`:235-246`). **Zero card-kind branches**
(grep-confirmed). `reader-view-prefs.ts:221` seeds `printOptions: DEFAULT_PRINT_OPTIONS` (so a
reader tab technically *could* print, inheriting the same appendix machinery + the same `reports`
gap). This file is correctly a thin mount per `READER_INHERITANCE.md` — A8 must not add render code
here.

---

## 2. Finding — `reports` panel is unprintable (the headline A8 wart)

- **WHAT:** The Reports panel (`report` + `report-request`, a real polymorphic card panel) **cannot
  be included in print at all.** It is absent from every printable-panel list.
- **WHERE:** `PrintPanelKey` (`print.ts:20-30`); `PANEL_ORDER` (`PrintAppendices.tsx:16-27`);
  `print.defaults.json` `panels`; `PrintDialog.PANEL_ROWS` (`PrintDialog.tsx:59-70`); CSS allowlist
  (`globals.css:4186-4195`). `PANEL_REGISTRY.reports` exists (`panel-registry.ts:85`) and
  `PaneRailBody` renders it (`EditorPane.tsx` dispatch: `if (panelKind === "reports") <ReportsHost/>`).
- **WHY it's wrong:** the renderer is ready; only the print plumbing forgot it. Reports is the same
  shape as Cutter/Revisions (polymorphic, two card kinds, anchored) — those print, Reports doesn't.
  A user with report cards literally cannot get them into a printout. This is exactly the drift the
  refactor exists to kill: a kind/panel added to the registry but not to the N hand-synced satellite
  lists (here, **five** lists).
- **DEEPEST fix:** derive the printable-panel set from `PANEL_REGISTRY` (§Target). Once `PrintPanelKey`
  is `Extract<PanelKind, PrintablePanel>` (or a registry-tagged `printable: true` field) and
  `PANEL_ORDER` / `PrintDialog.PANEL_ROWS` / the CSS allowlist all derive from it, `reports` (and any
  future card panel) is printable by construction. Do **not** just add `"reports"` to five lists —
  that re-creates the class.

## 3. Finding — printable-panel set is hand-maintained in FIVE parallel sites

- **WHAT:** "Which panels can be printed, in what order, with what label, and gated by which CSS
  rule" is encoded by hand in five places that must be kept in lockstep.
- **WHERE:** (1) `PrintPanelKey` union `print.ts:20-30`; (2) `PANEL_ORDER` `PrintAppendices.tsx:16-27`
  (also owns *order*); (3) `print.defaults.json` `panels` (also owns *default on/off*); (4)
  `PrintDialog.PANEL_ROWS` `PrintDialog.tsx:59-70` (also owns the *toggle UI label*, duplicating
  `PANEL_REGISTRY[k].label`); (5) the CSS allowlist `globals.css:4186-4197`.
- **WHY it's wrong:** five-way drift surface; `reports` (§2) is the proof it already drifted. Labels
  are duplicated in (4) when (1)/`PrintAppendices` already read `PANEL_REGISTRY[k].label`. Order +
  default + label are legitimately print-specific data, but the *membership* and *label* are not.
- **DEEPEST fix:** one printable-panel descriptor (order + default + printable flag) co-located with
  or derived from `PANEL_REGISTRY`; the union, the order array, the dialog rows, and the JSON
  defaults all read from it; the CSS allowlist is **generated** from it or replaced by a single
  attribute-driven rule (§Target). Mirrors A0's "one registry, derived satellites."

## 4. Finding — three DEAD print-CSS selectors (break-inside + chrome strip never fire)

- **WHAT:** The print appendix CSS targets DOM hooks that don't exist, so (a) per-card page-break
  avoidance and (b) "strip popout/close/header controls from appendices" are both silent no-ops.
- **WHERE:** `globals.css:4143` `[data-print-appendix] [data-card-id]` (break-inside); `:4204-4206`
  `[data-print-appendix] [data-pop-button]`, `[data-close-button]`, `.panel-header-controls`.
  Real DOM: cards expose `data-card-key` + `data-card="1"` (`panel-primitives.tsx:1697-1698`); the
  close/popout control is the shared `PopoutButton`/`CardPopoutButton` with class
  `iconbtn-sm` (`panel-primitives.tsx:1148`, `:1234`) and **no data-attr**; the docked header is the
  `flex items-center gap-1 px-2 h-6` div (`:1717-1739`) with `CardDragHandle` + `headerTrailing`.
- **WHY it's wrong:** stale selectors from a pre-refactor DOM. The intent (clean, page-break-friendly
  appendix cards) is real and currently unfulfilled: appendix cards print with their drag-grip and
  collab pills and can break mid-card. This is precisely the kind of string-typed seam the AF-fix
  swept on the float side — A8 is the same class on the print side.
- **DEEPEST fix:** re-point at the real surface. Break-inside → `[data-print-appendix] [data-card]`
  (or `[data-card-key]`). Chrome strip → add a **stable, registry-blind print-strip marker** to the
  shared chrome primitives rather than enumerating selectors: e.g. mark the docked card header's
  non-content controls (`CardDragHandle`, `headerTrailing`, `CardPopoutButton`, `CardJumpChevron`)
  with a single `data-card-chrome` (or reuse a class on `POPOUT_BUTTON_CLASS` + the grip) so one CSS
  rule `[data-print-appendix] [data-card-chrome] { display:none }` strips all of it. One marker, one
  rule — no per-control selector list to drift. Coordinate the marker with A9 (it owns the card
  header chrome) and AF (`FloatChrome` / `PopoutButton` are the shared primitives).

## 5. Finding — `print.defaults.json` ships the removed `quotations` panel key

- **WHAT:** A dead panel default for a deleted panel.
- **WHERE:** `src/lib/print.defaults.json` `panels.quotations: false`.
- **WHY it's wrong:** `quotations` is not a `PrintPanelKey`; the key is inert but re-emitted by
  `applyPrintAttrs` and re-promoted by the prefs pipeline. Same gotcha class as
  `release_prefs_snapshot_gotcha`.
- **DEEPEST fix:** remove the key; once the JSON defaults are **derived/validated against the
  registry-driven printable set** (§3 fix), a stale key like this is structurally impossible (a
  build/dev assertion can reject any `panels` key not in the derived set, mirroring A0's
  `assertLifecycleCoverage`).

## 6. Finding — `PrintPanelKey` is a parallel union, not a `PanelKind` subset

- **WHAT:** `PrintPanelKey` re-declares panel literals instead of constraining `PanelKind`.
- **WHERE:** `print.ts:20-30`; the cast `kind as PanelKind` at `EditorPane.tsx:4262` papers over it.
- **WHY it's wrong:** a typo or a renamed `PanelKind` member won't error here; the cast hides the
  relationship. It's the type-level expression of the §2/§3 drift.
- **DEEPEST fix:** `export type PrintPanelKey = Extract<PanelKind, "notes" | …>` — or better, derive
  it from a registry `printable` tag: `PrintPanelKey = { [K in PanelKind]: CARD_PANEL_PRINTABLE[K] extends
  true ? K : never }[PanelKind]`. Either way the cast at `EditorPane.tsx:4262` becomes provably safe.

## 7. Finding (cross-arena flag) — `ActionKind` legacy tokens in an A8-owned file

- **WHAT:** `ActionKind` (`chrome-config.ts:23-31`) and `CALLBACK_TO_ACTION_KIND` (`:164-174`) use
  pre-A0 tokens `"comment"`/`"cut"` instead of the canonical `revision-comment`/`cutter-comment`.
- **WHERE:** `chrome-config.ts:24,28,165,169`.
- **WHY it's a flag not a fix here:** these name card-*creation* actions, not card rendering; the
  reader filters them via `actionToolbarKinds: ["note"]`. They live in an A8-owned file but the fix
  belongs to A3 (creation pipeline) / A10. Recorded so A3/A10 reconcile the tokens against the SSOT.
- **DEEPEST fix (A3/A10):** map action buttons → canonical `CardKind` (or a dedicated creation-intent
  enum that references the registry), retiring the bespoke `comment`/`cut` literals.

---

## Target design — the deepest-fix shape

**Principle:** A8 has *no per-kind card renderer to consolidate* — print and reader already inherit
the registry-driven card body from A0/A9 through the live panel tree. The A8 deep fix is therefore
entirely at the **printable-panel-set** layer: collapse the five hand-synced lists to one
registry-derived source, and re-point the dead print-CSS seams at the real shared DOM.

1. **One printable-panel descriptor, registry-co-located.** Add a small print facet to the panel
   registry (or a sibling table keyed by `PanelKind`): `{ printable: boolean; printOrder: number;
   printDefault: boolean }` for the card-bearing panels. `PANEL_REGISTRY[k].label` already supplies
   the print heading and the dialog label.
   - `PrintPanelKey` ← `Extract<PanelKind, printable panels>` (or the mapped-type derivation, §6).
   - `PANEL_ORDER` ← `PANEL_REGISTRY` panels with `printable`, sorted by `printOrder`.
   - `PrintDialog.PANEL_ROWS` ← same source; label from `PANEL_REGISTRY[k].label` (delete the
     hand-written labels).
   - `print.defaults.json` `panels` ← validated against the derived set (dev assertion rejects
     unknown/stale keys → kills the `quotations` class structurally).
   - **`reports` becomes printable by construction** (give it `printable: true`).
2. **CSS allowlist — generated or attribute-collapsed.** Either (a) generate the
   `html[data-print-p-<k>="true"] [data-print-appendix="<k>"]` block from the derived set at build
   time, or (b) collapse to **one** rule keyed off a `data-print-enabled` attribute that
   `applyPrintAttrs` stamps per enabled appendix (preferred — no per-panel CSS at all). Removes the
   fifth hand-synced list.
3. **Fix the dead print-strip + break-inside selectors (Finding 4).** Break-inside →
   `[data-print-appendix] [data-card]`. Chrome strip → one `data-card-chrome` marker on the shared
   non-content header controls (`CardDragHandle` + `headerTrailing` + `CardPopoutButton` +
   `CardJumpChevron`), stripped by a single rule. This is the A8↔A9↔AF seam: the marker lands on the
   shared chrome primitives (A9 owns the docked header; AF owns `PopoutButton`/`FloatChrome`).
4. **Reader: no structural change.** `READER_CHROME`'s `editableCardKinds`/`visiblePanelKinds` stay
   declarative knobs; both are correctly typed against the canonical unions post-A0. Any new reader
   per-kind behavior continues to flow through chrome flags per `READER_INHERITANCE.md` — never a
   render branch in `library/components/`.
5. **Consume the foundations, don't duplicate them.** Print/reader card bodies render via
   `PaneRailBody` → per-panel host → `PanelCard` (A9 typography/C1) → A0 `CARD_REGISTRY` theming.
   A8 adds **zero** card-kind knowledge; it only decides *which panels* print and *how appendix
   chrome is cleaned*.

---

## Keystroke sanctity — no risk

- **No A8 surface adds an `editor.on('update'|'transaction')` subscriber.** `PrintAppendices`,
  `print.ts`, `chrome-config.ts`, `PaperRender.tsx` are all static/presentational. The proposed
  registry-derived printable set is a static table read at module load — O(1), no doc walk.
- **Print renders the live panel tree on demand** (only inside `runPrint` / `@media print`), reusing
  `PaneRailBody`, whose card-source data already gates on `useStructuralRevisions` + the reactive
  `editor` per AGENTS.md (it is the *same* component as the docked rail). A8 touches none of that
  derivation path.
- **No card-source memo, no update-counter, no per-keystroke proportional work** is introduced or
  moved. The CSS-allowlist collapse and the print-strip marker are pure presentation.
- **None of the sanctioned `editor.on('update')` subscribers is touched by this arena.**
- **Verify (impl):** `window.__virgilBusStats().emitCount` flat while typing with a doc open — A8
  changes are invisible to the bus by construction (no live re-derivation added).

---

## Fragmentation table

| Surface | File(s) (`file:line`) | Disposition |
|---|---|---|
| Printable-panel union | `src/lib/print.ts:20-30` (`PrintPanelKey`) | **DERIVE** from `PANEL_REGISTRY` (`Extract<PanelKind, printable>` or registry `printable` tag); add `reports` by construction |
| Print appendix order + section render | `src/components/PrintAppendices.tsx:16-27` (`PANEL_ORDER`), `:35-44` | **DERIVE** `PANEL_ORDER` from registry `printOrder`; keep the `PANEL_REGISTRY[k].label`-driven `<section>` shell (already registry-correct) |
| Print mount + `renderPanel` → live panel tree | `src/components/EditorPane.tsx:4256-4262` | **KEEP** (this IS the inheritance — print reuses `PaneRailBody`); the `kind as PanelKind` cast becomes provably safe once the union is derived |
| Print default on/off + stale `quotations` key | `src/lib/print.defaults.json` (`panels`) | **DERIVE/VALIDATE** against the printable set; **DELETE** `quotations`; add `reports` |
| Print toggle UI rows + duplicated labels | `src/components/PrintDialog.tsx:59-70` (`PANEL_ROWS`) | **DERIVE** rows from the printable set; **DROP** hand-written labels → use `PANEL_REGISTRY[k].label` |
| Print CSS panel allowlist (5th hand-synced list) | `src/app/globals.css:4186-4197` | **GENERATE** from the set, or **COLLAPSE** to one `data-print-enabled`-driven rule |
| Print CSS break-inside (DEAD `[data-card-id]`) | `src/app/globals.css:4143` | **REPOINT** to `[data-print-appendix] [data-card]` |
| Print CSS chrome-strip (DEAD selectors) | `src/app/globals.css:4204-4206` | **REPLACE** with one `[data-print-appendix] [data-card-chrome]` rule + a shared `data-card-chrome` marker on header controls (A9/AF seam) |
| Reader mount (inheritance) | `library/components/PaperRender.tsx:235-246` | **KEEP** — thin mount; no per-kind render path (READER_INHERITANCE) |
| Reader per-kind editability gate | `src/components/editor-layout/chrome-config.ts:69,139`; consumer `panel-primitives.tsx:745-748` | **KEEP** — declarative, canonical-typed `CardKind`; A4/A9 own its semantics |
| Reader visible-panel whitelist | `chrome-config.ts:61,131-138`; `filterPanelKinds` `:197-204` | **KEEP** — declarative `PanelKind`; no card-kind drift |
| Action-toolbar kind tokens (legacy `comment`/`cut`) | `chrome-config.ts:23-31,164-174` | **FLAG to A3/A10** — card-creation vocabulary drift in an A8-owned file; reconcile to canonical `CardKind` |
| Reader print inheritance (latent `reports` gap) | `src/components/editor-layout/reader-view-prefs.ts:221` | **KEEP** (seeds `DEFAULT_PRINT_OPTIONS`); inherits the §2 fix automatically |

---

## Definition of Done for this arena

1. **Printable-panel set is registry-derived** — one source (a `PANEL_REGISTRY` print facet or a
   single derived table); `PrintPanelKey`, `PANEL_ORDER`, `PrintDialog.PANEL_ROWS`, the JSON
   defaults, and the CSS allowlist all read from it. Adding a printable card panel = one registry
   field, no edits to the four other lists.
2. **`reports` prints** — appears in the print dialog, the appendix output, and the CSS allowlist,
   with its `report` + `report-request` cards rendered via the live `ReportsHost` exactly as docked.
3. **Print CSS hooks live** — break-inside avoidance fires on real appendix cards (`[data-card]`);
   the appendix chrome-strip hides the docked drag-grip / collab pills / popout-close via a single
   real marker, not three dead selectors.
4. **No stale print keys** — `quotations` removed; a dev/build assertion rejects any `panels` key
   outside the derived printable set.
5. **`PrintPanelKey` is provably a `PanelKind` subset** — the `kind as PanelKind` cast at
   `EditorPane.tsx:4262` is justified by the type, not asserted.
6. **Cross-surface coherence (DoD#5, print+reader leg) verified** — for every card kind, its print
   appendix appearance and its reader appearance match its docked appearance (because all three are
   the same `PanelCard`/host render); confirmed by a dev-preview walk on `doc_devtest` covering at
   least one kind per panel (incl. `reports`).
7. **Reader stays pure inheritance** — no per-kind render path added under `library/components/`;
   any reader divergence remains a `READER_CHROME` flag or a `useReaderViewPrefs` shim.
8. **C1 borrowed-content carries into print/reader** — links/atoms/nested-footnote phenomena in
   borrowed-content cards (footnotes, examples, cutter excerpts, revision-suggestion) render
   display-only in print appendices and the reader, with in-text-only chrome (citation chip border,
   etc.) stripped by the existing `@media print` element rules (`globals.css:4160-4180`). Coordinate
   the exact stripped set with A9.
9. **Keystroke sanctity intact** — `__virgilBusStats().emitCount` flat on plain typing; no new
   subscriber or update-counter introduced (trivially true — A8 is presentation-only).

---

## Open questions for the human

1. **(reports — confirm scope)** Should the `reports` panel be printable (it's the only card panel
   excluded today)? A8 recommends **yes** — it's a card panel like Cutter/Revisions and the
   exclusion looks like drift, not intent. Confirm before the registry `printable` defaults are set.
2. **(appendix card chrome in print)** What should an appendix card's header look like in print —
   label only (strip grip + collab pills + popout/close), or label + nothing (strip the whole
   24px header bar)? The dead selectors *intended* to strip the controls but kept the bar. A8's
   pick: strip all non-content controls (grip, collab pills, popout/close, jump) via one
   `data-card-chrome` marker, keep the kind label + body. Confirm the desired print appearance.
3. **(CSS allowlist — generate vs. collapse)** Prefer (a) build-generating the per-panel CSS
   allowlist from the registry, or (b) collapsing to one `data-print-enabled`-driven rule (A8's
   pick — no per-panel CSS, fewer moving parts)? Either kills the fifth hand-synced list.
4. **(print facet home)** Put the print facet (`printable`/`printOrder`/`printDefault`) **on
   `PANEL_REGISTRY` entries** (co-located, one table) or in a **sibling `print-panels.ts` table
   keyed by `PanelKind`** (keeps the panel registry lean, print logic self-contained)? A8 leans
   sibling table — print order/default are print-specific, not general panel metadata — but defers.
5. **(ActionKind tokens)** Confirm the `chrome-config.ts` `comment`/`cut` action-token drift is
   A3/A10's to reconcile (A8 only flags it). It's load-bearing for the reader's `["note"]` filter,
   so a rename must be coordinated, not done casually in A8.

---

## Cross-arena seams

- **A0 (spine SSOT) — `PANEL_REGISTRY` + predicates.** A8's registry-derived printable set consumes
  `PANEL_REGISTRY` (`src/panels/panel-registry.ts`) and, for per-panel card membership, A0's
  `cardKindsForPanel(panel)` (`src/cards/predicates.ts`). The print facet is the natural home for a
  `printable` flag mirroring A0's pattern. Shared surface: `panel-registry.ts`, `src/cards/predicates.ts`.
- **A9 (appearance & typography) — the docked card header chrome + C1 borrowed-content.** A8's
  print chrome-strip marker (`data-card-chrome`, Finding 4) lands on the **docked card header
  controls** that A9 owns (`panel-primitives.tsx:1717-1739`: `CardDragHandle`, `headerTrailing`,
  `CardKindHeader`, `CardJumpChevron`, `CardPopoutButton`). C1 borrowed-content (footnotes/examples/
  cutter/revision-suggestion rendering links/atoms display-only) must carry faithfully into print +
  reader — A8 owns verifying it there; A9 defines the class. Shared surface:
  `panel-primitives.tsx:1717-1763`, `globals.css:4140-4206`.
- **AF (Floatable presence) — `PopoutButton` / `FloatChrome` / `data-card-key`.** The close control
  the print CSS tries (and fails) to strip is AF's shared `PopoutButton`
  (`panel-primitives.tsx:1148`); the real DOM key is AF's `data-card-key`
  (`panel-registry.ts:252-258`, `cardPopKey`/`cardDomSelector`). A8's break-inside re-point uses
  `data-card`/`data-card-key`. Print never floats cards (floats are `display:none` in print,
  `globals.css:4150-4151`), so A8 only touches AF at the shared-primitive marker level. Shared
  surface: `panel-primitives.tsx:1148-1264`, `panel-registry.ts:252-258`.
- **A5 (omni) — coherence sibling, no shared file.** A5 owns the omni leg of DoD#5; A8 owns
  print+reader. No shared file; the coherence guarantee is jointly satisfied because both inherit
  the same `PanelCard` render. Note only.
- **A3 (creation) / A10 (cross-cutting) — `ActionKind` token drift.** The legacy `comment`/`cut`
  action tokens in `chrome-config.ts:23-31,164-174` are creation-vocabulary; A3/A10 reconcile them
  to the canonical `CardKind`. Shared surface: `chrome-config.ts:23-31,164-174`.
- **A1 (gardening) — dead CSS selectors.** Findings 4 + 5 (dead `[data-card-id]`/`[data-pop-button]`/
  `[data-close-button]`/`.panel-header-controls` selectors + the stale `quotations` JSON key) are
  gardening-flavored; A8 fixes them as part of making print chrome-stripping actually work, but A1
  may also sweep them. Coordinate so they're not double-removed. Shared surface: `globals.css:4143,
  4204-4206`, `print.defaults.json`.

---

## Stale-ref corrections

Refs from the SSOT / A0 / AF audits, re-pinned against `HEAD = 588ae7e`:

- **SSOT §7 A8 key files** list `PrintAppendices.tsx`, `print.ts`, `chrome-config.ts`,
  `PaperRender.tsx` — **all current and correct** (verified: 49 / 119 / 204 / 250 lines
  respectively). No path drift.
- **AF audit §1.2 lists `QuotationGroupCard.tsx`** (Quotations panel float wrapper) — **stale**
  (Quotations deleted, A0 §3.3). The A8-relevant residue is the **`"quotations": false` key still
  in `print.defaults.json`** (Finding 5) — the panel's last live footprint, in an A8 file.
- **A0 audit §2.1 "Quotations deleted, zero `src/` refs"** — confirmed for `src/` *code*, but the
  **`print.defaults.json` `panels.quotations` key survives** (data, not a TS ref) — A8 Finding 5.
- **A0/AF "cards stamp `data-card-key`"** — confirmed (`panel-primitives.tsx:1697-1698`,
  `panel-registry.ts:252-258`). This is exactly what makes the print CSS's **`[data-card-id]`**
  (`globals.css:4143`) dead — A8 Finding 4.
- **`CardKind` canonical home** — moved to `src/cards/types.ts:28-44` (A0); `chrome-config.ts:15`
  imports it via the `@/panels/_shared/types` re-export (`panels/_shared/types.ts:35`). Both current.
- **`PrintPanelKey` location** — `src/lib/print.ts:20-30` (current). The SSOT's `data-print-p-*`
  print-attr scheme (`print.ts:55-57`) and the CSS allowlist (`globals.css:4186-4197`) are current.
- **`renderPanelWithChrome`** (named in `PrintAppendices.tsx:10` doc comment) — the live helper is
  `PaneRailBody` (`EditorPane.tsx:5175`); the comment's name is aspirational/legacy. The actual
  print `renderPanel` passes `PaneRailBody` directly (`EditorPane.tsx:4259-4262`). Minor doc-comment
  drift (note, not a fix).
