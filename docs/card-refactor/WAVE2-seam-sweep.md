# WAVE2 Seam-Sweep — cross-arena reconciliation of the Wave-2 audits

> Cross-cutting reconciliation of the nine Wave-2 read-only arena audits
> (`{A1,A2,A3,A4,A5,A6,A8,A9,A10}-audit.md`) against the two landed foundations
> (A0 `CARD_REGISTRY` at `src/cards/`, AF `Floatable` at `src/floats/`, both merged `e279864`).
> **Owner:** the management session. **This doc is the only write of the seam-sweep chip.**
> Pinned to `HEAD = 588ae7e` (2026-06-09). Every arena audit was re-pinned to the same HEAD,
> so their `file:line` agree; where two audits cite the same surface differently it is noted as a
> CONFLICT, not a drift.
>
> Purpose: drive Wave-3 implementation sequencing. Read together with `CARD-SYSTEM-REFACTOR.md`
> (Decisions, Chip Ledger, wave gates, §7 arenas). **All nine target arenas audited; no audit
> failed; A0/AF foundations are landed and out of Wave-2 audit scope.** Gaps are completeness gaps
> in coverage, called out in §4.

---

## 0. The picture in one paragraph

The dominant cross-arena theme is **registry-derivation debt**: A0 built the predicates
(`isAnchoredCardKind`, `panelForCardKind`, `cardKindsForPanel`, `CardMeta.{markerType,themeKey,panel,
lifecycle}`) but **almost no Wave-2 consumer adopted them yet** — `isAnchoredCardKind` has **zero
consumers** (verified), and four arenas (A2/A3/A4/A6) each still read a *different* hand-kept
kind-enum that A0 was supposed to retire (`ANCHORED_CARD_KINDS`/`EntityKind`, the pristine 6-token
enum, `AnchoredCardRef.kind`, `MarkerType`/`MarginItemKind`). The second theme is **a small number of
intensely-shared files** — `panel-primitives.tsx` (every body/header/lift/collab edit lands here),
`anchored-card-store.ts` (A4 owns, A2/A5/A6 type-depend), `entity-hover.ts` (A2 owns, A4/A6
type-depend), `cards/floats/index.tsx` (AF/A9/A10 all populate slots), `EditorPane.tsx` +
`card-creation.ts` (A1/A3 both edit `popCardAtAnchor`), `cards/types.ts` + `card-registry.tsx`
(A2/A3/A6/A8/A9/A10 all want new fields). The third is a **clean wave gate**: A4's selection⟂expansion
split is the keystone — A5 reflow, A9 compressed-body, and A6 marker-select all consume A4's expansion
signal, so A4 must land before them. Nothing here forces a re-design of the foundations; it is all
consumer-side adoption + a handful of new `CardMeta` fields.

---

## 1. CROSS-ARENA SEAMS

Each seam: the arenas that touch one surface and must agree, the shared surface (`file:line`), and the
RESOLUTION (owner + land order). Grouped by the four dense clusters the brief named, then the rest.

### Cluster A — card body + header (A4 expansion ⟂ A5 omni reflow ⟂ A9 typography/morph/borrowed)

**SEAM A-1 — `panel-primitives.tsx` is the single most-contended file.** A4 (expand chevron + popout
button in the unified header, body-click policy, lift-contract cleanup, `compressed` docstring), A9
(morph chevron in the same header, `bodyClass` typography, borrowed-body renderer, `CardKindHeader`),
A10 (collab trailing, `CARD_THEMES`, `CardChromeTrailing`, the `ai`/`error` literal-Tailwind bodies),
and A8 (the `data-card-chrome` print-strip marker on the header controls) **all edit the unified card
header / `EditableCard` / `PanelCard`**.
- Shared surface: `src/components/panel-primitives.tsx` — unified header `:1712-1739`; `EditableCard`
  body mount `:943-959`; `CardKindHeader`/`CardKindDropdown` `:320-411`; lift gesture `:1574-1692`;
  `CardChromeTrailing` `:78-104`; `CARD_THEMES` `:212-239`; `compressed` docstring `:692-693`.
- RESOLUTION: **A9 owns the header structure** (it is rebuilding the header for `bodyClass` + the morph
  chevron). **A4 owns the two new header controls** (expand chevron, popout button) and the
  body-click/lift logic. Land order: **A4 first** (it splits the interaction axes the header controls
  bind to and removes the stale `isCollapsed` lift clause), **then A9** (adds the morph chevron beside
  A4's expand chevron — they coexist in the header; see A-3), **then A10** (collab-trailing unify +
  theme; touches the same file but a disjoint region — `CardChromeTrailing`/`CARD_THEMES`, not the
  header-control row), **then A8** (adds the `data-card-chrome` marker last, after A9/A10 have
  finalized which controls exist). Serialize A4→A9; A10 can overlap A9 only if it stays in the
  collab/theme region (risk: merge churn — recommend serialize A9→A10 too).

**SEAM A-2 — the compressed/expanded display axis.** A4 owns *when* a card's height changes (the
`expandedSet` axis); A9 owns *what* the compressed body looks like (borrowed→clipped `BorrowedMainText`
vs sans→summary string); A5 owns *what the omni column does* when the height changes (reflow).
- Shared surface: each card's `const compressed = !isExpanded && !isPoppedOut` (e.g. `NoteCard.tsx:86`,
  +12 sites); `makeCompressedSummary` / manual `.replace().trim()` (A9 §5); `useInTextPositions.ts:414-417`
  (A5 re-pack memo, deps `[measureVersion, items, pinned]`); A4's new `expandedSet` in
  `anchored-card-store.ts`.
- RESOLUTION: **A4 defines the expansion signal** (`useIsExpanded` over the new `expandedSet`).
  **A9 reads it** for the compressed-body class (must NOT re-derive or couple to selection — N1).
  **A5 re-packs on it** (the reflow trigger keys off the expansion event, not the selection id).
  Land order: **A4 → {A9, A5}**. A9 and A5 are parallel-safe *after* A4 (different files:
  `panel-primitives.tsx`/`*Card.tsx` vs `OmniViewPanel.tsx`/`useInTextPositions.ts`), provided both
  consume A4's `useIsExpanded` rather than the legacy `transient`/`selected` prop.

**SEAM A-3 — two chevrons in one header (expand vs morph).** A4 adds a one-click **expand** chevron to
the docked unified header; A9 adds a **morph** chevron (kind-dropdown) to the *same* header, and to the
popped `FloatChrome.titleNode` (`chromeSlots.title`) slot.
- Shared surface: `panel-primitives.tsx:1712-1739` (docked header) + `CardKindHeader` `:320-411`;
  popped slot `FloatWindow.tsx:163` → `FloatChrome.tsx:54-55` (`titleNode`); `cards/floats/index.tsx:406-449`.
- RESOLUTION: **placement is A9's call, coordinated with A4.** The morph chevron lives in the
  *title/kind-label* slot (it's the kind affordance); the expand chevron is a *body-display* affordance
  (left of the label or as the collapse caret). **Popped cards are always full-body**, so the expand
  chevron is **docked-only** — `FloatChrome.titleNode` carries the morph chevron alone, no expand
  control. This cleanly separates the two slots and is already how AF reserved them (A4 §cross-seam,
  A9 §1.4 agree). Land order: A4 (expand chevron) before A9 (morph chevron) so A9 places the morph
  control relative to a known expand-control position.

**SEAM A-4 — cross-surface display knobs (docked vs omni compression).** A5 found the same card renders
`compressedLines:2` in omni but `1` docked (silent default); A9 owns the actual numbers + the two
typography classes.
- Shared surface: `OmniViewPanel.tsx:356` (omni `CardDisplayProvider` value) vs the absent docked
  provider (`card-display.tsx:32` default 1); `panel-typography.ts:43-54` (A9's `DEFAULT_PANEL_TYPOGRAPHY`).
- RESOLUTION: **A5 lands the `CardDisplayProvider` *symmetry*** (both docked and omni declare an
  intentional value); **A9 owns the *numbers*** (the `compressedLines` value + the `bodyClass`-derived
  font). They share the `CardDisplayContextValue` seam. Land order: A9's `bodyClass` is foundational
  to the number; recommend A9 lands the typography scale, then A5 declares the providers consuming it.
  Low coupling (different files) — can be sequenced either way as long as the number is agreed.

### Cluster B — anchoring (A2 anchoring ⟂ A5 unanchored reflow ⟂ A6 marginalia positioning)

**SEAM B-1 — `EntityKind` / `ANCHORED_CARD_KINDS` is read by A2, A4, A6 and must become one
registry-derived source.** A2 owns retiring the hand-kept array (its F1 *headline*); A4 types its store
on `AnchoredCardRef.kind: EntityKind`; A6 types `MarginaliaMarker.entityKind` on `EntityKind`.
- Shared surface: `src/links/_shared/entity-hover.ts:22-38` (the hand-kept `ANCHORED_CARD_KINDS` array
  + `EntityKind` union — **verified still hand-kept; `isAnchoredCardKind` has zero consumers**);
  consumers `anchored-card-store.ts:36` (A4), `marginalia.ts:111-112` (A6),
  `usePanelCardHoverBridge.ts:16,22`.
- RESOLUTION: **A2 OWNS this fold** (`ANCHORED_CARD_KINDS = CARD_KINDS.filter(isAnchoredCardKind)`;
  `EntityKind = CardKind` or a branded subset; dev assertion pins derived === registry). A4 and A6 are
  **pure type-consumers** — they keep importing the *name* `EntityKind`, which becomes registry-backed,
  so they need **no edit** for this fold (a free win once A2 lands). Land order: **A2 lands B-1 before
  or independently of A4/A6**; A4/A6 only need it landed, not co-edited. This is the cleanest
  high-value seam — one A2 change satisfies three arenas' "stop hand-keeping the enum" need.

**SEAM B-2 — orphaned-vs-free anchor state surfaces in omni (A2 model ⟂ A5 render).** A5's B3 reflow
found that a card whose anchor UUID no longer resolves (`findParagraphPos → null`) lands in the same
`pos == null` bucket as a genuinely-unanchored card, indistinguishable.
- Shared surface: `omni-host.tsx:290-305` (`findParagraphPos` null path); `Notes/omni.tsx:75-79`;
  A5's proposed `OmniItem.anchorState: "anchored"|"free"|"orphaned"` (`panels/_shared/types.ts:38-46`);
  A2's orphan guards (`linked-anchor.ts:78,153,196`).
- RESOLUTION: **A2 owns orphan *detection semantics*** (it owns the anchor model + the three orphan
  guards); **A5 owns the omni *rendering* of the resulting band** (the `anchorState` field on
  `OmniItem`, the `OrphanBadge`). A5 needs A2 to expose the orphan/free distinction; A2's resolution
  doesn't require A5. Land order: **A2 (or a thin A2 export) before A5's orphan band**, but A5 can ship
  the single-cascade reflow (its core fix) *without* the orphan distinction and add `anchorState` once
  A2's semantics are pinned. Low blocking risk.

**SEAM B-3 — marker positioning vs the omni cascade (A6 ⟂ A5) — the live-position division of labor.**
A5's `resolvePos` covers only footnote/citation/example (entity-anchored kinds whose primary viz is the
in-text-aligned omni card); paragraph-anchored kinds (note/todo/archive) source live position from the
**marginalia gutter** instead. If A6 changes how those kinds source live position, A5's `resolvePos`
coverage decision must stay in sync.
- Shared surface: `OmniViewPanel.tsx:318-322,333-337` (A5 covered-kinds comment); `EditorPane.tsx:1495`
  (A6's live marker builder); both gate on `useStructuralRevisions` (`rev.anchors`/`rev.blocks`).
- RESOLUTION: **A6 owns the gutter live-position source; A5 owns the omni cascade source.** They are
  *parallel* surfaces that must not diverge on *which kind sources where*. No co-edit required — a
  documented invariant ("entity-anchored kinds → omni `resolvePos`; paragraph-anchored kinds → gutter").
  Both must preserve the keystroke-time snapshot-identity-gated cache (no per-keystroke `coordsAtPos`
  storm). Independent; coordinate only the covered-kind list if either changes it.

### Cluster C — lifecycle ⟂ registry declarations (A3 ⟂ A0 [landed])

**SEAM C-1 — the 5 declared lifecycle gaps + the cascade criterion.** A0 declared
`todo/archive/example/report/report-request` as `{clone:false,delete:false,bindAnchor:false}` "for A3
to fill"; A3 ruled **4 of 5 are correctly *permanent* gaps** (Mode-A / derived kinds the cascade walker
can't reach), only `archive`-delete-cascade is a live decision.
- Shared surface: `card-registry.tsx:125,139,241,255,269` (the 5 gaps); `card-lifecycle-registry.tsx:128`
  (`assertLifecycleCoverage`); the walkers `duplicate-slice.ts:127-152`, `delete-range.ts:127-150`
  (Mode-B + inline-atom only).
- RESOLUTION: **A3 owns the lifecycle ratification + documentation** (not a "fill"). A0 is landed;
  A3 only edits doc-comments + (if archive flips) one registry flag + a new Mode-A cascade mechanism.
  No co-edit with the landed foundation beyond the registry flag. **Self-contained in A3** — the only
  external dependency is Gabriel's archive-delete ruling (Ratification Q below).

**SEAM C-2 — `CardFloatCtx` / `PoppedCardDeps` field set (A1 relocation ⟂ A3 creation ⟂ A2 entity bag).**
A1's §8 relocates `PoppedCardDeps` → `src/cards/card-float-ctx.ts` (completing A0's half-done re-home);
A3's creation pipeline consumes `CardFloatCtx`; A2 wants to retire its parallel `EntityCollections`
bag *onto* `CardFloatCtx`.
- Shared surface: `editor-layout/floating-cards.tsx` (the type-only residual A1 deletes);
  `src/cards/card-float-ctx.ts:14`; `EditorPane.tsx:126`; A2's `entity-hover.ts:45-61`
  (`EntityCollections`).
- RESOLUTION: **A1 does the *relocation* (mechanical, file move)**; **A2 does the *unification***
  (`findEntity(ctx: CardFloatCtx)`, retire `EntityCollections`); **A3 *consumes* the result.** Land
  order: **A1 relocation first** (it's a pure move, unblocks the canonical home), **then A2**
  (folds `EntityCollections` onto the now-canonical `CardFloatCtx`), with **A3 sequenced after/alongside**
  (it reads the ctx in `card-creation.ts`). Three arenas touch this type — serialize A1→A2→A3 on
  `card-float-ctx.ts`.

### Cluster D — cross-cutting (A10 theming/collab/AI/persistence) threading through all

**SEAM D-1 — `themeKey` as the universal accent + collab-scope + marker-theme accessor.** A10 wants
`CARD_REGISTRY[k].themeKey` to be the single accent accessor; A6 wants the same `themeKey` to replace
its two hand-kept marker→theme maps; A2 reaches the theme-key edge via `entityKindToAnchorKind` →
`MARKER_KIND_TO_THEME_KEY`; A9 owns the theme/typography appearance.
- Shared surface: `panel-theme.ts:14-25` (`PanelThemeKey`); `CARD_THEMES` `panel-primitives.tsx:212-239`;
  `MARKER_TO_THEME_KEY` `Marginalia.tsx:44-50` + `MARKER_KIND_TO_THEME_KEY` `EditorLayout.tsx:80-88`
  (A6); `entity-hover.ts:130-144` (A2).
- RESOLUTION: **A10 owns the accent SSOT** (`ai`/`error` folded into `DEFAULT_PANEL_COLORS` as a
  non-overridable `SYSTEM_THEME_KEYS` set; `CARD_REGISTRY[k].themeKey` the universal accessor). **A6
  consumes it** to kill its two marker-theme maps. **A2 consumes it** for `entityKindToAnchorKind`.
  **A9 consumes it** for card appearance. Land order: A10's accent fold is foundational to A6's
  marker-theme derivation — recommend **A10 lands the `themeKey`-as-accessor discipline early** (it's a
  small, low-risk, high-leverage change), then A6/A2/A9 consume. (A10 is *not* gated on A4/A5/A9 — it
  can run early in parallel with A1.)

**SEAM D-2 — collab claim-scope token, matched docked↔float (A10 ⟂ A4 selection ⟂ A9 morph).** A10
keys collab on `(panelKey, cardId)` where `panelKey` is the `themeKey`-style token, hand-matched between
docked (`EditableCard`) and float (`CardChromeTrailing`); A4's selection model mirrors the same
`(scope, cardId)` identity for soft-selection presence; A9's morph flips the kind (and thus the scope).
- Shared surface: `useCollab.ts:462,524,613,699`; docked literals (`NoteCard.tsx:132` etc.); float
  literals (`cards/floats/index.tsx:101,154,180,207,256,281,403`); `CardChromeTrailing`
  `panel-primitives.tsx:78-104`; A4's `updateSelection`/`getCardSelections` mirror.
- RESOLUTION: **A10 owns deriving the collab scope from the registry** (`collabClaimScope(kind) =
  CARD_REGISTRY[k].themeKey`, typed, one source docked+float). **A4 must keep its selection-identity
  pair `(scope, cardId)` aligned** with A10's derived scope (shared concept, not a co-edit). **A9's
  morph** must re-derive the scope on a kind-flip (a morph that changes `themeKey` changes the claim
  scope — A10 + A9 coordinate that the float's collab pill follows the morph, same as
  `remapCardPopKey` follows the key). Land order: A10 derives the scope; A9's morph + A4's selection
  consume the derived value. A10 before A9's morph (so morph re-derives, not re-types).

**SEAM D-3 — `ai`/`error` card bodies: theming source (A10) vs body restyle (A9) vs dead-wiring deletion
(A1).** Three arenas edit `ErrorCard.tsx` + `AiRequestCard` (`panel-primitives.tsx:2005-2090`).
- Shared surface: `ErrorCard.tsx` (A1 deletes dead popout wiring `:11,107,110,149`; A10 fixes the accent
  source `:15,19`; A4 the `!selected`→`!expanded` outlier `:112`); `panel-primitives.tsx:230-231`
  (literal accents) + `:2021-2074` (literal-Tailwind body).
- RESOLUTION: **sequence A1 → A10 → A9 on these two files.** A1 deletes the dead popout wiring first
  (smallest, clears noise); A10 fixes the accent *source* (folds `ai`/`error` into `DEFAULT_PANEL_COLORS`);
  A9 does the *body restyle* (literal-Tailwind → `theme.*` tokens, a visible UI delta needing design
  sign-off). A4's ErrorCard `compressed` outlier rides with A4's pass (it's the `expanded` axis). All
  four arenas agree on this ordering in their own seam sections — **ratified by convergence.**

### Other seams (single-pair, lower density)

**SEAM E-1 — `popCardAtAnchor` ownership (A1 ⟂ A3) — a genuine ownership CONFLICT, see §3.** Shared
surface `EditorPane.tsx:1116-1134` + `card-creation.ts:124` + 14 callers (**33 total refs verified**).
RESOLUTION below in CONFLICTS (§3, C-1): **A3 owns it** (it's a creation-pipeline concern); A1 cedes.

**SEAM E-2 — `resolveCardKind` (deferred A0 helper) — who builds it (A2 ⟂ A0-residue).** A0 deferred
building `resolveCardKind(record, ctx)` (`predicates.ts:9-12`, **verified still a TODO, never built**);
A2 is its biggest consumer (the comment/suggestion split proliferates in `findEntity`,
`useTextHoverBridge`, `paragraphKindFor`). RESOLUTION: **A2 builds it** (A2 §F2, Open Q D) — it's the
anchor layer's residue. A9's morph also touches the comment/suggestion split but consumes A2's helper.
Shared surface: `src/cards/predicates.ts:9-12`. Land in A2.

**SEAM E-3 — print chrome-strip marker on the shared header (A8 ⟂ A9 ⟂ AF).** A8 needs a
`data-card-chrome` marker on the docked header's non-content controls (grip, collab pills, popout/close,
jump) so one print CSS rule strips them. A9 owns the docked header; AF owns `PopoutButton`/`FloatChrome`.
Shared surface: `panel-primitives.tsx:1717-1739,1148`. RESOLUTION: **A9 lands the marker** (it's
restructuring the header anyway); A8 writes the CSS rule against it. A8 after A9. (See SEAM A-1 land
order — A8 is last in cluster A.)

**SEAM E-4 — printable-panel set ⟂ `cardKindsForPanel` (A8 ⟂ A0).** A8 derives the printable-panel set
from `PANEL_REGISTRY` + a `printable` facet; `reports` becomes printable by construction. Pure
consumption of A0; no foundation edit. Self-contained in A8. Shared surface: `panel-registry.ts`,
`src/cards/predicates.ts`.

**SEAM E-5 — `linkedAnchor` mark `kind` attr removal (A2 model ⟂ A1 gardening ⟂ A6 colour).** A2 flags
the dead mark `kind` attr (`linked-anchor.ts:30`, `cardKindToLegacyAnchorKind`); A1 lands the deletion;
A6 verifies colour parity. RESOLUTION: **A2 flags, A1 lands, A6 verifies** (all three agree). Low
priority; not a correctness bug. Preserve the `"transient"` sentinel.

**SEAM E-6 — `ActionKind` legacy `comment`/`cut` tokens in an A8-owned file (A8 flags → A3/A10).**
`chrome-config.ts:23-31,164-174` uses pre-A0 tokens. A8 only flags; A3/A10 reconcile to canonical
`CardKind`. Shared surface `chrome-config.ts`. Land in A3 or A10 (creation-vocabulary).

**SEAM E-7 — marginalia dead pipeline deletion (A6 ⟂ A1 gardening).** A6 found a ~300-line dead
`marginaliaMarkers` twin in `EditorLayout.tsx:3330-3623` + dead `markers.ts` that feed nothing (the
AF-fix marker migration was verified in *dead code*). Deleting it is gardening A1 also owns. RESOLUTION:
**A6 owns the pipeline collapse** (it's a product call — Q1: port the rich Omni-first routing into
EditorPane, or delete); A1 coordinates so the deletion isn't done twice. Land in A6 (with the product
decision), not A1.

---

## 2. CONTENTION MAP (hot shared files → which arenas edit them)

Drives implementation serialization. **Bold = the file is *structurally edited* by that arena
(high conflict); plain = type-consumed or comment-only (low conflict).**

| File | Arenas that edit it | Contention notes |
|---|---|---|
| **`src/components/panel-primitives.tsx`** | **A4** (header controls, lift, body-click, docstrings), **A9** (morph chevron, `bodyClass`, `CardKindHeader`, borrowed body), **A10** (`CardChromeTrailing`, `CARD_THEMES`, `ai`/`error` bodies), **A8** (`data-card-chrome` marker), A2 (entity-hover bridge consumers, low) | **HIGHEST.** 4 structural editors. Serialize A4→A9→A10→A8. Disjoint regions help (header-controls vs collab-trailing vs theme) but merge risk is real. |
| **`src/links/_shared/entity-hover.ts`** | **A2** (owner: `ANCHORED_CARD_KINDS`/`EntityKind` derive, `findEntity`, `EntityCollections`, `resolveCardKind`, `entityKindToAnchorKind`), A4 (type-consumer `EntityKind`), A6 (type-consumer `entityKind`) | A2 sole structural editor; A4/A6 ride the result. **A2 lands B-1 → A4/A6 free.** |
| **`src/links/_shared/anchored-card-store.ts`** | **A4** (owner: split `toggleSelection`→`expand`/`select`, new `selected` slot, retire `transient`), A2 (`AnchoredCardRef.kind` type rides B-1), A5 (consumes `markSticky`/transient via omni), A6 (`MarkerButton` store-keying), A10 (selection-identity mirror) | **A4 sole structural editor.** A2/A5/A6/A10 are downstream consumers of A4's new axes. **A4 is the keystone — must land before its consumers.** |
| **`src/panels/Omni/OmniViewPanel.tsx`** | **A5** (owner: single-cascade reflow, `anchorState`, provider symmetry, stale comments), A4 (omni shares `cardStore` axes), A9 (compression number), A2 (orphan band) | A5 sole structural editor; gated on A4 (expansion signal). **A4 → A5.** |
| **`src/hooks/useInTextPositions.ts`** | **A5** (owner: extend `resolveCascade` for synthetic-top rows, measure unanchored) | A5-only. No contention. Keystroke-sane (event-gated memo). |
| **`src/cards/types.ts` (`CardMeta`)** | **A9** (`bodyClass`, `morph`), **A10** (`aiRequest?` routing field), **A6** (markerType already there; assertion), **A8** (print facet), A2 (`isInlineAtomCardKind`, `resolveCardKind` in predicates), A3 (lifecycle doc-comment) | **HIGH (additive).** Multiple arenas add fields. Low *conflict* (additive, different fields) but every add must keep `card-registry.tsx` a runtime leaf (register-at-boot pattern). Batch the `CardMeta` field adds or serialize to avoid churn. |
| **`src/cards/card-registry.tsx`** | **A9** (`morph` decls + `registerCardMorph`), **A10** (`aiRequest` decls), **A6** (markerType assertion), **A8** (print facet), A3 (the 5 gap doc-comments) | Same as `types.ts` — additive, leaf-safe register pattern. Serialize the registrations. |
| **`src/cards/predicates.ts`** | **A2** (build `resolveCardKind`, `isInlineAtomCardKind`; adopt `isAnchoredCardKind`), A6 (consume `isAnchoredCardKind`), A10 (`collabClaimScope`), A3 (`panelForCardKind` in factory tail), A8 (`cardKindsForPanel`) | A2 + A10 add predicates; others consume. Additive; low conflict. |
| **`src/components/EditorPane.tsx`** | **A3** (`popCardAtAnchor` re-type, `finishCreate`, pristine consolidation), **A1** (`popCardAtAnchor` tighten [CEDES to A3], `floating-cards.tsx` import), **A6** (live `marginaliaMarkers` builder `:1495`), A2 (lifecycle wiring), A4 (lift handoff), A8 (print mount), A10 (morph remap wiring) | **HIGH.** Huge file, many regions. A3 owns creation region; A6 owns marker-builder region; A1 cedes `popCardAtAnchor` to A3. Different line regions → moderate real conflict. Serialize A3 (creation) and A6 (markers) if both touch `:1495-1718` adjacency. |
| **`src/components/editor-layout/card-actions/card-creation.ts`** | **A3** (owner: fold `selection-to-card`, `finishCreate`, `popCardAtAnchor` callers), A1 (cedes the tightening) | A3 sole owner post-cession. |
| **`src/cards/floats/index.tsx`** | **A9** (populate `chromeSlots.title` morph for 3 more pairs), **A10** (collab `collabTrailing` derive scope; `ai` poppability), A4 (popout result path, read-only), A6 (omni routing if Q1) | A9 + A10 both edit the per-kind float builders. Different concerns (title slot vs trailing slot) but same factories. Serialize A9→A10 or coordinate slots. |
| **`src/lib/marginalia.ts`** | **A6** (owner: `MarkerType`/`MARKER_META`/`MarginItemKind` derive), A2 (`MarginaliaMarker.entityKind` rides B-1), A1 (MIME-constant gardening, deferred) | A6 sole structural editor. |
| **`src/components/EditorLayout.tsx`** | **A6** (DELETE dead marker twin `:3330-3623`), A1 (detached-toolbar state, `menuLocation`, stale comment — pending O1), A10 (`MARKER_KIND_TO_THEME_KEY`, morph remap), A3 (duplicate pristine manager deletion `:582-587,2782-2790`) | **HIGH (deletions).** A6 deletes ~300 lines; A3 deletes the duplicate pristine manager; A1 deletes `menuLocation`/`AttachedPopover`. Big subtractions in one file — **serialize A6, A3, A1** to avoid delete-on-delete conflicts. |
| **`src/lib/panel-theme.ts`** | **A10** (owner: `ai`/`error` into `DEFAULT_PANEL_COLORS`, `SYSTEM_THEME_KEYS`), A9 (consume themeKey), A6 (consume themeKey) | A10 sole structural editor. |
| **`src/lib/panel-typography.ts`** | **A9** (owner: derive from `bodyClass`, fix example/report), A5 (compression number coordination) | A9 sole structural editor. |
| **`src/app/globals.css`** | **A8** (print CSS: dead selectors, allowlist), A2 (`data-link-card`/`paragraph-kind` CSS grammar, read-only), A9 (typography), A10 (theme tokens) | A8 owns the `@media print` block; others touch disjoint regions. Low conflict. |
| **`src/hooks/useViewPrefs.ts`** | **A1** (`menuLocation` removal + read-time prefs drop), A10 (float-key migration audit, read-only), A8 (`printOptions` validation) | A1 structural; A10/A8 audit/consume. |
| **`src/components/editor-layout/card-actions/selection-to-card.ts`** | **A3** (DELETE — fold into `useCardCreation`) | A3-only. |
| **`src/hooks/usePristineCardManager.ts`** | **A3** (owner: 6-token drift enum → registry bucket, single instance) | A3-only. |

---

## 3. CONFLICTS (incompatible recommendations → management arbitration)

**C-1 — `popCardAtAnchor` ownership: A1 §9 vs A3 §7 (both claim the same fix).** A1 lists "TIGHTEN
`popCardAtAnchor` to `CardKind` + route via `cardPopKey`" as a safe-now gardening item; A3 lists the
*identical* fix as a creation-pipeline concern it owns. Both audits **explicitly flag the overlap** and
both recommend A3 own it (A1's cross-seam: "A3 owns the creation-pipeline re-typing; A1 owns leaf
deletions"; A3's stale-ref: "filed under A1 gardening but is a creation-pipeline concern owned by A3").
- **ARBITRATION: A3 owns `popCardAtAnchor`** (the re-type + `finishCreate` factory tail). A1 drops it
  from its scope. Not a true disagreement — both converge on A3; flagged here so the ledger assigns it
  to A3's chip unambiguously. **Verified 33 refs** — it's a real fan-out, belongs with the creation
  unification, not a leaf deletion.

**C-2 — `report` typography class: A9 declared-sans vs rendered-serif (internal A9 inconsistency, needs
Gabriel).** A9 found `report` is typed 12px Inter (sans) in `panel-typography.ts:52` but renders through
the serif `RichTextField` (Path A). A9 recommends "apparatus/sans" (a report is AI commentary, not
borrowed source). This is **not a cross-arena conflict** but a ratification A9 cannot self-resolve; it
affects A8 (report appendix appearance) and A6 (report marker). **ARBITRATION: defer to Gabriel
(Ratification Q7)**; A9's recommendation (sans, fix the render path) is the lean.

**C-3 — `example` lifecycle: "A3 fills" (A0/SSOT framing) vs "permanent gap" (A3 ruling).** The SSOT §7
+ A0 framed the 5 lifecycle gaps as "A3 fills"; A3 ruled `example` is a **permanent** gap (it's an
`origin:"derived"` mirror of the `exampleBlock` TextObject — card-level clone/delete would double-act,
violating "two kinds never merge"). This is a framing conflict the SSOT must absorb. **ARBITRATION: A3
is correct** — annotate `example` permanent in the registry; the SSOT's "A3 fills" overstates the work
(A3 mostly ratifies + documents). Update the SSOT Decisions on merge.

**C-4 — Omni `resolvePos` coverage vs A6 marginalia (latent, not active).** A5 covers footnote/citation/
example in `resolvePos`; A6 sources note/todo/archive live position from the gutter. If A6's pipeline
collapse (Q1) changes how paragraph-anchored kinds source live position, the two could diverge. **Not a
current conflict** — both audits agree on the division — but flagged so the impl chips keep the
covered-kind list in sync. **ARBITRATION: documented invariant, no code conflict.**

**No other incompatible recommendations found.** The nine audits are remarkably convergent — the dense
clusters (A1/A3 on `popCardAtAnchor`, A1/A6 on the marginalia dead-pipeline, A1/A10/A9 on ErrorCard,
A2/A4/A6 on `EntityKind`) all independently arrived at the *same* owner + land order, which is the
signal the seam-sweep is meant to confirm.

---

## 4. GAPS (completeness critique)

**Coverage check: all 9 target arenas audited (A1,A2,A3,A4,A5,A6,A8,A9,A10); none failed; none missing
or thin.** Each doc is 34-44 KB, re-pinned to `588ae7e`, with a fragmentation table + DoD + cross-arena
seams + open questions. No GAP from a missing/failed audit. The gaps below are *coverage seams between
arenas* and *surfaces no arena claimed*.

- **GAP-1 — Search panel's `CARD_THEMES` consumer is unowned.** A10 noted `SearchPanel.tsx:727`
  (`CARD_THEMES[SCOPE_TO_CARD_THEME[result.scope]]`) as a consumer that "must stay stable," but **no
  arena owns Search-panel card rendering.** Search is not a card panel (it's a result list) so it falls
  outside A4-A10's per-kind scope, yet it reads `CARD_THEMES`. If A10 refactors `CARD_THEMES`, the
  Search indirection must be re-verified. **Assign: A10 verifies on impl** (it's the `CARD_THEMES`
  owner). Low risk, flagged.

- **GAP-2 — `bib` card is under-covered across arenas.** `bib`/`ai`/`error` are the 3 system kinds.
  A10 covers `ai` (poppable, request surface) and `error` (theming + dead wiring). **`bib` is barely
  mentioned** — A4 (F11) flags it lives outside the axis model (bespoke `useState`, no `expanded`
  axis), A9 lists it as Path C (plain string), A10 notes its `bareWindow` float. No arena *owns* `bib`'s
  cross-surface coherence (docked/omni/float/print). It's low-traffic (a bibliography-review card) but
  the "every kind verified across every surface" DoD#5 needs a `bib` walk. **Assign: fold a `bib`
  cross-surface walk into the A9 consistency pass (C3)** — it's the appearance arena and already
  enumerates the full kind set.

- **GAP-3 — the `transient` double-duty resolution spans A4 and A5 but neither fully owns the
  click-away semantics.** A4 retires `transient` (splits selection/expansion); A5's omni `markSticky`-
  on-focus (`omni-host.tsx:209-211`) and background-click `setTransient(null)` are *consumers* of the
  same `transient` slot. A4 §F10 says "resolve in target design"; A5 §1.8 says "A4 owns it." **Risk:
  A4 retires `transient` and breaks omni's click-away/focus-sticky if A5 isn't co-updated.** **Assign:
  A4 owns the store change but MUST update the omni consumers (`omni-host.tsx`) in the same chip, or
  A5 lands immediately after** — not a free type-fold like B-1. This is the one A4→A5 coupling that
  isn't purely additive.

- **GAP-4 — non-anchored kinds (`bib`/`ai`/`error`) and the expansion axis (A4 F11 + A5).** A4 flags
  these three live outside the `anchored-card-store` (no `expanded` axis); A5's reflow assumes an
  expansion signal. An unanchored `ai`/`bib` card in omni has no `expandedSet` membership. **No arena
  resolves whether non-anchored cards get a panel-local expansion axis.** A4 §F11 defers it to
  "A10/A5 coordination"; A5 doesn't pick it up; A10 doesn't either. **GAP: the non-anchored expansion
  axis is unowned.** **Assign: A4 (it owns the axis model) decides whether to add a panel-local
  `expanded` set for non-anchored kinds, or explicitly scope them out** (Ratification Q5). Until ruled,
  `ai`/`bib`/`error` expand/collapse behavior in omni is undefined.

- **GAP-5 — A2's `findEntity` ↔ A5's omni builders both re-derive panel membership, but neither
  cross-references the other.** A2 retires `EntityCollections` onto `CardFloatCtx` and routes the
  comment/suggestion split through `resolveCardKind`; A5's per-panel omni builders
  (`Notes/omni.tsx` etc.) *also* know per-kind routing. No conflict, but **no arena checks that the omni
  builders and `findEntity` agree on the kind→collection map** after A2's unification. **Assign: A2's
  `resolveCardKind` should be the single split-resolver A5's builders also consume** — flag for A5 impl
  to adopt A2's helper, not re-switch. Minor, additive.

- **GAP-6 — print of borrowed-content (C1) carries into A8 but depends on A9's not-yet-built
  `BorrowedMainText`.** A8 §DoD#8 says C1 borrowed-content (footnotes/examples/cutter/revision-suggestion)
  must render display-only in print appendices with in-text chrome stripped — but A9's `BorrowedMainText`
  is the renderer, and A9 corrected the C1 set (cutter/revision-suggestion are **NOT** borrowed — flat
  strings). **A8's DoD#8 references the *old* C1 candidate list.** **Assign: A8 adopts A9's corrected
  borrowed set** (footnote, archive, example, +highlight-excerpt) — A8's DoD#8 should drop
  cutter/revision-suggestion. Coordinate on A9's `BorrowedMainText` landing before A8 verifies print
  fidelity.

- **GAP-7 — no arena owns the `STYLE_GUIDE.md` reconciliation, which 3 arenas flag.** A9 (two-class
  rule + morph convention + the 13px-vs-12/15px doc drift), A4 (would benefit from documenting the 2×2),
  A1 (the grip-re-introduction note). **Assign: A9 owns the STYLE_GUIDE update** (it's the appearance
  arena and already commits to it in its DoD); A4/A1 contribute their notes through A9's pass.

- **GAP-8 — the AF deferred threads (`snapshotForStack`, `bib`/`ai` → full `FloatChrome`) are gated but
  unassigned to a Wave-2 arena.** A1 §1.7 confirms the legacy stack path (`cardKeyPrefixToStackKind`/
  `resolveCardData`) is **gated on AF's deferred `snapshotForStack`** — every `Floatable.snapshotForStack`
  returns `null` today, so it's the only working stack-drop serialization. **No Wave-2 arena owns
  finishing `snapshotForStack`** (it's an AF follow-up). **GAP: the AF Stage-5/6 threads
  (`snapshotForStack` real impl, `bib`/`ai` chrome) need a Wave-3 AF-follow chip** — A1 cannot delete
  the legacy stack path until it lands. **Assign: spin a Wave-3 `AF-follow` chip** (not a Wave-2 audit
  arena) to land `snapshotForStack`, *before* A1's stack-path deletion. Flag to management.

---

## 5. IMPL SEQUENCING (Wave-3 chip ordering + batching)

**Wave gates (from the SSOT + the audits):**
- A1 gardening can land early (mostly leaf deletions) — **except** the `popCardAtAnchor` tightening
  (ceded to A3) and the stack-path deletion (gated on AF-follow `snapshotForStack`, GAP-8).
- **A4 N1 modes gates A5 reflow, A9 compressed-body, A6 marker-select** (the expansion signal).
- A9 morph chevron depends on A0 `cardKindsForPanel` (done) + AF `chromeSlots.title` (done) — **no new
  gate**, but coexists with A4's expand chevron in the header (SEAM A-3).
- A2's `EntityKind` fold (B-1) unblocks A4/A6 type-consumers (free win).
- A10's `themeKey`-accessor discipline (D-1) unblocks A6's marker-theme derivation.

### Recommended batches (parallel within a batch; serialize between batches on the contention map)

**BATCH 0 — foundation-adoption + early gardening (PARALLEL, no inter-dependencies).**
- **A1 (gardening, minus `popCardAtAnchor` + stack-path)** — `useComments`, `menuLocation`,
  `AttachedPopover`, grip-redesign dead drags, `autoFitBody`, ErrorCard dead popout wiring (coordinate
  D-3 ordering: A1's ErrorCard deletion lands *first* on that file), `floating-cards.tsx` relocation
  (C-2: A1 does the move). Leaf-file deletions; lands early per SSOT.
- **A2's B-1 fold only** (`ANCHORED_CARD_KINDS = CARD_KINDS.filter(isAnchoredCardKind)`, `EntityKind`
  derive, dev assertion) — small, high-leverage, unblocks A4/A6. Can run parallel to A1 (different file:
  `entity-hover.ts`).
- **A10's accent SSOT (D-1)** (`ai`/`error` into `DEFAULT_PANEL_COLORS` + `SYSTEM_THEME_KEYS`;
  `themeKey` as accessor) — small, unblocks A6's marker-theme. Parallel (file: `panel-theme.ts`).
- **A8** (registry-derived printable-panel set, dead print CSS, `reports` printable, `quotations` key)
  — entirely self-contained, consumes A0 only, zero overlap with the interaction arenas. Parallel.

  *Why parallel:* these touch disjoint files (`useComments`/`useViewPrefs` vs `entity-hover.ts` vs
  `panel-theme.ts` vs `print.ts`/`globals.css` print block). The one shared file is `EditorLayout.tsx`
  (A1's `menuLocation`/detached toolbars) — A1 owns it in this batch; A6's dead-twin deletion is BATCH 3.

**BATCH 1 — A4 (the keystone, SERIALIZE — everything downstream waits).**
- **A4** — split `toggleSelection` → `toggleExpanded`/`select`, new `selected` slot, retire `transient`
  (AND update the omni consumers per GAP-3), expand chevron + popout button in the header, marker-clicks
  → `select` only, a11y, lift-contract cleanup. **Must update `omni-host.tsx`'s `transient` consumers in
  the same chip** (GAP-3). Consumes A2's B-1 (`EntityKind` now registry-derived) and AF's
  `popOutAtRect`.
  *Why serialize:* A4 restructures `anchored-card-store.ts` (the axis SSOT) and `panel-primitives.tsx`
  (the header). A5/A9/A6 all consume the new axes. **Nothing in BATCH 2-3 can start its expansion-
  dependent work until A4 lands.**

**BATCH 2 — A3 + A2-rest + A9 (mostly PARALLEL after A4, with one serialize).**
- **A3** (creation pipeline: fold `selection-to-card`, `finishCreate`, `popCardAtAnchor` re-type [owns
  it per C-1], pristine consolidation, delete duplicate pristine manager, lifecycle ratification). Edits
  `card-creation.ts`, `EditorPane.tsx` (creation region), `EditorLayout.tsx` (pristine manager),
  `selection-to-card.ts`. **Consumes A4's `select`/`expand` primitives** (the `finishCreate` tail calls
  them, not the welded `toggleSelection`).
- **A2-rest** (after B-1 landed in BATCH 0): build `resolveCardKind` + `isInlineAtomCardKind`, retire
  `EntityCollections` onto `CardFloatCtx` (C-2: after A1's relocation), derive `ANCHOR_CLICK_ROUTES`/
  `entityKindToAnchorKind`, the legacy-token crosswalk. **Consumes A10's `themeKey` accessor** (D-1).
- **A9** (borrowed-main-text renderer + shared schema, `bodyClass` typography, morph chevron for all 4
  pairs, ErrorCard/AiRequestCard body restyle [D-3: after A10's accent source], STYLE_GUIDE). Edits
  `panel-primitives.tsx` (header — **serialize after A4**, SEAM A-1/A-3), `cards/floats/index.tsx`
  (morph slots), `panel-typography.ts`, `cards/types.ts`/`card-registry.tsx` (new fields).

  *Serialize within BATCH 2:* **A3 and A2-rest** can run parallel (creation files vs anchor files,
  minimal overlap — both touch `CardFloatCtx` per C-2, so serialize A2's `EntityCollections` fold after
  A1's relocation + alongside A3's consumption). **A9 must serialize after A4 on `panel-primitives.tsx`**
  (the header). A9 ⟂ A3 (different regions of `EditorPane.tsx`/different files) — parallel-safe.

**BATCH 3 — A5 + A6 + A10-rest (PARALLEL after A4 + A9-typography, with marginalia serialize).**
- **A5** (single-cascade omni reflow, `anchorState` band [B-2: needs A2's orphan semantics],
  `CardDisplayProvider` symmetry [A-4: needs A9's compression number], stale comments). **Gated on A4**
  (expansion signal, BATCH 1) + **A9's compression number** (A-4) + **A2's orphan semantics** (B-2).
- **A6** (collapse to one marginalia pipeline [Q1 product call], registry-derive marker metadata
  [consumes A10's D-1 + A2's B-1], overflow affordance [Q3]). **Deletes the dead twin in
  `EditorLayout.tsx`** — serialize after A1's `menuLocation` + A3's pristine-manager deletions on that
  file (contention map).
- **A10-rest** (collab claim-scope derive [D-2: after A9's morph for the morph-follows-scope coordination],
  one `CollabCardTrailing`, AI-request registry routing). Edits `cards/floats/index.tsx` (trailing —
  **serialize after A9's title-slot morph**, contention map) + the 5 data hooks.

  *Why this batch is last:* A5 depends on A4 + A9 + A2; A6 depends on A10-D1 + A2-B1 + the
  `EditorLayout.tsx` deletions clearing; A10-rest depends on A9's morph (D-2) and the float trailing
  slot. **A8's print chrome-strip marker (E-3) lands here too** — after A9 finalizes the header
  controls.

### Parallel vs serialize summary
- **PARALLEL (no shared structural file):** BATCH 0 (A1 ∥ A2-B1 ∥ A10-D1 ∥ A8). Within BATCH 2:
  A3 ∥ A9 (different files/regions). Within BATCH 3: A5 ∥ A10-rest (different files), with A6
  serialized on `EditorLayout.tsx`.
- **SERIALIZE (shared structural file or signal dependency):**
  - `anchored-card-store.ts`: **A4 alone, before all consumers** (keystone).
  - `panel-primitives.tsx`: **A4 → A9 → A10 → A8** (header → morph → collab/theme → print marker).
  - `EditorPane.tsx`: A3 (creation) ⟂ A6 (markers) — serialize if line regions are adjacent.
  - `EditorLayout.tsx`: **A1 (menuLocation) → A3 (pristine mgr) → A6 (dead twin)** — three deletions.
  - `cards/floats/index.tsx`: **A9 (title slot) → A10 (trailing slot)**.
  - `card-float-ctx.ts`: **A1 (relocate) → A2 (fold EntityCollections) → A3 (consume)**.
  - `cards/types.ts`/`card-registry.tsx`: additive field adds — batch or serialize A9/A10/A6/A8 to
    avoid churn (low conflict, but keep the runtime-leaf invariant).
- **GATE:** the **AF-follow chip (`snapshotForStack`, GAP-8) must land before A1 deletes the legacy
  stack path** — schedule it in BATCH 0 or 1, before A1's stack-path item (which A1 already gates).

---

## 6. RATIFICATION QUESTIONS (deduped across all audits)

Consolidated + deduped from the nine audits' "Open questions for the human." Grouped; each notes the
source arena(s) and the recommended answer.

**Interaction model (A4 — gates A5/A6/A9):**
- **R1 — Body-click default policy** (A4 Q1). Clicking a card *body* should: (a) select+expand
  [today, discoverable], (b) select only [purest N1], (c) expand only? **Rec: (a)** as the default
  composition, with the chevron/popout as axis-pure overrides. *Gates whether selected-but-collapsed is
  default or opt-in.*
- **R2 — Multi-select operand** (A4 Q2). Genuine multi-*selection* set, or is multi-*expansion*
  enough and selection stays single? **Rec: single selection for A4; defer multi-select.**
- **R3 — Keyboard nav scope** (A4 Q3). Full roving-tabindex (Arrow/Enter/expand-key/popout-chord) in
  A4, or fast-follow? **Rec: split axes + one-click controls + a11y now; keyboard nav fast-follow.**
- **R4 — Pop-out auto-selects?** (A4 Q4). **Rec: no — pop-out is axis-pure (B2).**
- **R5 — Non-anchored kinds (`bib`/`ai`/`error`) get an expansion axis?** (A4 Q5 + GAP-4). **Rec: add a
  panel-local `expanded` set for them OR explicitly scope them out** — must decide, currently undefined
  (GAP-4). A4 owns the call.

**Omni reflow (A5 — after A4):**
- **R6 — Unanchored band placement** (A5 Q1). Free notes **below** the last anchored card [rec — "free
  notes collect at the end," title band unambiguous] or **above** in a reserved in-solver zone? **Rec:
  below (§2-A).**
- **R7 — Orphaned vs free: one band or two** (A5 Q2 + B-2). **Rec: one band, badge-distinguished**;
  needs A2's orphan semantics threaded into `OmniItem.anchorState`.
- **R8 — Compression depth symmetry** (A5 Q3 + A9 + A-4). Omni shows 2 lines, docked 1 — unify to one
  number (which?) or keep per-surface? **Rec: A9 picks the number; A5 symmetrizes the providers.**
- **R9 — Unanchored band extends the scroll column?** (A5 Q5). Folding free cards below the editor's
  last anchor can extend the column past the editor bottom. Scroll into a short trailing zone, or cap
  hard? **Rec: confirm desired scroll behavior.**

**Typography / morph / borrowed (A9):**
- **R10 — Scope of "display-only" borrowed bodies** (A9 Q1). (a) only example/highlight + collapsed/
  popped-read become read-only, footnote/note/archive keep in-card editing; or (b) all borrowed bodies
  read-only, editing moves elsewhere? **Rec: (a)** — borrowed-display for non-editable contexts, keep
  editing for footnote/note/archive over the shared schema.
- **R11 — `report`'s typography class** (A9 Q2 + C-2). Borrowed serif, or apparatus sans (fix the
  render path)? **Rec: apparatus/sans** — a report is AI commentary, not borrowed source.
- **R12 — Highlight excerpt rendering** (A9 Q3). `BorrowedMainText` or keep the faithful serif string?
  **Rec: keep the serif string** (contiguous prose, already faithful; not worth a TipTap mount).
- **R13 — Morph compatibility shape** (A9 Q4). `{ to, lossy }` + registered `convert`, or richer
  (blocked pairs / salvage-preview)? **Rec: `{ to, lossy }` + `convert` now; richer is YAGNI.**
- **R14 — note↔highlight morph direction** (A9 Q5). Both directions (note→highlight is lossy) with a
  confirm, or keep highlight→note one-way? **Rec: both, with the lossy confirm** (uniformity is the
  point of the chevron).

**Marginalia (A6):**
- **R15 — Canonical gutter-click behavior** (A6 Q1 — gates the pipeline collapse). Port the rich
  Omni-first routing (`openForCard` + `cardPopKey` + `clickY` align + split-aware citation) into
  EditorPane, or keep the simpler current live behavior? **Rec: port the Omni-first routing** (better
  UX; the live gutter *regressed* off it post-7.8; AF-fix already made it coherent — but in dead code).
- **R16 — Overflow affordance** (A6 Q3). Option A "+K" compress pill [rec], Option B spill column, or
  leave clamped-and-stacked (status quo)? **Rec: Option A.**
- **R17 — `defaultSide` home** (A6 Q4). Move into `CARD_REGISTRY` (a card declares its gutter side) or
  stay marginalia-local? **Rec: `panelId` derives from registry `.panel`; `defaultSide` stays
  marginalia-local** (gutter-layout concern).

**Lifecycle (A3):**
- **R18 — Archive delete-cascade** (A3 Q1 — the one real lifecycle decision). When the user deletes an
  archive snippet's anchor paragraph, drop the snippet too? **Rec: NO** (an archive's purpose is to
  survive deletion) → archive stays `{false,false,false}`; "yes" needs a new Mode-A cascade mechanism.
- **R19 — `example` permanent gap** (A3 Q2 + C-3). Confirm `example` lifecycle stays
  `{false,false,false}` *forever* (origin:"derived" mirror of the `exampleBlock` TextObject). **Rec:
  yes, annotate permanent.**
- **R20 — Selection-create UX parity** (A3 Q3). Folding `selection-to-card` gives selection-born
  notes/cutters the recently-added pin + float-pop option they lack today. Acceptable behavior change,
  or keep selection-create bare? **Rec: acceptable** (uniformity).
- **R21 — Delete EditorLayout's duplicate pristine manager + parity hook mounts** (A3 Q4 — medium
  confidence). Confirmed deletable, or do any feed a live shell-side surface? **Needs impl-chip
  render-dead verification before deleting.**

**Print/reader (A8):**
- **R22 — `reports` printable** (A8 Q1). **Rec: yes** (it's a card panel like Cutter/Revisions; the
  exclusion is drift).
- **R23 — Appendix card chrome in print** (A8 Q2). Strip all non-content controls (grip/collab/popout/
  jump) via one `data-card-chrome` marker, keep label+body? **Rec: yes** (E-3, A9 lands the marker).
- **R24 — Print CSS allowlist: generate vs collapse** (A8 Q3). **Rec: collapse to one
  `data-print-enabled`-driven rule** (no per-panel CSS).
- **R25 — Print facet home** (A8 Q4). On `PANEL_REGISTRY` entries or a sibling `print-panels.ts`?
  **Rec: sibling table** (print order/default are print-specific).

**Cross-cutting (A10):**
- **R26 — System accents as non-overridable registry entries** (A10 Q1 + D-1). Fold `ai`/`error` into
  `DEFAULT_PANEL_COLORS` + a `SYSTEM_THEME_KEYS` skip-set? **Rec: yes** (one path, policy-guarded
  non-customizability).
- **R27 — Rewrite `ai`/`error` bodies off literal Tailwind** (A10 Q2 + D-3). Now (A10) or split to A9?
  **Rec: A10 owns the accent source; A9 owns the body restyle** (visible delta, design sign-off).
- **R28 — Collab claim-scope = `themeKey`** (A10 Q3 + D-2). Reuse `themeKey` as the collab scope, or a
  separate `claimScope` field? **Rec: reuse `themeKey`** (same grain; a second field re-introduces
  drift).
- **R29 — AI-request routing field on `CARD_REGISTRY`** (A10 Q4). Add `aiRequest?: { kind; linkPanel }`
  (couples the skill vocabulary into the registry), or keep a bridge-local map? **Rec: registry field**
  (kills the 3-enum fan-out; `AiRequestKind` stays the external skill contract).

**Gardening (A1):**
- **R30 — Detached toolbars: keep or kill** (A1 O1). The §9 punch-list calls them "vestigial" but they
  are **live and reachable**. **Rec: KEEP** (a working tear-off feature; removing it exceeds gardening).
  The dead `menuLocation` pref dies regardless.
- **R31 — `menuLocation` persisted-pref deletion** (A1 O2). Drop the field (read-time strip) or reserve
  it? **Rec: drop** (the detached-toolbar path supersedes it).
- **R32 — ErrorCard `data-card-key` after de-popping** (A1 O3 + A2 seam). Does it still feed an in-text
  hover/selection seam (keep the attribute, computed via `cardPopKey`), or only the popout key (remove
  it)? **Rec: A2 confirms the hover seam; keep the attribute if so.**
- **R33 — Dual example key collapse** (A1 O4). **Rec: do NOT collapse** — `float:card:example:` (Card)
  and `float:textobject:exampleBlock:` (TextObject) are two ontologies; merging violates two-kinds.
- **R34 — Grip re-introduction note** (A1 O5). File the intent durably (bug backlog) before deleting
  the dead comments? **Rec: one-line note in `MEMO_BUG_BACKLOG.md`, then delete.**

**SSOT reconciliations the management session must absorb on merge** (not Gabriel-facing, but decisions):
- **C-3 / R19**: SSOT "A3 fills the 5 lifecycle gaps" → corrected to "4 permanent gaps + archive
  decision."
- **GAP-8**: spin a Wave-3 `AF-follow` chip for `snapshotForStack` + `bib`/`ai` full chrome, gated
  before A1's stack-path deletion.
- **A9 C1 correction**: the borrowed-content set is **footnote, archive, example (+highlight excerpt)** —
  NOT cutter/revision-suggestion (flat strings). Update SSOT §8/Decisions "borrowed candidates."
- **A8 GAP-6**: A8's DoD#8 borrowed-content list must adopt A9's corrected set.

---

*Seam-sweep complete. Nine arenas reconciled; foundations (A0/AF) landed and out of audit scope. The
refactor's Wave-3 sequencing is gated on A4 (interaction keystone), unblocked by three free
registry-derivation folds (A2-B1, A10-D1, A8), and converges on `panel-primitives.tsx` +
`anchored-card-store.ts` + `cards/types.ts` as the serialization choke points.*
